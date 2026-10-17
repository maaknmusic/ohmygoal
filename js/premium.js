// =====================================================================
// Premium (client side). Premium = signed in with Google + an active pass.
// The pass lives in entitlements/{uid}, written only by the payment Cloud
// Functions; this module just reads it and runs Razorpay Checkout.
// =====================================================================

export class Premium {
    constructor(transport, friends, cfg) {
        this.t = transport;
        this.friends = friends;
        this.cfg = cfg;
        const { auth, db, fs, base } = transport.fb;
        Object.assign(this, { auth, db, fs, base });
        this.premiumUntil = 0;
        this.listeners = new Set();
        this.unsub = null;
        this.functions = null;
        this.watch();
        // Re-watch when the user changes OR upgrades from anonymous to Google (same uid).
        const key = () => `${this.auth.currentUser?.uid}|${this.friends.signedIn}`;
        friends.onChange(() => { if (this.watchedKey !== key()) this.watch(); });
        this.key = key;
    }

    get active() { return this.friends.signedIn && this.premiumUntil > Date.now(); }
    onChange(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
    emit() { this.listeners.forEach(fn => fn(this)); }

    entitlementRef(uid) { return this.fs.doc(this.db, ...this.base, 'entitlements', uid); }

    /** Follow the signed-in user's entitlement doc. `ready` resolves after the first answer. */
    watch() {
        this.unsub?.();
        this.unsub = null;
        this.premiumUntil = 0;
        const uid = this.auth.currentUser?.uid;
        this.watchedKey = `${uid}|${this.friends.signedIn}`;
        let markReady;
        this.ready = new Promise(r => { markReady = r; });
        if (uid && this.friends.signedIn) {
            this.unsub = this.fs.onSnapshot(this.entitlementRef(uid), snap => {
                // Only trust what the server confirmed: clients never write entitlements, so a pending
                // local write is a tampering attempt that the rules will reject.
                if (snap.metadata.hasPendingWrites) return;
                const until = snap.data()?.premiumUntil;
                this.setUntil(Number.isFinite(until) ? until : 0);
                markReady();
            }, e => { console.warn('entitlement listener', e); markReady(); });
        } else {
            markReady();
        }
        this.emit();
    }

    /** Update the pass end time and schedule a refresh for the moment it expires. */
    setUntil(until) {
        this.premiumUntil = until;
        clearTimeout(this.expiryTimer);
        const left = until - Date.now();
        if (left > 0) this.expiryTimer = setTimeout(() => this.setUntil(this.premiumUntil), Math.min(left + 1000, 2 ** 31 - 1));
        this.emit();
    }

    /** Wait (briefly) for the first entitlement answer, e.g. right after signing in. */
    waitReady(ms = 4000) { return Promise.race([this.ready, new Promise(r => setTimeout(r, ms))]); }

    /** Is another user's Premium badge real? */
    async verify(uid) {
        try {
            const snap = await this.fs.getDoc(this.entitlementRef(uid));
            return (snap.data()?.premiumUntil || 0) > Date.now();
        } catch { return false; }
    }

    async callable(name) {
        if (!this.functions) {
            const mod = await import('https://www.gstatic.com/firebasejs/11.6.1/firebase-functions.js');
            this.functions = mod.getFunctions(this.t.fb.app, this.cfg.functionsRegion || 'asia-south1');
            if (this.t.emulators?.functions) mod.connectFunctionsEmulator(this.functions, ...this.t.emulators.functions);
            this.httpsCallable = mod.httpsCallable;
        }
        return this.httpsCallable(this.functions, name);
    }

    loadCheckout() {
        if (window.Razorpay) return Promise.resolve(window.Razorpay);
        this.checkoutLoading ||= new Promise((resolve, reject) => {
            const s = document.createElement('script');
            s.src = this.cfg.checkoutUrl;
            s.onload = () => (window.Razorpay ? resolve(window.Razorpay) : reject(new Error('Razorpay failed to load')));
            s.onerror = () => { this.checkoutLoading = null; reject(new Error('Razorpay failed to load')); };
            document.head.appendChild(s);
        });
        return this.checkoutLoading;
    }

    /**
     * Buy a pass. Resolves with premiumUntil once the server has verified the payment.
     * Rejects with { code: 'cancelled' } if the buyer closes the checkout.
     */
    async buy(planId) {
        if (!this.friends.signedIn) throw Object.assign(new Error('Sign in with Google first'), { code: 'signin' });
        const [createOrder, verifyPayment, Razorpay] = await Promise.all([
            this.callable('createOrder'), this.callable('verifyPayment'), this.loadCheckout(),
        ]);
        const { data: order } = await createOrder({ plan: planId });
        const user = this.auth.currentUser;
        const response = await new Promise((resolve, reject) => {
            let lastError = null;
            const rzp = new Razorpay({
                key: order.keyId,
                order_id: order.orderId,
                amount: order.amount,
                currency: order.currency,
                name: 'Anonymous Connect',
                description: order.label,
                prefill: { name: user?.displayName || '', email: user?.email || '' },
                theme: { color: '#4f46e5' },
                handler: resolve,
                // The checkout stays open after a failed attempt so the buyer can retry; only give up
                // when they close it (reporting the last failure, if any).
                modal: {
                    ondismiss: () => reject(lastError
                        ? Object.assign(new Error(lastError), { code: 'failed' })
                        : Object.assign(new Error('Payment cancelled'), { code: 'cancelled' })),
                },
            });
            rzp.on?.('payment.failed', r => { lastError = r?.error?.description || 'Payment failed'; });
            rzp.open();
        });
        // The money has moved: retry verification on temporary errors. If it still can't be confirmed,
        // the Razorpay webhook grants the pass in the background and the listener picks it up.
        const payload = {
            orderId: response.razorpay_order_id,
            paymentId: response.razorpay_payment_id,
            signature: response.razorpay_signature,
        };
        let lastErr;
        for (const wait of [0, 1500, 4000]) {
            if (wait) await new Promise(r => setTimeout(r, wait));
            try {
                const { data } = await verifyPayment(payload);
                this.setUntil(Math.max(this.premiumUntil, data.premiumUntil || 0));
                return data.premiumUntil;
            } catch (e) {
                lastErr = e;
                if (/permission-denied|invalid-argument|failed-precondition/.test(e.code || '')) throw e;
            }
        }
        console.warn('verifyPayment failed after retries', lastErr);
        throw Object.assign(new Error(`Your payment went through (ID ${payload.paymentId}). Premium will activate within a minute; if it doesn’t, contact support with that ID.`), { code: 'pending' });
    }
}
