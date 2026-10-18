// In-chat games UI: picker, invite card, one board per game, result + rematch.
// Drives a game session (engine.js) over the chat's data channel. Everything the other person
// sends reaches the DOM only through textContent (see h()).
import { createGameSession } from './engine.js';
import { GAMES } from './index.js';

function h(tag, cls, text) {
    const node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text != null) node.textContent = text;
    return node;
}
function btn(cls, text, onclick, label) {
    const b = h('button', cls, text);
    b.type = 'button';
    if (label) b.setAttribute('aria-label', label);
    b.onclick = onclick;
    return b;
}

const RPS = { stone: ['🪨', 'Stone'], paper: ['📄', 'Paper'], scissors: ['✂️', 'Scissors'] };

/**
 * send(obj): data channel send. say(text, kind): chat system line. getContainer(): element to draw into.
 * getName(): partner's name. attention(kind): a hook for sounds / highlighting the games button.
 */
export function createGamesUi({ send, say, getContainer, getName, attention }) {
    let pickerOpen = false;
    let dismissed = false;
    let quitArmedUntil = 0;
    let tick = null;
    let call = 'odd';               // hand cricket: the caller's odd/even choice
    let lastPhase = 'idle';
    let lastView = null;
    const root = h('div', 'game-card');
    root.setAttribute('role', 'group');

    const session = createGameSession({
        me: 'A',
        send,
        onChange: v => { handleChange(v); render(v); },
    });

    function handleChange(v) {
        if (v.phase !== lastPhase) {
            if (v.phase === 'invited') { dismissed = false; attention?.('invite'); }
            if (v.phase === 'over') {
                const won = v.status?.winner === v.me, tie = v.status?.winner === 'draw';
                say?.(`${v.game.emoji} ${v.game.name}: ${tie ? 'a draw' : won ? 'you won!' : `${getName()} won`}`, tie ? '' : won ? 'good' : '');
            }
            if (v.phase === 'idle' && lastPhase !== 'idle' && v.lastEvent) say?.(v.lastEvent);
            if (v.phase === 'playing' && lastPhase !== 'playing') dismissed = false;
            lastPhase = v.phase;
        }
        if (v.phase === 'over' && v.rematch === 'them' && lastView?.rematch !== 'them') { dismissed = false; attention?.('rematch'); }
        lastView = v;
    }

    // ----- shell -----
    function mount() {
        const c = getContainer();
        if (root.parentElement !== c) c.appendChild(root);
        for (const other of document.querySelectorAll('#gameStage, #gameDock')) {
            if (other !== c) other.classList.add('hidden');
        }
        return c;
    }

    function seconds(ms) { return Math.max(0, Math.ceil(ms / 1000)); }

    function render(v = session.state()) {
        if (!v) return;
        const c = mount();
        const idleLike = v.phase === 'idle' || v.phase === 'over';
        const show = pickerOpen && idleLike ? true : v.phase === 'idle' ? false : !(v.phase === 'over' && dismissed);
        c.classList.toggle('hidden', !show);
        clearInterval(tick);
        if (!show) return;
        root.replaceChildren();
        if (pickerOpen && idleLike) return drawPicker(v);
        drawHead(v);
        const body = h('div', 'gc-body');
        root.appendChild(body);
        if (v.phase === 'inviting') drawInviting(v, body);
        else if (v.phase === 'invited') drawInvited(v, body);
        else drawGame(v, body);
        if (v.deadline) {
            const timer = root.querySelector('[data-timer]');
            const upd = () => { if (timer) timer.textContent = `${seconds(v.deadline - Date.now())}s`; };
            upd();
            tick = setInterval(upd, 250);
        }
    }

    function drawHead(v) {
        const head = h('div', 'gc-head');
        head.append(h('span', 'gc-emoji', v.game.emoji), h('b', '', v.game.name), h('span', 'gc-timer', ''));
        head.lastChild.dataset.timer = '1';
        if (!v.deadline) head.lastChild.classList.add('hidden');
        // Quitting a running game takes two taps, so a stray tap doesn't hand your opponent the win.
        const armed = v.phase === 'playing' && Date.now() < quitArmedUntil;
        const close = btn('gc-x' + (armed ? ' armed' : ''), armed ? 'Quit?' : '×', () => {
            if (v.phase === 'playing') {
                if (Date.now() < quitArmedUntil) { quitArmedUntil = 0; session.forfeit(); return; }
                quitArmedUntil = Date.now() + 3000;
                setTimeout(render, 3050);
                render();
            } else if (v.phase === 'inviting' || v.phase === 'invited') session.decline();
            else { dismissed = true; render(); }
        }, armed ? 'Tap again to quit the game' : v.phase === 'playing' ? 'Quit the game' : 'Close');
        head.appendChild(close);
        root.appendChild(head);
    }

    // ----- lobby -----
    function drawPicker() {
        const head = h('div', 'gc-head');
        head.append(h('span', 'gc-emoji', '🎮'), h('b', '', 'Play a game'), btn('gc-x', '×', () => { pickerOpen = false; render(); }, 'Close'));
        const grid = h('div', 'gc-picker');
        for (const g of GAMES) {
            const tile = btn('gc-tile', '', () => { pickerOpen = false; session.invite(g.id); }, `Invite to ${g.name}`);
            tile.append(h('span', 'gc-tile-emoji', g.emoji), h('b', '', g.name), h('small', '', g.blurb));
            grid.appendChild(tile);
        }
        root.append(head, grid);
    }

    function drawInviting(v, body) {
        body.append(h('p', 'gc-line', `Waiting for ${getName()} to accept…`));
    }

    function drawInvited(v, body) {
        body.append(h('p', 'gc-line', `${getName()} invited you to play ${v.game.name}. ${v.game.blurb}`));
        const row = h('div', 'gc-row');
        row.append(btn('btn btn-primary btn-sm', 'Accept', () => session.accept()), btn('btn btn-ghost btn-sm', 'Decline', () => session.decline()));
        body.append(row);
    }

    // ----- playing -----
    function statusLine(v) {
        const who = v.status?.turn;
        if (v.phase === 'over') {
            const base = v.lastEvent || v.status?.summary || '';
            const w = v.status?.winner;
            if (/won|win|lost|draw|tie/i.test(base)) return base;
            return w === v.me ? `${base}. You win! 🎉` : w === v.you ? `${base}. ${getName()} wins.` : base;
        }
        if (v.game.simultaneous) {
            if (v.round?.iCommitted) return 'Waiting for them…';
            return v.round?.theyCommitted ? 'They’ve picked. Your turn!' : 'Pick now: both reveal together';
        }
        return who === v.me ? 'Your turn' : `${getName()}’s turn`;
    }

    function drawGame(v, body) {
        const line = h('p', 'gc-status' + (v.canMove ? ' mine' : ''), statusLine(v));
        const draw = { tictactoe: drawTtt, connect4: drawC4, rps: drawRps, handcricket: drawCricket, wordchain: drawWord }[v.game.id];
        body.append(line);
        if (draw) draw(v, body);
        if (v.phase === 'over') {
            const row = h('div', 'gc-row');
            const pending = v.rematch === 'you';
            const rm = btn('btn btn-primary btn-sm', pending ? 'Waiting…' : v.rematch === 'them' ? 'Accept rematch' : 'Rematch', () => session.rematch());
            rm.disabled = pending;
            row.append(rm, btn('btn btn-ghost btn-sm', 'Pick another', () => { pickerOpen = true; dismissed = false; render(); }), btn('btn btn-ghost btn-sm', 'Close', () => { dismissed = true; render(); }));
            body.append(row);
        }
    }

    const mark = (v, who) => (who === v.me ? 'mine' : 'theirs');

    function drawTtt(v, body) {
        const grid = h('div', 'ttt');
        const win = new Set(v.state.line || []);
        v.state.board.forEach((who, i) => {
            const cell = btn('ttt-cell' + (who ? ' ' + mark(v, who) : '') + (win.has(i) ? ' win' : ''), who ? v.state.marks[who] : '', () => session.move(i), `Row ${Math.floor(i / 3) + 1}, column ${(i % 3) + 1}, ${who ? (who === v.me ? 'yours' : 'theirs') : 'empty'}`);
            cell.disabled = !v.canMove || Boolean(who);
            grid.appendChild(cell);
        });
        body.appendChild(grid);
    }

    function drawC4(v, body) {
        const COLS = 7, ROWS = 6;
        const win = new Set(v.state.line || []);
        const grid = h('div', 'c4');
        for (let c = 0; c < COLS; c++) {
            const col = btn('c4-col', '', () => session.move(c), `Drop in column ${c + 1} of ${COLS}`);
            col.disabled = !v.canMove || v.state.board[c] !== null;
            for (let r = 0; r < ROWS; r++) {
                const who = v.state.board[r * COLS + c];
                col.appendChild(h('span', 'disc' + (who ? ` ${v.state.marks[who]} ${mark(v, who)}` : '') + (win.has(r * COLS + c) ? ' win' : '')));
            }
            grid.appendChild(col);
        }
        body.appendChild(grid);
    }

    function score(v, mine, theirs) {
        return h('div', 'gc-score', `You ${mine} · ${theirs} ${getName()}`);
    }

    function drawRps(v, body) {
        body.appendChild(score(v, v.state.wins[v.me], v.state.wins[v.you]));
        const last = v.lastRound;
        if (last) {
            const lr = v.state.rounds.at(-1);
            const you = RPS[last[v.me]], them = RPS[last[v.you]];
            if (you && them) body.appendChild(h('div', 'gc-last', `${you[0]} vs ${them[0]}: ${lr?.winner === 'draw' ? 'tie, replay' : lr?.winner === v.me ? 'you take it' : 'they take it'}`));
        }
        if (v.phase === 'over') return;
        const row = h('div', 'gc-row center');
        for (const [id, [emoji, name]] of Object.entries(RPS)) {
            const b = btn('gc-pick', emoji, () => session.move(id), name);
            b.disabled = !v.canMove;
            b.title = name;
            row.appendChild(b);
        }
        body.appendChild(row);
    }

    function drawCricket(v, body) {
        const s = v.state;
        const pad = onPick => {
            const row = h('div', 'gc-row center wrap');
            for (let n = 1; n <= 6; n++) {
                const b = btn('gc-num', String(n), () => onPick(n), `Play ${n}`);
                b.disabled = !v.canMove;
                row.appendChild(b);
            }
            return row;
        };
        if (s.phase === 'toss') {
            const caller = s.caller === v.me;
            body.appendChild(h('p', 'gc-line', caller ? 'Toss: call odd or even, then pick a number 1 to 6. Odd or even decides who bats.' : `${getName()} calls the toss. Pick a number 1 to 6.`));
            if (caller) {
                const row = h('div', 'gc-row center');
                for (const c of ['odd', 'even']) row.appendChild(btn('gc-chip' + (call === c ? ' on' : ''), c === 'odd' ? 'Odd' : 'Even', () => { call = c; render(); }));
                body.appendChild(row);
            }
            if (v.phase === 'playing') body.appendChild(pad(n => session.move(caller ? { n, call } : { n })));
            return;
        }
        const bat = s.batter;
        const you = bat === v.me;
        const box = h('div', 'cricket-board');
        box.append(
            h('div', 'cb-line', `${you ? 'You bat' : `${getName()} bats`}: ${s.runs[bat]}/${s.wickets[bat]} · ${s.balls[bat]}/6 balls`),
        );
        if (s.innings === 2) box.append(h('div', 'cb-line sub', `Target ${s.target + 1}. ${bat === v.me ? 'You need' : 'They need'} ${Math.max(0, s.target + 1 - s.runs[bat])}`));
        const last = s.last;
        if (last) {
            const meBat = last.batter === v.me;
            const mineN = meBat ? last.bat : last.bowl, theirN = meBat ? last.bowl : last.bat;
            box.append(h('div', 'cb-last' + (last.out ? ' out' : ''), `You ${mineN} · ${theirN} ${getName()} → ${last.out ? 'OUT!' : `${last.runs} run${last.runs === 1 ? '' : 's'}`}`));
        }
        body.append(box);
        if (v.phase === 'playing') body.append(h('div', 'gc-line small', you ? 'You bat: pick a number. If you both pick the same, you’re out.' : 'You bowl: match their number to get them out.'), pad(n => session.move(n)));
    }

    function drawWord(v, body) {
        const s = v.state;
        body.appendChild(h('div', 'wc-hearts', `You ${'❤️'.repeat(Math.max(0, s.hearts[v.me]))}${'🖤'.repeat(Math.max(0, 3 - s.hearts[v.me]))} · ${getName()} ${'❤️'.repeat(Math.max(0, s.hearts[v.you]))}${'🖤'.repeat(Math.max(0, 3 - s.hearts[v.you]))}`));
        const need = h('div', 'wc-need');
        need.append(h('small', '', s.need ? 'Start with' : 'Any word to begin'), h('b', '', s.need ? s.need.toUpperCase() : '·'));
        body.appendChild(need);
        if (s.words.length) body.appendChild(h('div', 'wc-words', s.words.slice(-4).join(' → ')));
        if (s.last && !s.last.ok) body.appendChild(h('div', 'gc-last bad', `${s.last.player === v.me ? 'You' : getName()} lost a heart: ${s.last.reason}`));
        if (v.phase !== 'playing') return;
        const form = h('form', 'wc-form');
        const input = h('input', 'input');
        input.maxLength = 30; input.autocomplete = 'off'; input.placeholder = v.canMove ? 'Type a word…' : 'Their turn…'; input.disabled = !v.canMove;
        input.setAttribute('aria-label', 'Your word');
        const go = h('button', 'btn btn-primary btn-sm', 'Go');
        go.type = 'submit'; go.disabled = !v.canMove;
        form.onsubmit = e => { e.preventDefault(); const word = input.value.trim(); if (word) { input.value = ''; session.move({ word }); } };
        form.append(input, go);
        body.appendChild(form);
        // Only when nothing else is being typed in: the opponent's move must not steal the chat box's focus.
        if (v.canMove && !document.activeElement?.matches?.('input, textarea')) setTimeout(() => input.focus({ preventScroll: true }), 0);
    }

    // Time runs out for the side on turn in Word Chain: send the timeout claim.
    const watchdog = setInterval(() => {
        const v = lastView;
        if (!v || v.phase !== 'playing' || !v.deadline || v.game.id !== 'wordchain' || !v.canMove) return;
        if (Date.now() >= v.deadline) session.move({ timeout: true });
    }, 500);

    return {
        receive: msg => session.receive(msg),
        /** The games button: open the picker, or bring an existing game back. */
        toggle() {
            const v = session.state();
            if (v.phase === 'idle') pickerOpen = !pickerOpen;
            else { dismissed = false; pickerOpen = v.phase === 'over' ? !pickerOpen : false; }
            render();
        },
        isBusy: () => session.state()?.phase !== 'idle',
        /** Call when the chat container or mode changes. */
        refresh: () => render(),
        close() { pickerOpen = false; render(); },
        dispose() {
            clearInterval(tick);
            clearInterval(watchdog);
            session.dispose();
            root.remove();
            for (const c of document.querySelectorAll('#gameStage, #gameDock')) c.classList.add('hidden');
        },
    };
}
