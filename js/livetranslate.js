// =====================================================================
// Live translate in the chat (Premium) and the "My language" picker. The UI and per-chat state around the engine in
// translate.js; app.js feeds it three things: when a chat starts/ends, when the partner's hello arrives, and each
// message in or out. Per chat: both switches start off (or as remembered in localStorage 'ac.translate'), and all of it
// resets on Next. Text is only handed to the engine while the matching switch is on (or on an explicit "Retry").
// Everything that came from the partner is shown with textContent only.
// =====================================================================
import { LANGS, langName, langNative, langLabel, sanitizeLang, guessLang, isRtl } from './languages.js';
import { ERROR_TEXT, MAX_TEXT, MAX_ORIG, worthTranslating } from './translate.js';
import { openSheet, closeSheet } from './ui.js';

const $ = id => document.getElementById(id);
function h(tag, cls, text) {
    const node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text != null) node.textContent = text;
    return node;
}
const PENDING_DELAY_MS = 350;
const RETRYABLE = new Set(['timeout', 'unavailable', 'busy', 'quota-minute']);

/**
 * S: app state (lang, session, phase)       store: { get, set } over localStorage 'ac.*'
 * engine: createEngine(...)                  isPremium(), openPaywall(reason), toast(text, bad), whenReady() -> Promise
 * sendData(obj)                              the data channel
 * addMessage(who, text) -> ctl               shows a bubble. ctl = { wrap, meta, text, risky, revealed, view, translated, render(), onReveal[] }
 * fmt: { profanity(text), contact(text) }    how text from the partner is masked for display
 * scroll()                                   keep the newest message in view
 */
