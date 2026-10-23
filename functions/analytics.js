// =====================================================================
// Admin analytics: the dashboard numbers, Premium members, orders, looking a person up, and the manual grants.
// One callable (adminAnalytics) so the page makes one kind of call; every action first checks the caller is an admin
// (the ADMIN_EMAILS secret, Google sign-in, verified email) and every change is written to the admin log.
// Queries use single fields only (no composite indexes to create) and are capped, so a busy day can't make them expensive.
// =====================================================================
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { Timestamp } from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';
import { db, publicDoc, publicCol, privateDoc, privateCol } from './common.js';
import { ADMIN_EMAILS, requireAdmin } from './moderation.js';
import { istDay, statsRef } from './stats.js';
import { MAX_COINS } from './gifts.js';

const DAY = 86400000;
const UID = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/;
const ORDER_CAP = 5000;

/** The last n Indian calendar days as 'YYYY-MM-DD', oldest first. */
export function lastDays(n, now = Date.now()) {
    return Array.from({ length: n }, (_, i) => istDay(now - (n - 1 - i) * DAY));
}

/** What kind of order this is. Orders written before coins and tips existed have no kind: they are Premium. */
export const orderKind = o => (o?.kind === 'tip' || o?.kind === 'coins' ? o.kind : 'premium');

/** Revenue in rupees per kind, from paid orders. The paise-to-rupee conversion is exact for whole-rupee amounts. */
export function summarizeOrders(orders, days, now = Date.now()) {
    const perDay = Object.fromEntries(days.map(d => [d, { premium: 0, coins: 0, tip: 0 }]));
    const total = { premium: 0, coins: 0, tip: 0 };
    const window = { today: 0, week: 0, month: 0, all: 0 };
    const today = istDay(now);
    const weekStart = istDay(now - 6 * DAY), monthStart = istDay(now - 29 * DAY);
    const byPlan = {};
    for (const o of orders) {
        if (o.status !== 'paid' || !Number.isFinite(o.amount)) continue;
        const kind = orderKind(o), rupees = o.amount / 100, day = istDay(o.paidAt || o.createdAt || 0);
        total[kind] += rupees;
        window.all += rupees;
        if (day === today) window.today += rupees;
        if (day >= weekStart) window.week += rupees;
        if (day >= monthStart) window.month += rupees;
        if (perDay[day]) perDay[day][kind] += rupees;
        if (kind === 'premium') byPlan[`${o.days || '?'} days`] = (byPlan[`${o.days || '?'} days`] || 0) + 1;
    }
    return { perDay, total, window, byPlan };
}

async function emailsFor(uids) {
    const out = new Map();
    const auth = getAuth();
    for (let i = 0; i < uids.length; i += 100) {
        try {
            const res = await auth.getUsers(uids.slice(i, i + 100).map(uid => ({ uid })));
            for (const u of res.users) out.set(u.uid, { email: u.email || '', name: u.displayName || '' });
        } catch { /* a lookup failure must not break the page */ }
    }
    return out;
}

