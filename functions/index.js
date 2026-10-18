// =====================================================================
// Premium payments (Razorpay) for Anonymous Connect.
//
// Premium status lives in artifacts/{appId}/public/data/entitlements/{uid}
// and is written ONLY here (Admin SDK). Firestore rules deny client writes,
// so the browser can never grant itself Premium.
//
// Flow: client calls createOrder -> opens Razorpay Checkout -> calls verifyPayment
// with Razorpay's signed response. razorpayWebhook grants the same pass if the
// browser closes before verifyPayment runs. Granting is idempotent per order.
// =====================================================================
import crypto from 'node:crypto';
import { logger } from 'firebase-functions/v2';
import { onCall, onRequest, HttpsError } from 'firebase-functions/v2/https';
import { defineSecret, defineString } from 'firebase-functions/params';
import { db, APP_ID } from './common.js';

// Bans, access passes, unban requests and the admin API.
export { checkAccess, reportViolation, requestUnban, admin } from './moderation.js';

const RAZORPAY_KEY_ID = defineSecret('RAZORPAY_KEY_ID');
const RAZORPAY_KEY_SECRET = defineSecret('RAZORPAY_KEY_SECRET');
const RAZORPAY_WEBHOOK_SECRET = defineSecret('RAZORPAY_WEBHOOK_SECRET');
// Overridable only so tests can point at a mock; production uses Razorpay.
const RAZORPAY_API = defineString('RAZORPAY_API', { default: 'https://api.razorpay.com' });

/** Prices are decided here, never by the client. Amounts are in paise (₹1 = 100). */
const PLANS = {
    week: { days: 7, amount: 4900, label: 'Premium · 7 days' },
    month: { days: 30, amount: 14900, label: 'Premium · 30 days' },
    quarter: { days: 90, amount: 34900, label: 'Premium · 90 days' },
};
const CURRENCY = 'INR';
const DAY_MS = 86400000;

const entitlementRef = uid => db.doc(`artifacts/${APP_ID.value()}/public/data/entitlements/${uid}`);
// Outside the public tree: no Firestore rule matches it, so clients can't read or write it.
const orderRef = orderId => db.doc(`artifacts/${APP_ID.value()}/private/data/orders/${orderId}`);

function requireGoogleUser(request) {
    if (!request.auth) throw new HttpsError('unauthenticated', 'Please sign in.');
    if (request.auth.token.firebase?.sign_in_provider !== 'google.com') {
        throw new HttpsError('failed-precondition', 'Sign in with Google to buy Premium.');
    }
    return request.auth.uid;
}

const ORDER_LIMIT = 10;          // orders per user...
const ORDER_WINDOW_MS = 3600000; // ...per hour
const limitRef = uid => db.doc(`artifacts/${APP_ID.value()}/private/data/orderLimits/${uid}`);

/** Simple per-user rate limit on order creation (stops order spam). */
async function takeOrderSlot(uid) {
    await db.runTransaction(async t => {
        const snap = await t.get(limitRef(uid));
        const now = Date.now();
        const d = snap.data();
        const fresh = !d || now - d.windowStart > ORDER_WINDOW_MS;
        const count = fresh ? 0 : d.count;
        if (count >= ORDER_LIMIT) {
            throw new HttpsError('resource-exhausted', 'Too many payment attempts. Please try again in an hour.');
        }
        t.set(limitRef(uid), { windowStart: fresh ? now : d.windowStart, count: count + 1 });
    });
}

function hmacHex(secret, data) {
    return crypto.createHmac('sha256', secret).update(data).digest('hex');
}

function safeEqual(a, b) {
    const x = Buffer.from(String(a));
    const y = Buffer.from(String(b));
    return x.length === y.length && crypto.timingSafeEqual(x, y);
}