export function createLiveTranslate({ S, store, engine, isPremium, openPaywall, toast, sendData, addMessage, fmt, scroll = () => {}, whenReady = () => Promise.resolve(), onLangChange = () => {} }) {
    // ----------------------------------------------------------------- my language
    const browserLang = () => guessLang(typeof navigator !== 'undefined' ? navigator.language : '');
    /** The language I read and write: the one I chose, else the browser's (never sent to anyone until I choose). */
    const myLang = () => S.lang || browserLang();

    const langSelect = $('langSelect'), langSuggest = $('langSuggest');
    const byName = [...LANGS].sort((a, b) => a.en.localeCompare(b.en));
    function fillLangSelect(select, { blank = '' } = {}) {
        const opts = byName.map(l => { const o = new Option(langLabel(l.code), l.code); o.lang = l.code; return o; });
        select.replaceChildren(...(blank ? [new Option(blank, '')] : []), ...opts);
    }
    function renderLangPicker() {
        if (!langSelect) return;
        const guess = browserLang();
        langSelect.options[0].textContent = `Not set (suggested: ${langLabel(guess)})`;
        langSelect.value = S.lang;
        langSuggest?.classList.toggle('hidden', Boolean(S.lang));
        if (langSuggest) langSuggest.textContent = `Use ${langNative(guess)} · ${langName(guess)}`;
    }
    /** Choose (or, with '', clear) my language. Saved in this browser; ProfileSync adds it to a Google account. */
    function setMyLang(code) {
        S.lang = sanitizeLang(code);
        store.set('lang', S.lang);
        renderLangPicker();
        refresh();
        onLangChange(S.lang);
    }
    if (langSelect) {
        fillLangSelect(langSelect, { blank: ' ' });
        renderLangPicker();
        langSelect.addEventListener('change', () => setMyLang(langSelect.value));
        langSuggest?.addEventListener('click', () => setMyLang(browserLang()));
    }

    // ----------------------------------------------------------------- per-chat state
    const savedChoice = () => { const v = store.get('translate', null); return { recv: v?.recv === true, send: v?.send === true }; };
    let rememberOn = savedChoice().recv || savedChoice().send;
    const fresh = () => ({ recv: false, send: false, recvTarget: '', sendTarget: '', sug: 'idle', notified: new Set(), chain: Promise.resolve(), depth: 0, lastVia: '' });
    let chat = fresh(); // replaced (not reset) for every chat, so late answers for an old chat can tell they are old

    const live = () => S.phase === 'connected' && Boolean(S.session) && !S.session.ended;
    const available = () => engine.hasCloud || engine.hasDevice;
    const partnerLang = () => sanitizeLang(S.session?.partner?.lang);
    const recvTarget = () => chat.recvTarget || myLang();
    const sendTarget = () => chat.sendTarget || partnerLang();
    const canSend = () => Boolean(partnerLang()) && partnerLang() !== myLang();
    // What is actually in force: the premium pass is checked every time, and sending also needs a partner language.
    const recvOn = () => chat.recv && isPremium();
    const sendOn = () => chat.send && isPremium() && canSend();
    const anyOn = () => recvOn() || sendOn();

    function persist() {
        if (rememberOn) store.set('translate', { recv: chat.recv, send: chat.send });
    }

    /** A new chat: forget the last one's state, start from the remembered choice (only for Premium). */
    function onChatStart() {
        engine.reset();
        chat = fresh();
        if (rememberOn && isPremium()) Object.assign(chat, savedChoice());
        refresh();
    }
    function onChatEnd() {
        engine.reset();
        chat = fresh();
        closeSheet($('translateSheet'));
        refresh();
    }

    /** Premium ended or the person signed out: Live translate goes off. */
    function enforce() {
        if (isPremium() || !(chat.recv || chat.send)) { refresh(); return; }
        chat.recv = chat.send = false;
        engine.reset();
        toast('Live translate turned off: it needs Premium.', true);
        refresh();
    }

    function notifyOnce(kind) {
        if (chat.notified.has(kind)) return;
        chat.notified.add(kind);
        toast(ERROR_TEXT[kind], true);
    }
    /** A failure that decides whether Live translate may carry on. */
    function failed(err) {
        if (err.kind === 'premium' || err.kind === 'auth') {
            chat.recv = chat.send = false;
            notifyOnce(err.kind);
            refresh();
        } else if (err.kind === 'quota-day' || err.kind === 'quota-minute') {
            notifyOnce(err.kind);
        }
    }

    // ----------------------------------------------------------------- the entry points and the slim bar
    const btn = $('translateBtn'), moreLabel = $('translateMoreLabel'), bar = $('trBar');
    const sheet = $('translateSheet');

    function renderEntry() {
        if (btn) {
            btn.classList.toggle('hidden', !available());
            btn.disabled = !live();
            btn.classList.toggle('on', anyOn());
            btn.title = isPremium() ? `Live translate (${anyOn() ? 'on' : 'off'})` : 'Live translate (Premium)';
            btn.setAttribute('aria-label', btn.title);
        }
        if (moreLabel) moreLabel.textContent = !isPremium() ? '👑 Premium' : anyOn() ? 'On' : 'Off';
    }

    function renderBar() {
        if (!bar) return;
        const show = live() && available();
        const partner = partnerLang();
        if (show && anyOn()) {
            const both = recvOn() && sendOn();
            const text = both ? `Live translate on: ${langName(recvTarget())} ⇄ ${langName(sendTarget())}`
                : recvOn() ? `Live translate on: messages into ${langName(recvTarget())}`
                    : `Live translate on: what you type into ${langName(sendTarget())}`;
            chat.sug = 'done';
            bar.dataset.kind = 'on';
            const label = h('span', 'tr-bar-text');
            label.append(h('span', 'tr-bar-globe', '🌐'), document.createTextNode(' ' + text));
            const settings = h('button', 'tr-bar-btn', 'Settings');
            settings.type = 'button';
            settings.onclick = openFromButton;
            bar.replaceChildren(label, settings);
            bar.classList.remove('hidden');
            return;
        }
        if (show && isPremium() && partner && partner !== myLang() && chat.sug !== 'done') {
            chat.sug = 'open';
            bar.dataset.kind = 'suggest';
            const label = h('span', 'tr-bar-text');
            label.append(h('span', 'tr-bar-globe', '🌐'), document.createTextNode(` ${langName(partner)} speaker: turn on live translate?`));
            const on = h('button', 'tr-bar-btn tr-bar-go', 'Turn on');
            on.type = 'button';
            on.onclick = () => { chat.sug = 'done'; setSwitch('recv', true); setSwitch('send', true); };
            const no = h('button', 'tr-bar-btn tr-bar-x', '×');
            no.type = 'button';
            no.title = 'Not now';
            no.setAttribute('aria-label', 'Not now');
            no.onclick = () => { chat.sug = 'done'; renderBar(); };
            bar.replaceChildren(label, on, no);
            bar.classList.remove('hidden');
            return;
        }
        bar.classList.add('hidden');
        bar.replaceChildren();
    }

    async function openFromButton() {
        if (!live()) return;
        await whenReady();
        if (!isPremium()) { openPaywall('translate'); return; }
        chat.sug = 'done';
        renderSheet();
        openSheet(sheet);
    }
    btn?.addEventListener('click', openFromButton);

    // ----------------------------------------------------------------- the sheet
    const rRecv = $('trRecv'), rSend = $('trSend'), selRecv = $('trRecvTarget'), selSend = $('trSendTarget');
    const nameRecv = $('trRecvName'), nameSend = $('trSendName'), hintSend = $('trSendHint'), rRemember = $('trRemember'), engineLine = $('trEngine');
    if (selRecv) { fillLangSelect(selRecv); fillLangSelect(selSend); }

    function engineText() {
        if (chat.lastVia === 'device') return 'Last message translated on your device. Nothing was sent anywhere.';
        if (chat.lastVia === 'cloud') return 'Last message translated by our secure service (Google Cloud). It is not stored.';
        const d = engine.device;
        const src = partnerLang();
        if (d && src && src !== recvTarget()) {
            const st = d.status(src, recvTarget());
            if (st.state === 'downloading') return `Downloading the on-device language pack… ${Math.round(st.progress * 100)}%`;
            if (st.state === 'ready') return 'This language pair will be translated on your device.';
        }
        return '';
    }
    function renderSheetEngine() { if (engineLine) engineLine.textContent = engineText(); }

    function renderSheet() {
        if (!sheet) return;
        const pl = partnerLang();
        const sendable = canSend();
        rRecv.checked = chat.recv;
        selRecv.value = recvTarget();
        nameRecv.textContent = langName(recvTarget());
        rSend.checked = chat.send && sendable;
        rSend.disabled = !sendable;
        selSend.disabled = !sendable;
        selSend.value = sendable ? sendTarget() : (pl || selSend.options[0].value);
        nameSend.textContent = sendable ? langName(sendTarget()) : 'their language';
        rSend.closest('.tr-group').classList.toggle('disabled', !sendable);
        hintSend.textContent = !pl ? 'Available once your partner has chosen a language (it shows on their card).'
            : !sendable ? `They speak ${langName(pl)}, the same as you.` : '';
        rRemember.checked = rememberOn;
        renderSheetEngine();
    }
    sheet?.addEventListener('sheet:open', renderSheet);
    engine.device?.onChange(renderSheetEngine);

    function setSwitch(which, on) {
        if (on && !isPremium()) { closeSheet(sheet); openPaywall('translate'); return false; }
        if (which === 'send' && on && !canSend()) return false;
        chat[which] = on;
        if (on && !engine.hasCloud && !engine.hasDevice) { toast('Live translate isn’t available in this browser.', true); chat[which] = false; }
        persist();
        // A tap is when the browser lets an on-device language pack start downloading.
        if (on) {
            if (which === 'recv' && partnerLang()) engine.warm(partnerLang(), recvTarget());
            if (which === 'send') engine.warm(myLang(), sendTarget());
        }
        refresh();
        return true;
    }
    rRecv?.addEventListener('change', () => { if (!setSwitch('recv', rRecv.checked)) renderSheet(); });
    rSend?.addEventListener('change', () => { if (!setSwitch('send', rSend.checked)) renderSheet(); });
    selRecv?.addEventListener('change', () => { chat.recvTarget = selRecv.value === myLang() ? '' : selRecv.value; if (chat.recv && partnerLang()) engine.warm(partnerLang(), recvTarget()); refresh(); });
    selSend?.addEventListener('change', () => { chat.sendTarget = selSend.value === partnerLang() ? '' : selSend.value; if (chat.send) engine.warm(myLang(), sendTarget()); refresh(); });
    rRemember?.addEventListener('change', () => {
        rememberOn = rRemember.checked;
        store.set('translate', rememberOn ? { recv: chat.recv, send: chat.send } : { recv: false, send: false });
    });

    function refresh() {
        renderEntry();
        renderBar();
        if (sheet && !sheet.classList.contains('hidden')) renderSheet();
    }

    // ----------------------------------------------------------------- lines under a message
    function lineFor(ctl, kind) {
        ctl.lines ||= {};
        if (!ctl.lines[kind]) {
            const el = h('div', 'translated tr-' + kind);
            ctl.lines[kind] = el;
            ctl.wrap.insertBefore(el, ctl.meta);
        }
        return ctl.lines[kind];
    }
    function dropLine(ctl, kind) {
        ctl.lines?.[kind]?.remove();
        if (ctl.lines) delete ctl.lines[kind];
    }
    function link(text, onClick) {
        const b = h('button', 'tr-link', text);
        b.type = 'button';
        b.onclick = onClick;
        return b;
    }
    /** A body of text taken from the other side: masked like the bubble until "Show anyway". */
    function bodyFor(ctl, text, lang) {
        const body = h('div', 'tr-body');
        body.dir = 'auto';
        if (lang) body.lang = lang;
        const paint = () => {
            const masked = Boolean(ctl.risky) && !ctl.revealed;
            body.textContent = fmt.profanity(masked ? fmt.contact(text) : text);
            body.classList.toggle('masked', masked);
        };
        paint();
        ctl.onReveal.push(paint);
        return body;
    }

    /** The sender translated their message for us: its original, from the sender's own language. */
    function showOriginal(ctl, orig, olang) {
        const el = lineFor(ctl, 'orig');
        el.replaceChildren(h('div', 'tr-head', `🌐 Original · ${langName(olang)}`), bodyFor(ctl, orig, olang));
        scroll();
    }

    // ----------------------------------------------------------------- receiving
    function showTranslation(ctl, res) {
        ctl.translated = res.text;
        ctl.view = 'translated';
        ctl.render();
        const el = lineFor(ctl, 'recv');
        const head = h('div', 'tr-head');
        head.append(h('span', '', res.source ? `🌐 ${langName(res.source)} → ${langName(res.target)}` : `🌐 Translated to ${langName(res.target)}`));
        const toggle = link('Show original', () => {
            ctl.view = ctl.view === 'translated' ? 'orig' : 'translated';
            toggle.textContent = ctl.view === 'translated' ? 'Show original' : 'Show translation';
            ctl.render();
        });
        head.appendChild(toggle);
        el.classList.remove('pending', 'failed');
        el.replaceChildren(head);
        scroll();
    }
    function showFailure(ctl, err, retry) {
        const el = lineFor(ctl, 'recv');
        el.classList.remove('pending');
        el.classList.add('failed');
        const head = h('div', 'tr-head');
        head.append(h('span', '', `🌐 Not translated: ${ERROR_TEXT[err.kind] || ERROR_TEXT.unavailable}`));
        if (RETRYABLE.has(err.kind)) head.appendChild(link('Retry', retry));
        el.replaceChildren(head);
        scroll();
    }

    function translateIncoming(sess, ctl) {
        const mine = chat;
        let shown = false;
        const timer = setTimeout(() => {
            shown = true;
            const el = lineFor(ctl, 'recv');
            el.classList.add('pending');
            el.replaceChildren(h('div', 'tr-head', '🌐 Translating…'));
            scroll();
        }, PENDING_DELAY_MS);
        engine.translate({ text: ctl.text, target: recvTarget(), source: 'auto' }).then(res => {
            clearTimeout(timer);
            if (mine !== chat || sess !== S.session || !ctl.wrap.isConnected) return;
            if (res.via === 'device' || res.via === 'cloud') chat.lastVia = res.via;
            if (res.same) { if (shown) dropLine(ctl, 'recv'); return; }
            showTranslation(ctl, res);
            renderSheetEngine();
        }, err => {
            clearTimeout(timer);
            if (err.kind === 'cancelled' || mine !== chat || sess !== S.session || !ctl.wrap.isConnected) { if (shown) dropLine(ctl, 'recv'); return; }
            failed(err);
            showFailure(ctl, err, () => { if (isPremium() && live()) translateIncoming(S.session, ctl); });
        });
    }

    /** A message from the partner was shown: add its original, and translate it when the receive switch is on. */
    function onIncoming(sess, ctl, m) {
        if (m.orig) showOriginal(ctl, m.orig, m.olang);
        if (!recvOn() || sess !== S.session) return;
        const t = m.text.trim();
        if (!worthTranslating(t) || t.length > MAX_TEXT) return;
        translateIncoming(sess, ctl);
    }

    // ----------------------------------------------------------------- sending
    function note(ctl, text, cls = '') {
        const el = lineFor(ctl, 'sent');
        el.className = 'translated tr-sent' + (cls ? ' ' + cls : '');
        el.replaceChildren(h('div', 'tr-head', text));
        scroll();
        return el;
    }

    /** True while messages must go through sendTranslated (the switch is on, or earlier ones are still being translated). */
    const sending = () => sendOn() || chat.depth > 0;

    /** Show my message now, translate it, then send it: { text: translated, orig, olang }, or the original if that fails. */
    function sendTranslated(text) {
        const sess = S.session;
        const ctl = addMessage('me', text);
        const target = sendOn() ? sendTarget() : '';
        const mine = chat;
        const t = text.trim();
        chat.depth++;
        chat.chain = chat.chain.then(async () => {
            try {
                if (sess !== S.session || sess.ended || mine !== chat) { note(ctl, 'Not sent: the chat ended.', 'failed'); return; }
                if (!target || !worthTranslating(t)) { sendData({ t: 'msg', text }); return; }
                if (t.length > MAX_TEXT) { sendData({ t: 'msg', text }); note(ctl, `Sent as you typed: ${ERROR_TEXT.toolong}`); return; }
                const timer = setTimeout(() => note(ctl, '🌐 Translating…', 'pending'), PENDING_DELAY_MS);
                let res;
                try {
                    res = await engine.translate({ text: t, target, source: 'auto', priority: 'high' });
                } catch (err) {
                    clearTimeout(timer);
                    if (err.kind !== 'cancelled') failed(err);
                    if (sess !== S.session || sess.ended) { note(ctl, 'Not sent: the chat ended.', 'failed'); return; }
                    sendData({ t: 'msg', text }); // the person's own words still go out
                    if (err.kind === 'cancelled') dropLine(ctl, 'sent');
                    else note(ctl, `Sent as you typed (not translated): ${ERROR_TEXT[err.kind] || ERROR_TEXT.unavailable}`, 'failed');
                    return;
                }
                clearTimeout(timer);
                if (res.via === 'device' || res.via === 'cloud') chat.lastVia = res.via;
                if (sess !== S.session || sess.ended) { note(ctl, 'Not sent: the chat ended.', 'failed'); return; }
                if (res.same) { sendData({ t: 'msg', text }); dropLine(ctl, 'sent'); return; }
                if (res.text.length > MAX_ORIG) { sendData({ t: 'msg', text }); note(ctl, 'Sent as you typed (not translated): the translation was too long.', 'failed'); return; }
                sendData({ t: 'msg', text: res.text, orig: text, olang: res.source || myLang() });
                const el = lineFor(ctl, 'sent');
                el.className = 'translated tr-sent';
                const body = h('div', 'tr-body', res.text);
                body.dir = 'auto';
                el.replaceChildren(h('div', 'tr-head', `🌐 Sent as ${langName(res.target)}`), body);
                scroll();
                renderSheetEngine();
            } finally {
                chat.depth--;
            }
        }).catch(e => console.warn('live translate send', e));
    }

    return {
        myLang, setMyLang, renderLangPicker,
        partnerLang,
        onChatStart, onChatEnd,
        onPartnerHello() { refresh(); },
        onIncoming, sending, sendTranslated,
        enforce, refresh,
        get on() { return anyOn(); },
        get state() { return { recv: recvOn(), send: sendOn(), recvTarget: recvTarget(), sendTarget: sendTarget(), remember: rememberOn }; },
    };
}
