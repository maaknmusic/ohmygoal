// Shared UI helpers: bottom sheets (focus trap, Esc, backdrop) wired through data attributes.
//   <button data-sheet-open="prefsSheet">  opens #prefsSheet
//   <button data-sheet-close>              closes the sheet it is inside
// Sheet markup: .sheet-bg#id[role=dialog][aria-modal] > .sheet > .sheet-head / .sheet-body / .sheet-foot
const stack = [];
const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

const byId = id => (typeof id === 'string' ? document.getElementById(id) : id);

/** Forget sheets that other code hid directly, so they can be opened again. */
function prune() {
    for (let i = stack.length - 1; i >= 0; i--) if (stack[i].bg.classList.contains('hidden')) stack.splice(i, 1);
}

export function openSheet(id) {
    const bg = byId(id);
    if (!bg) return;
    prune();
    if (stack.some(s => s.bg === bg)) return;
    stack.push({ bg, from: document.activeElement });
    bg.classList.remove('hidden');
    bg.dispatchEvent(new CustomEvent('sheet:open'));
    const first = bg.querySelector('[data-autofocus]') || bg.querySelector(FOCUSABLE);
    first?.focus({ preventScroll: true });
}

export function closeSheet(id) {
    const bg = byId(id);
    const i = stack.findIndex(s => s.bg === bg);
    if (i < 0) { bg?.classList.add('hidden'); return; }
    const [{ from }] = stack.splice(i, 1);
    bg.classList.add('hidden');
    bg.dispatchEvent(new CustomEvent('sheet:close'));
    if (from && document.contains(from)) from.focus({ preventScroll: true });
}

export const topSheet = () => { prune(); return stack.at(-1)?.bg || null; };
export const anySheetOpen = () => { prune(); return stack.length > 0; };
export function closeAllSheets() { [...stack].reverse().forEach(s => closeSheet(s.bg)); }

document.addEventListener('click', e => {
    const opener = e.target.closest?.('[data-sheet-open]');
    if (opener) { e.preventDefault(); openSheet(opener.dataset.sheetOpen); return; }
    if (e.target.closest?.('[data-sheet-close]')) {
        const bg = e.target.closest('.sheet-bg');
        if (bg) closeSheet(bg);
        return;
    }
    // A click on the dimmed backdrop itself closes the sheet.
    if (e.target.classList?.contains('sheet-bg') && stack.some(s => s.bg === e.target)) closeSheet(e.target);
});

// Capture phase: the open sheet gets Esc and Tab first, so chat shortcuts (Esc = next) never fire behind it.
document.addEventListener('keydown', e => {
    const top = topSheet();
    if (!top) return;
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeSheet(top); return; }
    if (e.key !== 'Tab') return;
    const items = [...top.querySelectorAll(FOCUSABLE)].filter(x => x.offsetParent !== null);
    if (!items.length) return;
    const first = items[0], last = items.at(-1);
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
}, true);
