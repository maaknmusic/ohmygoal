// Firebase App Check: every request to our database and functions carries a short-lived token that only a real browser on our own
// website can get (from reCAPTCHA), so scripts calling the backend directly can be refused. It stays off until config.js has a site key,
// it is skipped in the emulator tests, and a failure here never stops the site from starting.
const V = '11.6.1';

/**
 * @param {object} firebaseApp  the app returned by initializeApp (call this straight after it, before Firestore, Functions or Auth are used)
 * @param {{siteKey?: string}} [cfg]  CFG.appCheck
 * @param {{emulators?: any, loadModule?: (url: string) => Promise<any>}} [opts]
 * @returns {Promise<object|null>} the App Check instance, or null when it is not in use
 */
export async function startAppCheck(firebaseApp, cfg, { emulators, loadModule = url => import(url) } = {}) {
    const siteKey = typeof cfg?.siteKey === 'string' ? cfg.siteKey.trim() : '';
    if (!siteKey || emulators || !firebaseApp) return null;
    try {
        const mod = await loadModule(`https://www.gstatic.com/firebasejs/${V}/firebase-app-check.js`);
        return mod.initializeAppCheck(firebaseApp, { provider: new mod.ReCaptchaV3Provider(siteKey), isTokenAutoRefreshEnabled: true });
    } catch (e) {
        console.warn('App Check could not start', e);
        return null;
    }
}