async function paidOrders() {
    const snap = await privateCol('orders').where('status', '==', 'paid').limit(ORDER_CAP).get();
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

async function dashboard(days, now) {
    const list = lastDays(days, now);
    const since = now - days * DAY;
    const [statDocs, online, active, soon, expiredCount, appeals, bans, orders, reports] = await Promise.all([
        db.getAll(...list.map(statsRef)),
        publicCol('presence').where('ts', '>', now - 75000).count().get(),
        publicCol('entitlements').where('premiumUntil', '>', now).count().get(),
        publicCol('entitlements').where('premiumUntil', '>', now).where('premiumUntil', '<', now + 7 * DAY).count().get(),
        publicCol('entitlements').where('premiumUntil', '>', 0).where('premiumUntil', '<=', now).count().get(),
        privateCol('unbanRequests').where('status', '==', 'open').count().get(),
        privateCol('bans').where('until', '>', now).count().get(),
        paidOrders(),
        publicCol('reports').where('ts', '>=', Timestamp.fromMillis(since)).limit(3000).get(),
    ]);
    const series = {};
    statDocs.forEach((s, i) => { series[list[i]] = s.data() || {}; });
    const money = summarizeOrders(orders, list, now);
    const byReason = {}, reportsPerDay = Object.fromEntries(list.map(d => [d, 0]));
    for (const d of reports.docs) {
        const r = d.data(), day = istDay(r.ts?.toMillis?.() || 0);
        byReason[r.reason || 'other'] = (byReason[r.reason || 'other'] || 0) + 1;
        if (day in reportsPerDay) reportsPerDay[day]++;
    }
    const today = series[list[list.length - 1]] || {};
    return {
        days: list,
        now: {
            online: online.data().count, premiumActive: active.data().count, premiumExpiringSoon: soon.data().count, premiumExpired: expiredCount.data().count,
            openAppeals: appeals.data().count, activeBans: bans.data().count,
            dauToday: today.dau || 0, chatsToday: today.chats || 0, reportsToday: reportsPerDay[list[list.length - 1]] || 0,
            revenueToday: money.window.today, revenueWeek: money.window.week, revenueMonth: money.window.month, revenueAll: money.window.all,
        },
        series: {
            dau: list.map(d => series[d].dau || 0),
            chats: list.map(d => series[d].chats || 0),
            chatsVideo: list.map(d => series[d].chats_video || 0),
            chatsVoice: list.map(d => series[d].chats_voice || 0),
            chatsText: list.map(d => series[d].chats_text || 0),
            groupJoins: list.map(d => series[d].groupJoins || 0),
            gifts: list.map(d => series[d].gifts || 0),
            likes: list.map(d => series[d].likes || 0),
            reports: list.map(d => reportsPerDay[d]),
            revenuePremium: list.map(d => money.perDay[d].premium),
            revenueCoins: list.map(d => money.perDay[d].coins),
            revenueTips: list.map(d => money.perDay[d].tip),
        },
        revenueByKind: money.total,
        premiumByPlan: money.byPlan,
        reportsByReason: byReason,
        orderCapReached: orders.length >= ORDER_CAP,
    };
}

async function members(now) {
    const [ents, orders] = await Promise.all([
        publicCol('entitlements').where('premiumUntil', '>', 0).orderBy('premiumUntil', 'desc').limit(500).get(),
        paidOrders(),
    ]);
    const uids = ents.docs.map(d => d.id);
    const who = await emailsFor(uids);
    const paid = new Map();
    for (const o of orders) {
        if (orderKind(o) !== 'premium') continue;
        const p = paid.get(o.uid) || { count: 0, total: 0, lastAt: 0, lastDays: 0 };
        p.count++; p.total += (o.amount || 0) / 100;
        if ((o.paidAt || 0) >= p.lastAt) { p.lastAt = o.paidAt || 0; p.lastDays = o.days || 0; }
        paid.set(o.uid, p);
    }
    return ents.docs.map(d => {
        const until = d.data().premiumUntil || 0, p = paid.get(d.id);
        return {
            uid: d.id, email: who.get(d.id)?.email || '', name: who.get(d.id)?.name || '', premiumUntil: until,
            active: until > now, daysLeft: Math.max(0, Math.ceil((until - now) / DAY)),
            orders: p?.count || 0, paid: p?.total || 0, lastPlanDays: p?.lastDays || 0, lastPaidAt: p?.lastAt || 0,
            granted: !p, // Premium with no paid order behind it: given by an admin
        };
    });
}

async function orders() {
    const snap = await privateCol('orders').orderBy('createdAt', 'desc').limit(300).get();
    const rows = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    const who = await emailsFor([...new Set(rows.map(r => r.uid).filter(u => typeof u === 'string' && UID.test(u)))]);
    return rows.map(r => ({
        id: r.id, uid: r.uid, email: who.get(r.uid)?.email || '', kind: orderKind(r), plan: r.plan || '', days: r.days || 0, coins: r.coins || 0,
        amount: (r.amount || 0) / 100, status: r.status || '', createdAt: r.createdAt || 0, paidAt: r.paidAt || 0, paymentId: r.paymentId || '',
    }));
}

async function lookup(q) {
    const query = typeof q === 'string' ? q.trim() : '';
    if (!query || query.length > 200) throw new HttpsError('invalid-argument', 'Type an email address or a user ID.');
    let user = null;
    try { user = query.includes('@') ? await getAuth().getUserByEmail(query.toLowerCase()) : UID.test(query) ? await getAuth().getUser(query) : null; } catch { user = null; }
    if (!user) return { found: false };
    const uid = user.uid, now = Date.now();
    const [ent, wallet, rep, orderSnap, banSnap, reportSnap, logSnap] = await Promise.all([
        publicDoc(`entitlements/${uid}`).get(), privateDoc(`wallet/${uid}`).get(), publicDoc(`reputation/${uid}`).get(),
        privateCol('orders').where('uid', '==', uid).limit(30).get(), privateCol('bans').where('uid', '==', uid).limit(30).get(),
        publicCol('reports').where('reported', '==', uid).limit(30).get(), privateCol('adminLog').where('details.uid', '==', uid).limit(30).get(),
    ]);
    return {
        found: true,
        user: { uid, email: user.email || '', name: user.displayName || '', anonymous: !user.email, createdAt: Date.parse(user.metadata.creationTime) || 0, lastSignIn: Date.parse(user.metadata.lastSignInTime) || 0 },
        premiumUntil: ent.data()?.premiumUntil || 0, premiumActive: (ent.data()?.premiumUntil || 0) > now,
        coins: Number.isInteger(wallet.data()?.coins) ? wallet.data().coins : 0,
        likes: rep.data()?.likes || 0,
        orders: orderSnap.docs.map(d => ({ id: d.id, ...d.data() })).sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0)).map(o => ({ id: o.id, kind: orderKind(o), plan: o.plan || '', days: o.days || 0, coins: o.coins || 0, amount: (o.amount || 0) / 100, status: o.status, createdAt: o.createdAt || 0, paidAt: o.paidAt || 0 })),
        bans: banSnap.docs.map(d => d.data()).filter(b => (b.until || 0) > now).map(b => ({ scope: b.scope, reason: b.reason, until: b.until, type: b.type })),
        reportsAbout: reportSnap.docs.map(d => d.data()).map(r => ({ reason: r.reason, ts: r.ts?.toMillis?.() || 0 })).sort((a, b) => b.ts - a.ts),
        log: logSnap.docs.map(d => d.data()).sort((a, b) => b.at - a.at).map(l => ({ at: l.at, by: l.by, what: l.what, details: l.details })),
    };
}

