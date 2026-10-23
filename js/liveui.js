// The "Live sessions" tab of the group screen: who is live now (join, or send a gift), and everything a host does (apply, go live,
// see earnings, ask for a payout). The server does the real work and the charging (functions/live.js); this only draws it.
// Everything that came from other people is shown with textContent.
import { GIFTS, stickerURL } from './stickers.js';
import { LIVE_START_FEE, PRIVATE_FEE, HOST_SHARE_PCT, MIN_PAYOUT_COINS, MAX_TITLE, titleProblem, rupees, seatsText } from './live.js';

const $ = id => document.getElementById(id);
function h(tag, cls, text) { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; }

/**
 * @param {{pane: HTMLElement, ctx: any, enter: (session: any) => Promise<void>}} o
 *   ctx: toast, signedIn(), signIn(), coins {get, set, refresh, openShop}, makeBackend() (the group backend: call(name, data)), avatar, nick
 */
export function createLiveUi({ pane, ctx, enter }) {
    let backend = null;
    let timer = 0;
    let sessions = [];
    let me = null;          // myHost() or null when not loaded / not signed in
    let opened = false;
    let busy = false;
    const api = () => (backend ||= ctx.makeBackend());

    const fail = e => ctx.toast(e?.code === 'online-only' || /permission-denied|failed-precondition|invalid-argument|already-exists|resource-exhausted|not-found/.test(e?.code || '') ? (e.message || 'That didn’t work.') : 'That didn’t work. Try again.', true);

    let meKey = '';
    /** @param {boolean} [quiet] the 15-second refresh: update the list of sessions only, and leave a form someone may be typing in alone */
    async function load(quiet = false) {
        if (busy) return;
        busy = true;
        let hostChanged = !quiet;
        try {
            const out = await api().call('listLive');
            sessions = out.sessions || [];
            if (ctx.signedIn()) {
                let next = null;
                try { next = await api().call('myHost'); } catch { next = null; }
                const key = JSON.stringify([next?.status, next?.coins, next?.pendingCoins, next?.paidOutCoins, next?.activeSid, next?.payouts?.length, true]);
                if (key !== meKey) { hostChanged = true; meKey = key; }
                me = next;
            } else { if (me !== null || meKey !== 'out') hostChanged = true; me = null; meKey = 'out'; }
            ctx.coins?.refresh();
        } catch (e) {
            sessions = [];
            if (e?.code === 'online-only') { pane.replaceChildren(card('Live sessions', 'Live sessions are available on the online version of the site.')); busy = false; return; }
            console.warn('live list', e);
        }
        busy = false;
        if (hostChanged || !built) render(); else renderList();
    }

    function card(title, text) {
        const c = h('div', 'live-card');
        c.append(h('b', '', title));
        if (text) c.append(h('p', 'hint', text));
        return c;
    }

    // ------------------------------------------------------------------ the list
    function sessionCard(s) {
        const c = h('div', 'live-card live-session');
        const head = h('div', 'live-head');
        const av = h('div', 'avatar live-avatar');
        ctx.applyAvatar?.(av, { avatar: s.hostAvatar, nick: s.hostName });
        const who = h('div', 'live-who');
        who.append(h('b', '', s.title), h('span', '', `Hosted by ${s.hostName}`));
        head.append(av, who);
        const tags = h('div', 'live-tags');
        tags.append(h('span', 'live-tag live-dot', 'Live'), h('span', 'live-tag', seatsText(s)));
        tags.append(h('span', 'live-tag ' + (s.kind === 'private' ? 'priv' : ''), s.kind === 'private' ? `Private · ${s.fee} coins` : 'Public · free'));
        const actions = h('div', 'live-actions');
        if (s.mine) {
            const b = h('button', 'btn btn-primary btn-sm', 'Return to your session'); b.type = 'button'; b.onclick = () => go(s, b);
            actions.append(b);
        } else {
            const join = h('button', 'btn btn-primary btn-sm', s.full ? 'Full' : s.kind === 'private' ? `Join · ${s.fee} coins` : 'Join'); join.type = 'button'; join.disabled = Boolean(s.full);
            join.onclick = async () => {
                if (s.kind === 'private') {
                    if (!ctx.signedIn() && !(await ctx.signIn())) return;
                    if (!confirm(`Join “${s.title}” for ${s.fee} coins? The coins go to the host and are not refunded.`)) return;
                }
                go(s, join);
            };
            actions.append(join);
            if (s.kind === 'public') {
                const gift = h('button', 'btn btn-ghost btn-sm', 'Send a gift'); gift.type = 'button';
                gift.onclick = () => openGiftPicker(s);
                actions.append(gift);
            }
        }
        c.append(head, tags, actions);
        return c;
    }
    async function go(s, btn) {
        btn.disabled = true;
        try { await enter(s); } finally { btn.disabled = false; }
    }

    let giftBox = null;
    function openGiftPicker(s) {
        giftBox?.remove();
        giftBox = h('div', 'live-gift-box');
        giftBox.append(h('b', '', `Send a gift to ${s.hostName}`), h('p', 'hint', `The host keeps ${HOST_SHARE_PCT}% of every gift. Your coins: ${ctx.coins?.get() ?? '…'}`));
        const grid = h('div', 'sticker-grid live-gift-grid');
        for (const g of GIFTS) {
            const b = h('button', 'sticker-item'); b.type = 'button'; b.title = `${g.label} · ${g.coins} coins`; b.setAttribute('aria-label', b.title);
            const img = new Image(); img.src = stickerURL(g.id); img.alt = ''; img.draggable = false;
            b.append(img, h('small', '', String(g.coins)));
            b.onclick = async () => {
                if (!ctx.signedIn() && !(await ctx.signIn())) return;
                b.disabled = true;
                try {
                    const r = await api().call('sendLiveGift', { sid: s.sid, gift: g.id, nick: ctx.nick() });
                    ctx.coins?.set(r.coins);
                    ctx.toast(`You sent a ${g.label} to ${s.hostName}.`);
                    giftBox?.remove(); giftBox = null;
                } catch (e) {
                    if (/failed-precondition/.test(e.code || '') && /coins/i.test(e.message || '')) { ctx.toast('You need more coins for that gift.', true); ctx.coins?.openShop(); } else fail(e);
                } finally { b.disabled = false; }
            };
            grid.appendChild(b);
        }
        const close = h('button', 'btn btn-ghost btn-sm', 'Close'); close.type = 'button'; close.onclick = () => { giftBox?.remove(); giftBox = null; };
        giftBox.append(grid, close);
        pane.prepend(giftBox);
        giftBox.scrollIntoView?.({ block: 'nearest' });
    }

    // ------------------------------------------------------------------ hosting
    function field(label, node, help) {
        const w = h('div', 'live-field');
        const l = h('label', '', label);
        w.append(l, node);
        if (help) w.append(h('small', '', help));
        return w;
    }
    const input = (id, attrs = {}) => { const i = h('input', 'input'); i.id = id; Object.assign(i, attrs); i.autocomplete = 'off'; return i; };

    function goLiveForm() {
        const c = card('Go live', `Anyone can host: no application needed. Going live costs ${LIVE_START_FEE} coins. Public sessions are free for guests; in a private session each guest pays ${PRIVATE_FEE} coins and you keep ${HOST_SHARE_PCT}% (${Math.floor(PRIVATE_FEE * HOST_SHARE_PCT / 100)} coins).`);
        const hostNameInput = input('liveName', { maxLength: 20, placeholder: 'The name people see' });
        hostNameInput.value = (me?.name || ctx.nick() || '').slice(0, 20);
        const title = input('liveTitle', { maxLength: MAX_TITLE, placeholder: 'e.g. Hindi song night' });
        const problem = h('small', 'live-problem');
        title.oninput = () => { problem.textContent = title.value.trim() ? titleProblem(title.value) : ''; };
        const mode = h('select', 'input'); mode.id = 'liveMode';
        mode.append(new Option('Voice (up to 8 people)', 'voice'), new Option('Video (up to 4 people)', 'video'));
        const kind = h('select', 'input'); kind.id = 'liveKind';
        kind.append(new Option('Public: anyone can join, free', 'public'), new Option(`Private: guests pay ${PRIVATE_FEE} coins`, 'private'));
        const guests = h('select', 'input'); guests.id = 'liveGuests';
        const fillGuests = () => { const max = mode.value === 'video' ? 3 : 7; guests.replaceChildren(...Array.from({ length: max }, (_, i) => new Option(i === 0 ? '1 guest (one to one)' : `${i + 1} guests`, String(i + 1)))); };
        fillGuests();
        const guestsRow = field('Guests in a private session', guests);
        const sync = () => { guestsRow.classList.toggle('hidden', kind.value !== 'private'); };
        mode.onchange = () => { fillGuests(); }; kind.onchange = sync; sync();
        const go = h('button', 'btn btn-primary', `Go live · ${LIVE_START_FEE} coins`); go.type = 'button';
        go.onclick = async () => {
            const bad = titleProblem(title.value);
            if (bad) { problem.textContent = bad; title.focus(); return; }
            go.disabled = true;
            await ctx.coins?.refresh();      // the balance shown may be old (coins added or spent on another device)
            if (ctx.coins?.get() != null && ctx.coins.get() < LIVE_START_FEE) { ctx.toast(`Going live costs ${LIVE_START_FEE} coins. Add coins first.`, true); ctx.coins.openShop(); go.disabled = false; return; }
            try {
                const r = await api().call('startLive', { name: hostNameInput.value, avatar: ctx.avatar(), title: title.value, mode: mode.value, kind: kind.value, ...(kind.value === 'private' ? { maxGuests: Number(guests.value) } : {}) });
                await enter({ sid: r.sid, mode: mode.value, title: title.value, kind: kind.value, host: true });
            } catch (e) { if (/failed-precondition/.test(e?.code || '') && /coins/i.test(e.message || '')) { fail(e); ctx.coins?.openShop(); } else fail(e); }
            finally { go.disabled = false; }
        };
        c.append(field('Your name in the session', hostNameInput), field('Title', title), problem, field('Type', mode), field('Who can join', kind), guestsRow, go);
        return c;
    }

    function earningsCard() {
        const c = card('Your earnings', `You earn ${HOST_SHARE_PCT}% of every gift and private-session fee. We pay you by UPI or bank transfer on request (from ${MIN_PAYOUT_COINS} earned coins).`);
        const tiles = h('div', 'live-tiles');
        const tile = (label, value, sub) => { const t = h('div', 'live-tile'); t.append(h('small', '', label), h('b', '', value)); if (sub) t.append(h('small', '', sub)); return t; };
        tiles.append(tile('Ready to pay out', `${me.coins} coins`, rupees(me.paise)), tile('Payout in progress', `${me.pendingCoins} coins`, rupees(me.pendingCoins * me.coinPaise)), tile('Paid to you', `${me.paidOutCoins} coins`, rupees(me.paidOutCoins * me.coinPaise)));
        c.append(tiles);
        const details = input('payDetails', { maxLength: 120, placeholder: 'Your UPI ID or bank account details' });
        const ask = h('button', 'btn btn-primary btn-sm', 'Ask for a payout'); ask.type = 'button';
        ask.disabled = me.coins < MIN_PAYOUT_COINS;
        ask.onclick = async () => {
            ask.disabled = true;
            try { const r = await api().call('requestPayout', { details: details.value }); ctx.toast(`Payout requested: ${rupees(r.paise)}. We’ll pay you and mark it done here.`); await load(); }
            catch (e) { fail(e); ask.disabled = false; }
        };
        if (me.coins < MIN_PAYOUT_COINS) c.append(h('p', 'hint', `You can ask for a payout from ${MIN_PAYOUT_COINS} coins. You have ${me.coins}.`));
        c.append(field('Pay me at', details, 'Only the admins see this.'), ask);
        if (me.payouts?.length) {
            const list = h('div', 'live-history');
            list.append(h('b', '', 'Payouts'));
            for (const p of me.payouts) list.append(h('div', 'live-line', `${new Date(p.at).toLocaleDateString()} · ${rupees(p.paise)} · ${p.status === 'requested' ? 'waiting for us' : p.status === 'paid' ? `paid${p.reference ? ' (ref ' + p.reference + ')' : ''}` : 'rejected, coins returned'}`));
            c.append(list);
        }
        return c;
    }

    function hostSection() {
        if (!ctx.signedIn()) {
            const c = card('Host a live session', `Anyone can host: sign in with Google, then go live for ${LIVE_START_FEE} coins. You can also join private sessions and send gifts once you’re signed in.`);
            const b = h('button', 'btn btn-primary btn-sm', 'Sign in with Google'); b.type = 'button'; b.onclick = async () => { if (await ctx.signIn()) load(); };
            c.append(b);
            return [c];
        }
        if (!me) return [card('Host a live session', 'Couldn’t load your host details. Try again in a moment.')];
        if (me.status === 'suspended') return [card('Hosting is paused', 'Hosting is paused for your account. Contact us if you think this is a mistake.'), earningsCard()];
        return [goLiveForm(), earningsCard()];
    }

    // ------------------------------------------------------------------ page
    let built = false;
    let listBox = null, hostBox = null, coinChip = null;
    function renderList() {
        if (!listBox) return;
        listBox.replaceChildren(...(sessions.length ? sessions.map(sessionCard) : [h('div', 'empty', 'Nobody is live right now. Check back soon, or host one yourself.')]));
        if (coinChip) coinChip.textContent = ctx.coins?.get() == null ? '' : `${ctx.coins.get()} coins`;
    }
    function render() {
        if (!opened) return;
        const keepGift = giftBox;
        const head = h('div', 'live-bar');
        coinChip = h('span', 'coin-chip', ctx.coins?.get() == null ? '' : `${ctx.coins.get()} coins`);
        const get = h('button', 'btn btn-ghost btn-sm', 'Get coins'); get.type = 'button'; get.onclick = () => ctx.coins?.openShop();
        const refresh = h('button', 'btn btn-ghost btn-sm', 'Refresh'); refresh.type = 'button'; refresh.onclick = () => load();
        head.append(h('b', '', 'Live now'), coinChip, get, refresh);
        listBox = h('div', 'live-list');
        hostBox = h('div', 'live-host');
        hostBox.append(...hostSection());
        pane.replaceChildren(...(keepGift ? [keepGift] : []), head, listBox, h('b', 'live-h2', 'Hosting'), hostBox);
        built = true;
        renderList();
    }

    return {
        open() { opened = true; built = false; meKey = ''; clearInterval(timer); load(); timer = setInterval(() => { if (!giftBox && document.visibilityState !== 'hidden') load(true); }, 15000); },
        pause() { clearInterval(timer); timer = 0; },
        refresh() { if (opened) load(); },
    };
}
