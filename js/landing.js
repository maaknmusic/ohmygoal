// Landing page behaviour. Presentation only: it never reads or writes app state.
//   - scroll reveal, smooth anchor scrolling with a header offset
//   - the mobile sticky Start bar (#stickyStart) and a nudge when Start is still locked
//   - the hero mockup loop (floating reactions, a game that plays itself)
//   - small a11y/mirroring helpers (aria-pressed on the mode picker, online count copies)
// Nothing here uses innerHTML. Call initLanding() once after the page markup is in the DOM.

const REACTIONS = ['❤️', '😂', '🔥', '👏', '🙏', '😮'];
// A tic-tac-toe game that ends with a win on the 2-4-6 diagonal. 'x' is "you".
const GAME_MOVES = [[0, 'x'], [1, 'o'], [4, 'x'], [8, 'o'], [6, 'x'], [3, 'o'], [2, 'x']];
const WIN_LINE = [2, 4, 6];
const MARKS = { x: '✕', o: '○' };

const $ = (root, sel) => root.querySelector(sel);

export function initLanding() {
    const root = document.getElementById('welcome');
    if (!root || root.dataset.lpReady) return;
    root.dataset.lpReady = '1';
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)');

    const safe = fn => { try { fn(); } catch (err) { console.warn('[landing]', err); } };
    safe(() => setupReveal(root, reduce));
    safe(() => setupAnchors(root, reduce));
    safe(() => setupSticky(root));
    safe(() => setupModeA11y(root));
    safe(() => setupOnlineMirror(root));
    safe(() => setupMock(root, reduce));
}

/* ---------- Scroll reveal ---------- */
function setupReveal(root, reduce) {
    const items = [...root.querySelectorAll('.reveal')];
    if (reduce.matches || !('IntersectionObserver' in window)) { items.forEach(el => el.classList.add('in')); return; }
    const vh = window.innerHeight || 800;
    const rest = [];
    items.forEach(el => (el.getBoundingClientRect().top < vh * 0.9 ? el.classList.add('in') : rest.push(el)));
    root.classList.add('lp-js'); // content stays fully visible until this class is present
    if (!rest.length) return;
    const io = new IntersectionObserver(entries => {
        entries.forEach(en => { if (en.isIntersecting) { en.target.classList.add('in'); io.unobserve(en.target); } });
    }, { rootMargin: '0px 0px -8% 0px', threshold: 0.06 });
    rest.forEach(el => io.observe(el));
    // Safety net: never leave something hidden if the observer stalls (e.g. a hidden tab for a long time).
    setTimeout(() => rest.forEach(el => el.classList.add('in')), 12000);
}

/* ---------- Anchors with a sticky-header offset ---------- */
function headerOffset() {
    const bar = document.querySelector('.topbar, header.topbar, body > header');
    if (!bar) return 0;
    const pos = getComputedStyle(bar).position;
    return pos === 'sticky' || pos === 'fixed' ? Math.round(bar.getBoundingClientRect().height) : 0;
}

