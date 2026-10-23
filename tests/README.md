# Tests

Not published to the website (excluded in `firebase.json`).

## Unit tests (no setup)
```
node --test tests/unit/*.test.mjs        # ~1,300 tests, about 5 seconds
```
They import the modules from `/home/user/ohmygoal/js/...`: if you cloned elsewhere, replace that prefix.

## Browser tests (local demo mode, no Firebase)
Need `npm i playwright` (Chromium), a static server (`python3 -m http.server 8765` in the repo root) and
`NODE_PATH` pointing at the global `node_modules`. Run from anywhere:
```
node tests/e2e/v2.mjs <scratch-dir>   # UI flows on desktop and phone
node tests/e2e/admin-inbox.mjs <scratch>   # admin Inbox (needs the emulators)
node tests/e2e/admin-analytics.mjs <scratch>   # admin Dashboard, Premium, Payments, People, CSV (needs the emulators)
node tests/e2e/hardening.mjs          # hostile peer (floods, oversize frames, extra channels)
node tests/e2e/distance.mjs           # approximate distance
node tests/e2e/world-languages.mjs <scratch>   # the 8 world languages on the landing page, Arabic right-to-left, phone and desktop
node tests/e2e/world-narrow.mjs <scratch>      # the language picker fits at 320-390 px in every language
node tests/e2e/reactions.mjs          # drawn reactions: tap, hold burst, Premium pack, hostile peer, phone
node tests/e2e/failclosed.mjs         # masks never fall back to the raw camera; distance toggle race
node tests/e2e/translate-live-demo.mjs <scratch-dir>   # Live translate (fake on-device Translator): sheet, receive/send, failures, queue, hostile frames, phones
node tests/e2e/translate-demo.mjs <scratch-dir>        # My language selector, localStorage, hello.lang, "Speaks ..." on the match card
node tests/e2e/masks.mjs              # every mask on a real face (needs the MediaPipe files, see the header of the script)
node tests/e2e/backgrounds.mjs        # matte stability, blur, every scene, custom photo (same requirements)
```
Two pages of one browser context match each other in demo mode.

## Emulator tests (rules + Cloud Functions)
1. `npm i firebase-tools` in a scratch dir, copy `firestore.rules` and `functions/` (with `.env.local` setting
   `RAZORPAY_API=http://127.0.0.1:7777` and a fake `.secret.local`) next to a `firebase.json` that enables the auth (9099),
   firestore (8080) and functions (5001) emulators. Start with `NO_PROXY=127.0.0.1,localhost firebase emulators:start
   --only auth,firestore,functions --project demo-ohmygoal`. Restart it after every rules change (hot reload is unreliable).
2. `node tests/e2e/mockrzp.mjs &` (fake Razorpay and Cloudflare TURN on :7777).
3. Install the web SDK (`npm i firebase@11.6.1`) and pass its folder via the path the scripts read (`FB`, `<scratch>/fb`).
4. `fixes.mjs` (rules attacks, real matching, signalling, reports), `friends.mjs`, `bans.mjs` (58 checks),
   `premium.mjs` (22), `privacy.mjs` (attacker reads/writes), `likes.mjs` (52).

## Android and push
`android/README.md` has the steps to package the site as an Android app and to switch on friend notifications.
