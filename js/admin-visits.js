// Admin page → Visits: the visit log (functions/visits.js). The latest visits, or everything for one IP address, email, device or
// account, with the approximate place of each address. Tapping an address, device or account shows everything else it was seen with.
const FLAG = cc => (/^[A-Z]{2}$/.test(cc || '') ? String.fromCodePoint(...[...cc].map(c => 0x1F1E6 + c.charCodeAt(0) - 65)) : '');
const place = g => (g ? [[g.city, g.region].filter(Boolean).join(', '), g.country && `${FLAG(g.country)} ${g.country}`].filter(Boolean).join(' · ') : '');

export function createVisits({ $, h, toast, button, empty, when, short, call, act }) {
    let loaded = false, busy = false;

    async function search(q) {
        if (busy) return;
        busy = true;
        $('visitsQuery').value = q || '';
        $('visitsList').replaceChildren(empty('Loading…'));
        try {
            const res = await call('visits', { q: q || '' });
            render(res);
            loaded = true;
        } catch (e) {
            console.error(e);
            $('visitsList').replaceChildren(empty('Could not load the visits.'));
            toast(e.message || 'That didn’t work.', true);
        } finally {
            busy = false;
        }
    }

    // An address, device or account that opens everything else seen with it.
    const link = (text, q, title) => {
        const b = h('button', 'linkish', text);
        b.type = 'button';
        b.title = title || `Show every visit with ${q}`;
        b.onclick = () => search(q);
        return b;
    };

    function addressLine(label, ip, places, note, saved) {
        const line = h('div', 'visit-ip');
        line.append(h('span', 'pill', label), link(ip, ip));
        // the place saved at visit time when there is one; else the one looked up just now
        const g = saved?.ip === ip ? saved : places[ip];
        if (g) line.append(h('span', '', place(g)), ...(g.org ? [h('span', 'muted', g.org)] : []));
        if (note) line.append(h('span', 'muted', note));
        return line;
    }

    function row(v, places) {
        const item = h('div', 'item visit');
        const head = h('div', 'item-head');
        head.append(h('b', '', when(v.last)));
        if (v.count > 1) head.append(h('span', '', `${v.count} check-ins since ${new Date(v.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`));
        head.append(h('span', 'pill', v.account === 'google' ? 'Google' : 'Anonymous'));
        item.append(head);
        item.append(addressLine(v.v === 6 ? 'IPv6' : 'IPv4', v.ip, places, 'seen by the server', v.g));
        if (v.r4) item.append(addressLine('IPv4', v.r4, places, 'reported by the device', v.g4));
        if (v.r6) item.append(addressLine('IPv6', v.r6, places, 'reported by the device', v.g6));
        const who = h('div', 'kv');
        const pair = (label, node) => { const s = h('span', '', `${label}: `); s.append(node); who.append(s); };
        pair('Account', link(short(v.uid), v.uid, v.uid));
        if (v.email) pair('Email', link(v.email, v.email));
        if (v.fp) pair('Device ID', link(short(v.fp), v.fp, v.fp));
        if (v.device) { const d = h('code', '', v.device); d.title = v.ua || ''; pair('Device', d); }
        if (v.lang) pair('Language', h('code', '', v.lang));
        item.append(who);
        const actions = h('div', 'actions');
        const ban = hours => b => {
            if (!confirm(`Ban this account, its IP address and its device for ${hours >= 48 ? `${hours / 24} days` : `${hours} hours`}?`)) return;
            act(b, 'ban', { uid: v.uid, ip: v.ip, fp: v.fp, hours, scope: 'all', reason: 'admin', note: 'From the visit log' },
                'Banned.');
        };
        actions.append(button('Ban 24 h', 'btn btn-danger btn-sm', ban(24)), button('Ban 7 days', 'btn btn-danger btn-sm', ban(168)));
        item.append(actions);
        return item;
    }

    function render({ query, visits, places }) {
        const what = { latest: 'The latest visits', ip: `Every visit from ${query.value}`, email: `Every visit by ${query.value}`,
            fp: `Every visit from device ${short(query.value)}`, uid: `Every visit by account ${short(query.value)}`, invalid: 'Type an IP address, email, device ID or account ID.' }[query.type];
        const accounts = new Set(visits.map(v => v.uid)), ips = new Set(visits.map(v => v.ip)), devices = new Set(visits.map(v => v.fp).filter(Boolean));
        const summary = h('p', 'help', `${what}: ${visits.length} ${visits.length === 1 ? 'row' : 'rows'} · ${accounts.size} ${accounts.size === 1 ? 'account' : 'accounts'} · ${ips.size} ${ips.size === 1 ? 'address' : 'addresses'} · ${devices.size} ${devices.size === 1 ? 'device' : 'devices'}`);
        $('visitsList').replaceChildren(summary, ...(visits.length ? visits.map(v => row(v, places || {})) : [empty(query.type === 'invalid' ? '' : 'No visits found.')]));
    }

    $('visitsForm').onsubmit = e => { e.preventDefault(); search($('visitsQuery').value.trim()); };
    $('visitsLatest').onclick = () => search('');

    return {
        show(tab) { if (tab === 'visits' && !loaded) search(''); },
        refresh(tab) { if (tab === 'visits') search($('visitsQuery').value.trim()); },
        search,
    };
}