async function razorpay(path, { method = 'GET', body } = {}) {
    const auth = Buffer.from(`${RAZORPAY_KEY_ID.value()}:${RAZORPAY_KEY_SECRET.value()}`).toString('base64');
    const res = await fetch(`${RAZORPAY_API.value()}${path}`, {
        method,
        headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/json' },
        body: body ? JSON.stringify(body) : undefined,
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
        logger.error('Razorpay API error', { path, status: res.status, error: json?.error });
        // 4xx (e.g. unknown payment) is a final answer; 5xx / rate limits are worth retrying.
        if (res.status >= 400 && res.status < 500 && res.status !== 429) {
            throw new HttpsError('failed-precondition', 'The payment provider rejected this request.');
        }
        throw new HttpsError('unavailable', 'The payment provider is unavailable. Please try again.');
    }
    return json;
}

/**
 * Grant the order's pass exactly once. Extends any remaining Premium time.
 * Returns { uid, premiumUntil, alreadyGranted }.
 */
async function grantOrder(orderId, paymentId) {
    return db.runTransaction(async t => {
        const oSnap = await t.get(orderRef(orderId));
        if (!oSnap.exists) throw new HttpsError('not-found', 'Unknown order.');
        const order = oSnap.data();
        const eRef = entitlementRef(order.uid);
        const eSnap = await t.get(eRef);
        if (order.status === 'paid') {
            return { uid: order.uid, premiumUntil: eSnap.data()?.premiumUntil || 0, alreadyGranted: true };
        }
        // Use the days recorded when the order was created, so later plan changes can't lose a paid grant.
        const days = order.days || PLANS[order.plan]?.days;
        if (!days) throw new HttpsError('internal', 'Order has no plan length.');
        const now = Date.now();
        const premiumUntil = Math.max(now, eSnap.data()?.premiumUntil || 0) + days * DAY_MS;
        t.set(eRef, { premiumUntil, updatedAt: now });
        t.update(orderRef(orderId), { status: 'paid', paymentId, paidAt: now });
        return { uid: order.uid, premiumUntil, alreadyGranted: false };
    });
}

/** Make sure Razorpay really captured this payment for this order and amount (capturing it if needed). */
async function confirmCaptured(paymentId, orderId, order) {
    let payment = await razorpay(`/v1/payments/${encodeURIComponent(paymentId)}`);
    if (payment.order_id !== orderId || payment.amount !== order.amount || payment.currency !== CURRENCY) {
        logger.warn('Payment does not match order', { paymentId, orderId });
        throw new HttpsError('permission-denied', 'Payment does not match this order.');
    }
    if (payment.status === 'authorized') {
        payment = await razorpay(`/v1/payments/${encodeURIComponent(paymentId)}/capture`, {
            method: 'POST', body: { amount: order.amount, currency: CURRENCY },
        });
    }
    if (payment.status !== 'captured') {
        throw new HttpsError('failed-precondition', 'Payment was not completed.');
    }
}

export const createOrder = onCall({ secrets: [RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET] }, async request => {
    const uid = requireGoogleUser(request);
    const planId = request.data?.plan;
    const plan = Object.hasOwn(PLANS, planId) ? PLANS[planId] : null;
    if (!plan) throw new HttpsError('invalid-argument', 'Unknown plan.');
    await takeOrderSlot(uid);

    const order = await razorpay('/v1/orders', {
        method: 'POST',
        body: {
            amount: plan.amount,
            currency: CURRENCY,
            receipt: `${planId}-${Date.now()}`.slice(0, 40),
            notes: { uid, plan: planId, appId: APP_ID.value() },
        },
    });
    if (order.amount !== plan.amount || order.currency !== CURRENCY) {
        throw new HttpsError('internal', 'Unexpected order from the payment provider.');
    }
    await orderRef(order.id).set({
        uid, plan: planId, days: plan.days, amount: plan.amount, currency: CURRENCY, status: 'created', createdAt: Date.now(),
    });
    return {
        orderId: order.id, amount: plan.amount, currency: CURRENCY, plan: planId, label: plan.label,
        keyId: RAZORPAY_KEY_ID.value(),
    };
});

export const verifyPayment = onCall({ secrets: [RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET] }, async request => {
    const uid = requireGoogleUser(request);
    const { orderId, paymentId, signature } = request.data || {};
    if (![orderId, paymentId, signature].every(v => typeof v === 'string' && v.length > 0 && v.length < 200)) {
        throw new HttpsError('invalid-argument', 'Missing payment details.');
    }
    // 1. Razorpay signs "<order_id>|<payment_id>" with our key secret.
    if (!safeEqual(hmacHex(RAZORPAY_KEY_SECRET.value(), `${orderId}|${paymentId}`), signature)) {
        logger.warn('Bad payment signature', { uid, orderId });
        throw new HttpsError('permission-denied', 'Payment could not be verified.');
    }
    // 2. The order must belong to the caller.
    const oSnap = await orderRef(orderId).get();
    if (!oSnap.exists || oSnap.data().uid !== uid) {
        throw new HttpsError('permission-denied', 'This order belongs to another account.');
    }
    // 3. The money must actually have been captured.
    if (oSnap.data().status !== 'paid') await confirmCaptured(paymentId, orderId, oSnap.data());
    const result = await grantOrder(orderId, paymentId);
    return { premiumUntil: result.premiumUntil, alreadyGranted: result.alreadyGranted };
});

/**
 * Razorpay webhook (set it up for the "order.paid" event). Backup path so a pass is granted
 * even if the buyer closed the page before verifyPayment ran.
 */
export const razorpayWebhook = onRequest({ secrets: [RAZORPAY_WEBHOOK_SECRET, RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET] }, async (req, res) => {
    if (req.method !== 'POST') { res.status(405).send('Method not allowed'); return; }
    const signature = req.get('x-razorpay-signature') || '';
    if (!req.rawBody || !safeEqual(hmacHex(RAZORPAY_WEBHOOK_SECRET.value(), req.rawBody), signature)) {
        logger.warn('Bad webhook signature');
        res.status(400).send('Invalid signature');
        return;
    }
    const event = req.body?.event;
    const payment = req.body?.payload?.payment?.entity;
    if (!['order.paid', 'payment.captured'].includes(event) || !payment?.order_id) {
        res.status(200).send('ignored');
        return;
    }
    try {
        const oSnap = await orderRef(payment.order_id).get();
        if (!oSnap.exists) { res.status(200).send('unknown order'); return; }
        const order = oSnap.data();
        if (order.status !== 'paid') {
            // Don't trust the webhook body alone: confirm with Razorpay's API that this payment was
            // really captured for this order and amount (so a leaked webhook secret can't fake a payment).
            try {
                await confirmCaptured(String(payment.id), payment.order_id, order);
            } catch (e) {
                if (e instanceof HttpsError && e.code !== 'unavailable') {
                    logger.warn('Webhook payment not confirmed by Razorpay', { orderId: payment.order_id, reason: e.message });
                    res.status(200).send('not confirmed');
                    return;
                }
                throw e; // provider unavailable: let Razorpay retry
            }
        }
        const result = await grantOrder(payment.order_id, payment.id);
        res.status(200).send(result.alreadyGranted ? 'already granted' : 'granted');
    } catch (e) {
        logger.error('Webhook failed', e);
        res.status(500).send('error'); // Razorpay retries
    }
});
