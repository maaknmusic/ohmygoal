// Calls our Firebase Cloud Functions (payments, bans, admin) from the browser.
const cache = new WeakMap();

/** Returns a callable for `name`, loading the Functions SDK once per transport. */
export async function callable(transport, name, region = 'asia-south1') {
    let entry = cache.get(transport);
    if (!entry) {
        entry = (async () => {
            const mod = await import('https://www.gstatic.com/firebasejs/11.6.1/firebase-functions.js');
            const functions = mod.getFunctions(transport.fb.app, region);
            if (transport.emulators?.functions) mod.connectFunctionsEmulator(functions, ...transport.emulators.functions);
            return { mod, functions };
        })();
        cache.set(transport, entry);
    }
    const { mod, functions } = await entry;
    return mod.httpsCallable(functions, name);
}