function setupAnchors(root, reduce) {
    const syncOffset = () => root.style.setProperty('--lp-nav', headerOffset() + 'px');
    syncOffset();
    window.addEventListener('resize', syncOffset, { passive: true });

    const scrollTo = target => {
        const top = target.getBoundingClientRect().top + window.scrollY - headerOffset() - 8;
        window.scrollTo({ top: Math.max(0, top), behavior: reduce.matches ? 'auto' : 'smooth' });
    };
    root.lpScrollTo = scrollTo;

    document.addEventListener('click', e => {
        const a = e.target.closest?.('a[href^="#"]');
        if (!a || e.defaultPrevented || e.button || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
        const id = decodeURIComponent(a.getAttribute('href').slice(1));
        const target = id && document.getElementById(id);
        if (!target || !root.contains(target)) return;
        e.preventDefault();
        scrollTo(target);
        if (a.hasAttribute('data-start-link')) {
            // Carry the person to the next thing they have to do.
            const consent = $(root, '#ageCheck'), start = $(root, '#startBtn');
            setTimeout(() => ((consent && !consent.checked ? consent : start) || target).focus({ preventScroll: true }), reduce.matches ? 0 : 450);
        } else {
            if (!target.hasAttribute('tabindex')) target.setAttribute('tabindex', '-1');
            target.focus({ preventScroll: true });
        }
    });
}

/* ---------- Sticky start bar + locked-start nudge ---------- */
function setupSticky(root) {
    const start = $(root, '#startBtn'), bar = $(root, '#stickyStart'), btn = $(root, '#stickyStartBtn');
    const consent = $(root, '#ageCheck'), card = $(root, '#start'), cta = $(root, '#cta');
    if (!start || !bar || !btn) return;

    const state = { startOut: false, ctaIn: false };
    const apply = () => bar.classList.toggle('show', state.startOut && !state.ctaIn);
    if ('IntersectionObserver' in window) {
        new IntersectionObserver(([en]) => { state.startOut = !en.isIntersecting; apply(); }).observe(start);
        if (cta) new IntersectionObserver(([en]) => { state.ctaIn = en.isIntersecting; apply(); }, { rootMargin: '0px 0px -20% 0px' }).observe(cta);
    }

    // Keep the bar's label in step with the real button ("Connecting…" etc.).
    const mirror = () => {
        if (btn.textContent !== start.textContent) btn.textContent = start.textContent;
        const busy = start.disabled && (!consent || consent.checked);
        btn.setAttribute('aria-disabled', busy ? 'true' : 'false');
    };
    new MutationObserver(mirror).observe(start, { childList: true, characterData: true, subtree: true, attributes: true, attributeFilter: ['disabled'] });
    consent?.addEventListener('change', mirror);
    mirror();

    // Start is locked until the consent box is ticked: point at the box instead of doing nothing.
    const nudge = () => {
        const label = consent?.closest('.lp-consent');
        if (!label) return;
        label.classList.remove('nudge');
        void label.offsetWidth;
        label.classList.add('nudge');
        consent.focus({ preventScroll: true });
    };
    $(root, '.lp-start-wrap')?.addEventListener('click', () => { if (start.disabled && consent && !consent.checked) nudge(); });
    btn.addEventListener('click', () => {
        if (start.disabled && consent && !consent.checked) {
            root.lpScrollTo?.(card || start);
            setTimeout(nudge, 350);
        }
    });
}

/* ---------- aria-pressed on the Video/Text picker (the app toggles .active) ---------- */
function setupModeA11y(root) {
    const segs = [...root.querySelectorAll('.segmented .seg')];
    const sync = () => segs.forEach(b => b.setAttribute('aria-pressed', b.classList.contains('active') ? 'true' : 'false'));
    const mo = new MutationObserver(sync);
    segs.forEach(b => mo.observe(b, { attributes: true, attributeFilter: ['class'] }));
    sync();
}

/* ---------- Copy the live count (#onlineCount) to any [data-online-count] on the page ---------- */
function setupOnlineMirror(root) {
    const src = document.getElementById('onlineCount');
    const targets = [...root.querySelectorAll('[data-online-count]')];
    if (!src || !targets.length) return;
    const pill = src.closest('.online-pill');
    const lines = targets.map(t => t.closest('.lp-cta-live') || t);
    const sync = () => {
        const txt = src.textContent.trim();
        const ready = txt && txt !== '…' && !pill?.classList.contains('hidden');
        targets.forEach(t => { t.textContent = txt; });
        lines.forEach(l => { l.hidden = !ready; });
    };
    const mo = new MutationObserver(sync);
    mo.observe(src, { childList: true, characterData: true, subtree: true });
    if (pill) mo.observe(pill, { attributes: true, attributeFilter: ['class'] });
    sync();
}

/* ---------- Hero mockup: floating reactions + a game that plays itself ---------- */
function setupMock(root, reduce) {
    const mock = $(root, '.lp-mock');
    if (!mock || reduce.matches) return; // reduced motion keeps the static frame
    const reacts = $(mock, '[data-reacts]');
    const cells = [...mock.querySelectorAll('[data-board] i')];
    const turnEl = $(mock, '[data-game-turn]'), noteEl = $(mock, '[data-game-note]');
    const timers = { react: 0, game: 0 };
    let running = false, onScreen = true;

    const rand = (a, b) => a + Math.random() * (b - a);
    const setText = (el, t) => { if (el) el.textContent = t; };

    function spawnReaction() {
        if (!reacts) return;
        $(reacts, '.lp-react--still')?.remove();
        if (reacts.children.length >= 4) return;
        const r = document.createElement('span');
        r.className = 'lp-react';
        r.textContent = REACTIONS[Math.floor(Math.random() * REACTIONS.length)];
        r.style.setProperty('--dx', Math.round(rand(-34, 34)) + 'px');
        r.style.left = Math.round(rand(-26, 26)) + 'px';
        r.addEventListener('animationend', () => r.remove(), { once: true });
        reacts.appendChild(r);
    }
    const reactLoop = () => { spawnReaction(); timers.react = setTimeout(reactLoop, rand(1300, 2600)); };

    let step = 0;
    function resetBoard() {
        cells.forEach(c => { c.className = ''; c.textContent = ''; });
        step = 0;
        setText(turnEl, 'Your turn');
        setText(noteEl, "You're ✕");
    }
    function gameLoop() {
        if (step >= GAME_MOVES.length) {
            resetBoard();
            timers.game = setTimeout(gameLoop, 900);
            return;
        }
        const [idx, mark] = GAME_MOVES[step++];
        const cell = cells[idx];
        if (cell) { cell.textContent = MARKS[mark]; cell.className = mark + ' pop'; }
        if (step === GAME_MOVES.length) {
            WIN_LINE.forEach(i => cells[i]?.classList.add('win'));
            setText(turnEl, 'You won 🎉');
            setText(noteEl, 'Rematch?');
            timers.game = setTimeout(gameLoop, 3000);
        } else {
            setText(turnEl, mark === 'x' ? 'Their turn…' : 'Your turn');
            timers.game = setTimeout(gameLoop, rand(1000, 1500));
        }
    }

    function start() {
        if (running || !onScreen || document.hidden) return;
        running = true;
        $(reacts || mock, '.lp-react--still')?.remove();
        if (cells.length === 9 && step === 0) resetBoard();
        timers.react = setTimeout(reactLoop, 700);
        timers.game = setTimeout(gameLoop, 1100);
    }
    function stop() {
        running = false;
        clearTimeout(timers.react); clearTimeout(timers.game);
    }

    document.addEventListener('visibilitychange', () => {
        root.classList.toggle('lp-paused', document.hidden);
        document.hidden ? stop() : start();
    });
    const hero = $(root, '.lp-hero');
    if ('IntersectionObserver' in window) {
        new IntersectionObserver(([en]) => {
            onScreen = en.isIntersecting;
            hero?.classList.toggle('lp-off', !onScreen);
            onScreen ? start() : stop();
        }, { threshold: 0.05 }).observe(mock);
    }
    start();
}
