// Friend notifications on this device (web push through Firebase Cloud Messaging; the Android app uses the same thing).
// Everything here is opt-in and needs a Google sign-in, because notifications are about friends. The token is kept on the server
// in a private document (see functions/push.js); this file only asks the browser for permission and hands the token over.
import { callable } from './cloud.js';

const FCM_VERSION = '11.6.1';

export const pushSupported = () => typeof window !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;

/** 'granted' | 'denied' | 'default' | 'unsupported' */
export const pushPermission = () => (pushSupported() ? Notification.permission : 'unsupported');

/**
 * Asks for permission (call this from a tap), gets this device's token and registers it.
 * @returns {Promise<{ok: true, token: string} | {ok: false, reason: 'unsupported'|'denied'|'no-key'|'failed'}>}
 */
export async function enablePush({ transport, region, vapidKey, friendOnline = false, shareOnline = false }) {
    if (!pushSupported()) return { ok: false, reason: 'unsupported' };
    if (!vapidKey || !transport?.fb?.app) return { ok: false, reason: 'no-key' };
    try {
        const permission = Notification.permission === 'granted' ? 'granted' : await Notification.requestPermission();
        if (permission !== 'granted') return { ok: false, reason: 'denied' };
        const [reg, mod] = await Promise.all([
            navigator.serviceWorker.ready,
            import(`https://www.gstatic.com/firebasejs/${FCM_VERSION}/firebase-messaging.js`),
        ]);
        const token = await mod.getToken(mod.getMessaging(transport.fb.app), { vapidKey, serviceWorkerRegistration: reg });
        if (!token) return { ok: false, reason: 'failed' };
        const fn = await callable(transport, 'registerPush', region);
        await fn({ token, friendOnline, shareOnline });
        return { ok: true, token };
    } catch (e) {
        console.warn('enabling notifications failed', e);
        return { ok: false, reason: 'failed' };
    }
}

/** Stops notifications for this device (or for all devices when no token is known). */
export async function disablePush({ transport, region, token }) {
    try {
        const fn = await callable(transport, 'unregisterPush', region);
        await fn(token ? { token } : {});
        return true;
    } catch (e) {
        console.warn('disabling notifications failed', e);
        return false;
    }
}

/** Tells the server this person just opened the app (friends who asked to hear it get a notification, if they opted in). */
export async function announceOnline({ transport, region }) {
    try { const fn = await callable(transport, 'announceOnline', region); return (await fn()).data; } catch { return null; }
}