export const adminAnalytics = onCall({ secrets: [ADMIN_EMAILS], timeoutSeconds: 60, memory: '512MiB' }, async request => {
    const email = requireAdmin(request);
    const { action } = request.data || {};
    const now = Date.now();
    const log = (what, details) => privateCol('adminLog').add({ at: now, by: email, what, details: details || {} });
    const target = () => { const u = request.data?.uid; if (typeof u !== 'string' || !UID.test(u)) throw new HttpsError('invalid-argument', 'Unknown user.'); return u; };
    const note = () => String(request.data?.note || '').slice(0, 200);

    switch (action) {
        case 'dashboard': return dashboard(Math.min(90, Math.max(7, Math.floor(Number(request.data.days)) || 30)), now);
        case 'members': return { members: await members(now) };
        case 'orders': return { orders: await orders() };
        case 'user': return lookup(request.data.q);
        case 'grantPremium': {
            const uid = target();
            const days = Number(request.data.days);
            if (!Number.isInteger(days) || days < 1 || days > 365) throw new HttpsError('invalid-argument', 'Days must be a whole number from 1 to 365.');
            const until = await db.runTransaction(async t => {
                const ref = publicDoc(`entitlements/${uid}`);
                const cur = (await t.get(ref)).data()?.premiumUntil || 0;
                const next = Math.max(now, cur) + days * DAY;
                t.set(ref, { premiumUntil: next, updatedAt: now });
                return next;
            });
            await log('grantPremium', { uid, days, note: note() });
            return { ok: true, premiumUntil: until };
        }
        case 'revokePremium': {
            const uid = target();
            await publicDoc(`entitlements/${uid}`).set({ premiumUntil: now, updatedAt: now }, { merge: true });
            await log('revokePremium', { uid, note: note() });
            return { ok: true };
        }
        case 'adjustCoins': {
            const uid = target();
            const delta = Number(request.data.delta);
            if (!Number.isInteger(delta) || delta === 0 || Math.abs(delta) > 1000) throw new HttpsError('invalid-argument', 'Change coins by a whole number from -1000 to 1000.');
            const coins = await db.runTransaction(async t => {
                const ref = privateDoc(`wallet/${uid}`);
                const cur = (await t.get(ref)).data()?.coins;
                const next = Math.min(MAX_COINS, Math.max(0, (Number.isInteger(cur) ? cur : 0) + delta));
                t.set(ref, { coins: next }, { merge: true });
                return next;
            });
            await log('adjustCoins', { uid, delta, note: note() });
            return { ok: true, coins };
        }
        default: throw new HttpsError('invalid-argument', 'Unknown action.');
    }
});
