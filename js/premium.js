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

    /** Follow the signed-in user's entitlement doc. */
    watch() {
        this.unsub?.();
        this.unsub = null;
        this.premiumUntil = 0;
        const uid = this.auth.currentUser?.uid;
        this.watchedKey = `${uid}|${this.friends.signedIn}`;
        if (uid && this.friends.signedIn) {
            this.unsub = this.fs.onSnapshot(this.entitlementRef(uid), snap => {
                this.premiumUntil = snap.data()?.premiumUntil || 0;
                this.emit();
            }, e => console.warn('entitlement listener', e));
        }
        this.emit();
    }

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
                modal: { ondismiss: () => reject(Object.assign(new Error('Payment cancelled'), { code: 'cancelled' })) },
            });
            rzp.on?.('payment.failed', r => reject(Object.assign(new Error(r?.error?.description || 'Payment failed'), { code: 'failed' })));
            rzp.open();
        });
        const { data } = await verifyPayment({
            orderId: response.razorpay_order_id,
            paymentId: response.razorpay_payment_id,
            signature: response.razorpay_signature,
        });
        this.premiumUntil = Math.max(this.premiumUntil, data.premiumUntil || 0);
        this.emit();
        return data.premiumUntil;
    }
}
