// Shared Firebase Admin setup for all functions (imported first so the app is initialised once).
import { setGlobalOptions } from 'firebase-functions/v2';
import { defineString } from 'firebase-functions/params';
import { initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

setGlobalOptions({ region: 'asia-south1', maxInstances: 10 });
initializeApp();
export const db = getFirestore();
export const APP_ID = defineString('APP_ID', { default: 'anon-connect' });

/** Documents clients can see (subject to firestore.rules). */
export const publicDoc = path => db.doc(`artifacts/${APP_ID.value()}/public/data/${path}`);
export const publicCol = name => db.collection(`artifacts/${APP_ID.value()}/public/data/${name}`);
/** Server-only documents: no rule matches this tree, so clients can never read or write it. */
export const privateDoc = path => db.doc(`artifacts/${APP_ID.value()}/private/data/${path}`);
export const privateCol = name => db.collection(`artifacts/${APP_ID.value()}/private/data/${name}`);
