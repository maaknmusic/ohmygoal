// Shared Firebase Admin setup for all functions (imported first so the app is initialised once).
import { setGlobalOptions } from 'firebase-functions/v2';
import { defineString, defineBoolean } from 'firebase-functions/params';
import { initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

setGlobalOptions({ region: 'asia-south1', maxInstances: 10 });
initializeApp();
export const db = getFirestore();
export const APP_ID = defineString('APP_ID', { default: 'anon-connect' });

/**
 * Firebase App Check for the callable functions. While this is false the functions still check the App Check token and the
 * Firebase console counts verified and unverified calls, but nobody is turned away. Set ENFORCE_APP_CHECK=true in functions/.env and
 * deploy again to refuse calls that do not come from the real website (see README "Bots and App Check").
 */
export const ENFORCE_APP_CHECK = defineBoolean('ENFORCE_APP_CHECK', { default: false });

/** Options every callable function shares: pass your own options (secrets, memory...) and they are added to these. */
export const callOpts = (options = {}) => ({ enforceAppCheck: ENFORCE_APP_CHECK, ...options });

/** Documents clients can see (subject to firestore.rules). */
export const publicDoc = path => db.doc(`artifacts/${APP_ID.value()}/public/data/${path}`);
export const publicCol = name => db.collection(`artifacts/${APP_ID.value()}/public/data/${name}`);
/** Server-only documents: no rule matches this tree, so clients can never read or write it. */
export const privateDoc = path => db.doc(`artifacts/${APP_ID.value()}/private/data/${path}`);
export const privateCol = name => db.collection(`artifacts/${APP_ID.value()}/private/data/${name}`);
