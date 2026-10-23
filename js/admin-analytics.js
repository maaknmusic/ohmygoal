// =====================================================================
// Admin analytics screens: Dashboard, Premium members, Payments and People. The numbers come from the `adminAnalytics`
// function (functions/analytics.js); this file only draws them. Everything from users is shown with textContent.
// =====================================================================
import { timeChart, barList, toCsv, rupees, compact } from './admin-charts.js';

const DAY = 86400000;
const KIND = { premium: 'Premium', coins: 'Coin pack', tip: 'Tip' };
const dateOnly = ms => (ms ? new Date(ms).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : '—');

/**
 * @param {object} d  helpers from admin.js: $, h, toast, button, empty, kv, when, short, fn (the adminAnalytics callable),
 *                    adminCall (the older `admin` callable, used for bans) and openTab(name)
 */
export function createAnalytics({ $, h, toast, button, empty, kv, when, short, fn, adminCall, openTab }) {
    const call = async (action, payload = {}) => (await fn({ action, ...payload })).data;
    let dash = null, dashDays = 30, members = null, orders = null;
    let memberFilter = 'active', orderKind = 'all', lookedUp = '';

    const fail = (box, e) => {
        console.error(e);
        box.replaceChildren(empty(e?.message || 'Could not load this.'));
    };
    const loading = box => box.replaceChildren(empty('Loading…'));
    const busy = new Set(); // one load per screen at a time: the page re-renders every 20 seconds
    const once = (name, fn) => async () => { if (busy.has(name)) return; busy.add(name); try { await fn(); } finally { busy.delete(name); } };

    function download(name, rows) {
        const url = URL.createObjectURL(new Blob(['﻿' + toCsv(rows)], { type: 'text/csv;charset=utf-8' }));
        const a = h('a');
        a.href = url;
        a.download = name;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
    }
    const stamp = () => new Date().toISOString().slice(0, 10);

    function tile(label, value, sub, cls = '') {
        const t = h('div', 'tile ' + cls);
        t.append(h('span', 'tile-label', label), h('b', 'tile-value', value));
        if (sub) t.append(h('span', 'tile-sub', sub));
        return t;
    }
    function panel(title, sub) {
        const p = h('div', 'card chart-card');
        p.append(h('b', '', title));
        if (sub) p.append(h('p', 'help', sub));
        const body = h('div', 'chart-body');
        p.appendChild(body);
        return { el: p, body };
    }

    // ---------------- dashboard ----------------
    const loadDashboard = once('dashboard', async () => {
        const box = $('dashBody');
        loading(box);
        try { dash = await call('dashboard', { days: dashDays }); } catch (e) { return fail(box, e); }
        renderDashboard();
    });

    function renderDashboard() {
        const box = $('dashBody');
        if (!dash) return;
        const n = dash.now, s = dash.series;
        const tiles = h('div', 'tiles');
        tiles.append(
            tile('Online now', compact(n.online), 'people on the site', 'hot'),
            tile('Chats today', compact(n.chatsToday), `${compact(n.dauToday)} people active today`),
            tile('Premium members', compact(n.premiumActive), `${compact(n.premiumExpiringSoon)} end within 7 days`),
            tile('Revenue today', rupees(n.revenueToday), `${rupees(n.revenueWeek)} in 7 days`),
            tile('Revenue, 30 days', rupees(n.revenueMonth), `${rupees(n.revenueAll)} all time`),
            tile('Needs you', compact(n.openAppeals + n.reportsToday), `${n.openAppeals} unban requests · ${n.reportsToday} reports today`, n.openAppeals + n.reportsToday ? 'warn' : ''),
            tile('Active bans', compact(n.activeBans), `${compact(n.premiumExpired)} Premium passes have ended`),
        );

        const labels = dash.days;
        const charts = h('div', 'chart-grid');
        const add = (title, sub, draw) => { const p = panel(title, sub); charts.appendChild(p.el); draw(p.body); };
        add('People active per day', 'Different people who started a chat, joined a room or sent a like.', b => timeChart(b, { labels, type: 'line', series: [{ name: 'People', values: s.dau }] }));
        add('Chats per day', 'Matches that were made, by kind.', b => timeChart(b, {
            labels, series: [{ name: 'Video', values: s.chatsVideo }, { name: 'Voice', values: s.chatsVoice }, { name: 'Text', values: s.chatsText }],
        }));
        add('Revenue per day', 'Paid orders only, in rupees.', b => timeChart(b, {
            labels, format: rupees, series: [{ name: 'Premium', values: s.revenuePremium }, { name: 'Coin packs', values: s.revenueCoins }, { name: 'Tips', values: s.revenueTips }],
        }));
        add('Group rooms, gifts and likes', 'How much people use the social parts.', b => timeChart(b, {
            labels, type: 'line', series: [{ name: 'Room joins', values: s.groupJoins }, { name: 'Gifts', values: s.gifts }, { name: 'Likes', values: s.likes }],
        }));
        add('Reports per day', 'Reports from users and the automatic check.', b => timeChart(b, { labels, series: [{ name: 'Reports', values: s.reports, color: '#ef4444' }] }));
        add('Where the money comes from', 'All time.', b => barList(b, Object.entries(dash.revenueByKind).map(([k, v]) => ({ label: KIND[k] || k, value: v })), { format: rupees }));
        add('Premium plans bought', 'Number of paid orders per plan.', b => barList(b, Object.entries(dash.premiumByPlan).map(([k, v]) => ({ label: k, value: v }))));
        add('Why people are reported', `Last ${dash.days.length} days.`, b => barList(b, Object.entries(dash.reportsByReason).map(([k, v]) => ({ label: k, value: v }))));

        const foot = h('p', 'help', 'Charts start on the day the counters were first deployed, so earlier days show 0. Revenue and Premium come from your payment records, so those go back to the first order.');
        const actions = h('div', 'actions');
        actions.append(button('Download daily numbers (CSV)', 'btn btn-ghost btn-sm', () => download(`ohmygoal-daily-${stamp()}.csv`, [
            ['date', 'people_active', 'chats', 'chats_video', 'chats_voice', 'chats_text', 'group_joins', 'gifts', 'likes', 'reports', 'revenue_premium_inr', 'revenue_coins_inr', 'revenue_tips_inr'],
            ...dash.days.map((d, i) => [d, s.dau[i], s.chats[i], s.chatsVideo[i], s.chatsVoice[i], s.chatsText[i], s.groupJoins[i], s.gifts[i], s.likes[i], s.reports[i], s.revenuePremium[i], s.revenueCoins[i], s.revenueTips[i]]),
        ])));
        box.replaceChildren(tiles, charts, foot, actions);
        if (dash.orderCapReached) box.append(h('p', 'help', 'You have more paid orders than this page reads at once; the totals are for the newest 5,000.'));
    }

    $('dashDays').onchange = () => { dashDays = Number($('dashDays').value) || 30; loadDashboard(); };

    // ---------------- Premium members ----------------
    const loadMembers = once('members', async () => {
        const box = $('memberList');
        loading(box);
        try { members = (await call('members')).members; } catch (e) { return fail(box, e); }
        renderMembers();
    });

    const bucket = m => (!m.active ? 'expired' : m.daysLeft <= 7 ? 'soon' : 'active');
    function renderMembers() {
        if (!members) return;
        const q = $('memberSearch').value.trim().toLowerCase();
        const count = f => members.filter(m => f === 'all' || (f === 'granted' ? m.granted : f === 'active' ? m.active : bucket(m) === f)).length;
        document.querySelectorAll('#memberFilters button').forEach(b => {
            b.classList.toggle('active', b.dataset.f === memberFilter);
            b.dataset.n = count(b.dataset.f);
        });
        const list = members.filter(m => (memberFilter === 'all' || (memberFilter === 'granted' ? m.granted : memberFilter === 'active' ? m.active : bucket(m) === memberFilter))
            && (!q || [m.email, m.name, m.uid].some(v => String(v || '').toLowerCase().includes(q))));
        const paidTotal = list.reduce((a, m) => a + m.paid, 0);
        $('memberSummary').textContent = `${list.length} shown · ${rupees(paidTotal)} paid by them`;
        if (!list.length) return $('memberList').replaceChildren(empty(q ? 'No one matches.' : 'No one here yet.'));

        const table = h('table', 'grid-table');
        const head = h('tr');
        for (const t of ['Person', 'Status', 'Valid until', 'Days left', 'Orders', 'Paid', 'Actions']) head.appendChild(h('th', '', t));
        const thead = h('thead');
        thead.appendChild(head);
        table.appendChild(thead);
        const body = h('tbody');
        for (const m of list) {
            const row = h('tr');
            const who = h('td');
            who.append(h('b', '', m.email || m.name || 'No email'), h('br'), h('code', 'small', short(m.uid)));
            const st = h('td');
            const b = bucket(m);
            st.append(h('span', 'pill ' + (b === 'active' ? 'approved' : b === 'soon' ? 'open' : 'rejected'), b === 'active' ? 'Active' : b === 'soon' ? 'Ending soon' : 'Ended'));
            if (m.granted) st.append(document.createTextNode(' '), h('span', 'pill', 'Granted'));
            const act = h('td', 'row-actions');
            act.append(
                button('+30 days', 'btn btn-ghost btn-sm', btn => memberAction(btn, 'grantPremium', { uid: m.uid, days: 30 }, `Added 30 days for ${m.email || 'this person'}.`)),
                button('Look up', 'btn btn-ghost btn-sm', () => openPerson(m.uid)),
            );
            if (m.active) act.append(button('Revoke', 'btn btn-danger btn-sm', btn => { if (confirm(`End Premium now for ${m.email || m.uid}?`)) memberAction(btn, 'revokePremium', { uid: m.uid }, 'Premium ended.'); }));
            row.append(who, st, h('td', '', dateOnly(m.premiumUntil)), h('td', '', m.active ? String(m.daysLeft) : '—'), h('td', '', String(m.orders)), h('td', '', m.paid ? rupees(m.paid) : '—'), act);
            body.appendChild(row);
        }
        table.appendChild(body);
        const wrap = h('div', 'table-wrap');
        wrap.appendChild(table);
        $('memberList').replaceChildren(wrap);
    }
    async function memberAction(btn, action, payload, done) {
        btn.disabled = true;
        try { await call(action, payload); toast(done); await loadMembers(); } catch (e) { console.error(e); toast(e.message || 'That didn’t work.', true); } finally { btn.disabled = false; }
    }
    document.querySelectorAll('#memberFilters button').forEach(b => (b.onclick = () => { memberFilter = b.dataset.f; renderMembers(); }));
    $('memberSearch').oninput = () => renderMembers();
    $('memberCsv').onclick = () => {
        if (!members) return;
        download(`ohmygoal-premium-${stamp()}.csv`, [
            ['email', 'name', 'user_id', 'premium_until', 'days_left', 'status', 'orders', 'paid_inr', 'last_plan_days', 'granted_by_admin'],
            ...members.map(m => [m.email, m.name, m.uid, m.premiumUntil ? new Date(m.premiumUntil).toISOString() : '', m.active ? m.daysLeft : 0, bucket(m), m.orders, m.paid, m.lastPlanDays, m.granted ? 'yes' : 'no']),
        ]);
    };

    // ---------------- payments ----------------
    const loadPayments = once('payments', async () => {
        const box = $('orderList');
        loading(box);
        try {
            [orders] = await Promise.all([call('orders').then(r => r.orders), dash ? null : call('dashboard', { days: dashDays }).then(r => { dash = r; })]);
        } catch (e) { return fail(box, e); }
        renderPayments();
    });
    function renderPayments() {
        if (dash) {
            const n = dash.now, k = dash.revenueByKind;
            $('payTiles').replaceChildren(
                tile('Today', rupees(n.revenueToday)), tile('Last 7 days', rupees(n.revenueWeek)), tile('Last 30 days', rupees(n.revenueMonth)), tile('All time', rupees(n.revenueAll)),
                tile('Premium', rupees(k.premium)), tile('Coin packs', rupees(k.coins)), tile('Tips', rupees(k.tip)),
            );
        }
        if (!orders) return;
        document.querySelectorAll('#orderKinds button').forEach(b => b.classList.toggle('active', b.dataset.f === orderKind));
        const list = orders.filter(o => orderKind === 'all' || o.kind === orderKind);
        if (!list.length) return $('orderList').replaceChildren(empty('No orders yet.'));
        const table = h('table', 'grid-table');
        const head = h('tr');
        for (const t of ['When', 'Person', 'What', 'Amount', 'Status', 'Payment ID']) head.appendChild(h('th', '', t));
        const thead = h('thead');
        thead.appendChild(head);
        table.appendChild(thead);
        const body = h('tbody');
        for (const o of list) {
            const row = h('tr');
            const what = o.kind === 'coins' ? `${o.coins} coins` : o.kind === 'tip' ? 'Tip' : `Premium ${o.days} days`;
            const who = h('td');
            who.append(h('span', '', o.email || short(o.uid)));
            const st = h('td');
            st.append(h('span', 'pill ' + (o.status === 'paid' ? 'approved' : 'open'), o.status === 'paid' ? 'Paid' : 'Not paid'));
            row.append(h('td', '', when(o.paidAt || o.createdAt)), who, h('td', '', what), h('td', '', rupees(o.amount)), st, h('td', '', o.paymentId ? short(o.paymentId) : '—'));
            body.appendChild(row);
        }
        table.appendChild(body);
        const wrap = h('div', 'table-wrap');
        wrap.appendChild(table);
        $('orderList').replaceChildren(wrap, h('p', 'help', 'Showing the newest 300 orders. “Not paid” means the person opened checkout and did not finish.'));
    }
    document.querySelectorAll('#orderKinds button').forEach(b => (b.onclick = () => { orderKind = b.dataset.f; renderPayments(); }));
    $('orderCsv').onclick = () => {
        if (!orders) return;
        download(`ohmygoal-orders-${stamp()}.csv`, [
            ['order_id', 'created_at', 'paid_at', 'user_id', 'email', 'kind', 'plan_days', 'coins', 'amount_inr', 'status', 'payment_id'],
            ...orders.map(o => [o.id, o.createdAt ? new Date(o.createdAt).toISOString() : '', o.paidAt ? new Date(o.paidAt).toISOString() : '', o.uid, o.email, o.kind, o.days, o.coins, o.amount, o.status, o.paymentId]),
        ]);
    };

    // ---------------- people ----------------
    async function findPerson(q) {
        const box = $('personResult');
        loading(box);
        lookedUp = q;
        try {
            const r = await call('user', { q });
            if (!r.found) return box.replaceChildren(empty('No account with that email or user ID. People who only use the site without signing in have no email; use their user ID from a report.'));
            renderPerson(r);
        } catch (e) { fail(box, e); }
    }
    function openPerson(uid) {
        $('personQuery').value = uid;
        openTab('people');
        findPerson(uid);
    }
    $('personForm').onsubmit = e => {
        e.preventDefault();
        const q = $('personQuery').value.trim();
        if (q) findPerson(q);
    };

    function renderPerson(r) {
        const u = r.user, card = h('div', 'card');
        const head = h('div', 'item-head');
        head.append(h('b', '', u.email || u.name || 'No email (not signed in with Google)'), r.premiumActive ? h('span', 'pill approved', 'Premium') : h('span', 'pill', 'Free'));
        card.append(head, kv([['User ID', u.uid], ['Joined', when(u.createdAt)], ['Last seen', when(u.lastSignIn)], ['Premium until', r.premiumUntil ? dateOnly(r.premiumUntil) : ''], ['Coins', r.coins], ['Likes', r.likes]]));

        const run = (btn, action, payload, done) => (async () => {
            btn.disabled = true;
            try { await call(action, { uid: u.uid, note: $('personNote').value.trim(), ...payload }); toast(done); await findPerson(lookedUp); } catch (e) { console.error(e); toast(e.message || 'That didn’t work.', true); } finally { btn.disabled = false; }
        })();
        const tools = h('div', 'card');
        tools.append(h('b', '', 'Manual changes'), h('p', 'help', 'Every change here is saved in the admin log with your email.'));
        const grid = h('div', 'form-grid');
        grid.style.marginTop = '10px';
        const field = (label, node) => { const d = h('div'); d.append(h('label', '', label), node); return d; };
        const note = h('input', 'input'); note.id = 'personNote'; note.maxLength = 200; note.placeholder = 'Why (optional)'; note.autocomplete = 'off';
        const days = h('input', 'input'); days.id = 'grantDays'; days.type = 'number'; days.min = '1'; days.max = '365'; days.value = '30';
        const delta = h('input', 'input'); delta.id = 'coinDelta'; delta.type = 'number'; delta.min = '-1000'; delta.max = '1000'; delta.value = '50';
        grid.append(
            field('Note', note),
            field('Give Premium (days)', days),
            field(' ', button('Give Premium', 'btn btn-primary', b => run(b, 'grantPremium', { days: Number(days.value) }, 'Premium added.'))),
            field('Change coins by', delta),
            field(' ', button('Change coins', 'btn btn-ghost', b => run(b, 'adjustCoins', { delta: Number(delta.value) }, 'Coins changed.'))),
        );
        const more = h('div', 'actions');
        if (r.premiumActive) more.append(button('End Premium now', 'btn btn-danger btn-sm', b => { if (confirm('End Premium now for this person?')) run(b, 'revokePremium', {}, 'Premium ended.'); }));
        more.append(button('Ban for 24 hours', 'btn btn-danger btn-sm', async b => {
            if (!confirm('Ban this person from all chat for 24 hours?')) return;
            b.disabled = true;
            try { await adminCall('ban', { uid: u.uid, hours: 24, scope: 'all', reason: 'admin', note: $('personNote').value.trim() }); toast('Banned for 24 hours.'); await findPerson(lookedUp); } catch (e) { toast(e.message || 'That didn’t work.', true); } finally { b.disabled = false; }
        }));
        tools.append(grid, more);

        const list = (title, rows, empt) => {
            const c = h('div', 'card');
            c.append(h('b', '', title));
            if (!rows.length) c.append(h('p', 'help', empt));
            for (const t of rows) c.append(h('div', 'line', t));
            return c;
        };
        const orderRows = r.orders.map(o => `${when(o.paidAt || o.createdAt)} · ${o.kind === 'coins' ? o.coins + ' coins' : o.kind === 'tip' ? 'Tip' : 'Premium ' + o.days + ' days'} · ${rupees(o.amount)} · ${o.status === 'paid' ? 'paid' : 'not paid'}`);
        const banRows = r.bans.map(b => `${b.scope === 'video' ? 'Video only' : 'All chat'} · ${b.reason} · until ${when(b.until)}`);
        const reportRows = r.reportsAbout.map(x => `${when(x.ts)} · ${x.reason}`);
        const logRows = r.log.map(l => `${when(l.at)} · ${l.by} · ${l.what}${l.details?.days ? ` ${l.details.days} days` : ''}${l.details?.delta ? ` ${l.details.delta} coins` : ''}${l.details?.note ? ` — ${l.details.note}` : ''}`);
        $('personResult').replaceChildren(card, tools, list('Orders', orderRows, 'No orders.'), list('Active bans', banRows, 'None.'), list('Reports about this person', reportRows, 'None.'), list('Admin log', logRows, 'Nothing yet.'));
    }

    return {
        /** Called when a tab is opened; loads its data the first time. */
        show(tab) {
            if (tab === 'dashboard') (dash ? renderDashboard() : loadDashboard());
            else if (tab === 'premium') (members ? renderMembers() : loadMembers());
            else if (tab === 'payments') (orders ? renderPayments() : loadPayments());
        },
        /** Reload whatever is on screen (the Refresh button). */
        refresh(tab) {
            if (tab === 'dashboard') loadDashboard();
            else if (tab === 'premium') loadMembers();
            else if (tab === 'payments') { orders = null; dash = null; loadPayments(); }
            else if (tab === 'people' && lookedUp) findPerson(lookedUp);
        },
    };
}
