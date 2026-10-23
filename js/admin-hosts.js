// The Hosts tab of the admin page: how much live sessions are used and what they earn, what is live now, hosts and their earnings, and payout requests.
// Everything comes from the `adminHosts` function (functions/live.js). You pay hosts by hand (UPI or bank) and record the reference here.
// Everything from users is shown with textContent.
const rupees = paise => '₹' + (Math.round((Number(paise) || 0) / 100)).toLocaleString('en-IN');

export function createHosts({ $, h, toast, button, empty, kv, when, short, fn }) {
    let data = null;
    let busy = false;
    const call = async (action, payload = {}) => (await fn({ action, ...payload })).data;

    async function load() {
        if (busy) return;
        busy = true;
        const box = $('hostsBody');
        if (!data) box.replaceChildren(empty('Loading…'));
        try { data = await call('list'); render(); } catch (e) { console.error(e); box.replaceChildren(empty(e?.message || 'Could not load.')); } finally { busy = false; }
    }

    async function act(btn, action, payload, done) {
        btn.disabled = true;
        try { await call(action, payload); toast(done); data = await call('list'); render(); } catch (e) { console.error(e); toast(e.message || 'That didn’t work.', true); btn.disabled = false; }
    }

    function section(title, sub) {
        const s = h('div', 'card');
        s.append(h('b', '', title));
        if (sub) s.append(h('p', 'help', sub));
        return s;
    }

    function hostItem(x) {
        const item = h('div', 'item');
        const head = h('div', 'item-head');
        head.append(h('span', 'pill ' + (x.status === 'active' ? 'approved' : 'rejected'), x.status === 'active' ? 'Active' : 'Suspended'), h('b', '', x.name || short(x.uid)), x.lastLiveAt ? h('span', '', `last live ${when(x.lastLiveAt)}`) : h('span'));
        const owed = x.coins * data.coinPaise;
        item.append(head, kv([
            ['Owed to host', `${x.coins} coins · ${rupees(owed)}`], ['Payout pending', x.pending ? `${x.pending} coins · ${rupees(x.pending * data.coinPaise)}` : ''],
            ['Paid out', x.paidOut ? `${x.paidOut} coins · ${rupees(x.paidOut * data.coinPaise)}` : ''], ['Earned in total', `${x.lifetime} coins`], ['Google e-mail', x.email], ['User', short(x.uid), x.uid],
        ]));
        const actions = h('div', 'actions');
        const note = h('input', 'input'); note.placeholder = 'Reason (optional)'; note.maxLength = 200;
        if (x.status === 'active') actions.append(note, button('Suspend', 'btn btn-danger btn-sm', b => { if (confirm(`Suspend ${x.name}? Their live session ends and they cannot host until you reinstate them.`)) act(b, 'decide', { uid: x.uid, decision: 'suspend', note: note.value }, `${x.name} is suspended.`); }));
        else actions.append(note, button('Reinstate', 'btn btn-primary btn-sm', b => act(b, 'decide', { uid: x.uid, decision: 'reinstate', note: note.value }, `${x.name} can host again.`)));
        item.appendChild(actions);
        return item;
    }

    function payoutItem(p, nameOf) {
        const item = h('div', 'item');
        const head = h('div', 'item-head');
        head.append(h('span', 'pill ' + (p.status === 'requested' ? 'open' : p.status === 'paid' ? 'approved' : 'rejected'), p.status === 'requested' ? 'To pay' : p.status === 'paid' ? 'Paid' : 'Rejected'), h('b', '', `${nameOf(p.uid)} · ${rupees(p.paise)}`), h('span', '', `${p.coins} coins · asked ${when(p.at)}`));
        item.append(head, kv([['Pay to', p.details], ['Reference', p.status === 'paid' ? p.reference : ''], ['Handled by', p.status !== 'requested' ? p.paidBy : ''], ['Handled', p.status !== 'requested' ? when(p.paidAt) : '']]));
        if (p.status === 'requested') {
            const ref = h('input', 'input'); ref.placeholder = 'UPI / bank reference of your payment'; ref.maxLength = 80;
            const actions = h('div', 'actions');
            actions.append(ref,
                button('Mark as paid', 'btn btn-primary btn-sm', b => { if (!ref.value.trim()) { toast('Enter the reference of the payment you made first.', true); return; } act(b, 'payoutPaid', { id: p.id, reference: ref.value }, 'Marked as paid.'); }),
                button('Reject', 'btn btn-ghost btn-sm', b => { if (confirm('Reject this payout? The coins go back to the host.')) act(b, 'payoutReject', { id: p.id, note: ref.value }, 'Payout rejected. The coins are back with the host.'); }));
            item.appendChild(actions);
        }
        return item;
    }

    const usageRow = (label, u, infraPaise, coinPaise) => {
        const income = (u.liveFeeCoins + u.platformShareCoins) * coinPaise;
        const cost = Math.round((u.liveParticipantMinutes / 60) * infraPaise);
        const row = h('tr');
        row.append(h('td', '', label), h('td', '', String(u.liveStarts)), h('td', '', (u.liveMinutes / 60).toFixed(1)), h('td', '', (u.liveParticipantMinutes / 60).toFixed(1)),
            h('td', '', `${u.privateJoins} · ${u.liveGifts}`), h('td', '', rupees(income)), h('td', '', rupees(u.hostShareCoins * coinPaise)), h('td', '', rupees(cost)), h('td', '', rupees(income - cost)));
        return row;
    };

    function usageCard() {
        const c = section('Usage and margin', 'How much live sessions are used and what they earn you. Income is the 49-coin start fees plus your 30% of gifts and private seats, valued at ₹' + data.coinPaise / 100 + ' a coin. Cost is an estimate (₹' + data.infraPaise / 100 + ' per person per hour in a room: database and relay).');
        const table = h('table', 'grid-table');
        const head = h('tr');
        for (const t of ['Period', 'Sessions', 'Live hours', 'People hours', 'Private seats · gifts', 'Your income', 'Owed to hosts', 'Est. cost', 'Margin']) head.appendChild(h('th', '', t));
        const thead = h('thead'); thead.appendChild(head);
        const body = h('tbody');
        body.append(usageRow('Today', data.usage.today, data.infraPaise, data.coinPaise), usageRow('7 days', data.usage.d7, data.infraPaise, data.coinPaise), usageRow('30 days', data.usage.d30, data.infraPaise, data.coinPaise));
        table.append(thead, body);
        const wrap = h('div', 'table-wrap'); wrap.appendChild(table);
        c.append(wrap);
        return c;
    }

    function liveItem(x) {
        const item = h('div', 'item');
        const head = h('div', 'item-head');
        head.append(h('span', 'pill ' + (x.kind === 'private' ? 'all' : 'approved'), x.kind === 'private' ? 'Private' : 'Public'), h('b', '', x.title), h('span', '', `by ${x.hostName} · ${x.mode} · started ${when(x.created)}`));
        const actions = h('div', 'actions');
        actions.append(button('End this session', 'btn btn-danger btn-sm', b => { if (confirm('End this live session now?')) act(b, 'end', { sid: x.sid }, 'Session ended.'); }));
        item.append(head, actions);
        return item;
    }

    function render() {
        if (!data) return;
        const box = $('hostsBody');
        const hosts = data.hosts;
        const names = new Map(hosts.map(x => [x.uid, x.name]));
        const nameOf = uid => names.get(uid) || short(uid);
        const toPay = data.payouts.filter(p => p.status === 'requested');
        $('countHosts').textContent = toPay.length;

        const top = h('div', 'tiles');
        const tile = (label, value, sub) => { const t = h('div', 'tile'); t.append(h('span', 'tile-label', label), h('b', 'tile-value', value)); if (sub) t.append(h('span', 'tile-sub', sub)); return t; };
        const owedAll = hosts.reduce((a, x) => a + x.coins + x.pending, 0);
        top.append(tile('Live now', String(data.liveNow), 'sessions running'), tile('Hosts', String(hosts.length), 'have gone live'), tile('Payouts to make', String(toPay.length), rupees(toPay.reduce((a, p) => a + p.paise, 0))), tile('You owe hosts', rupees(owedAll * data.coinPaise), `${owedAll} earned coins`));

        const s0 = section('Live now', 'Anyone can go live for 49 coins. End a session here if something is wrong.');
        s0.append(...(data.live.length ? data.live.map(liveItem) : [empty('Nothing is live right now.')]));
        const s2 = section('Payout requests', `You pay these by hand (UPI or bank) and record the reference. An earned coin is worth ₹${data.coinPaise / 100}; the smallest payout is ${data.minPayoutCoins} coins. Check the host before you pay.`);
        s2.append(...(data.payouts.length ? data.payouts.map(p => payoutItem(p, nameOf)) : [empty('No payout requests yet.')]));
        const s3 = section('Hosts', 'Everyone who has gone live, with what they earned from gifts and private sessions (their 70% share). Suspend someone to end their session and stop them hosting.');
        s3.append(...(hosts.length ? hosts.map(hostItem) : [empty('Nobody has hosted yet.')]));
        box.replaceChildren(top, usageCard(), s0, s2, s3);
    }

    return {
        show() { if (data) render(); load(); },
        refresh() { return load(); },
        /** Loads quietly (for the number on the tab). */
        async badge() { try { data = await call('list'); $('countHosts').textContent = data.payouts.filter(p => p.status === 'requested').length; } catch { /* the tab shows the error when opened */ } },
    };
}
