# Anonymous Connect

Random one-on-one **video or text** chat with strangers. Everything is in a single `index.html` file, with no build step.

## Features

- **Matching**: random 1-on-1 video or text chat via a Firestore queue (transactional, so two people never grab the same partner). Shared interests are matched first. **Country** (auto-detected, shown as a flag) and **self-declared gender** filters work both ways.
- **Peer-to-peer**: video over WebRTC, random-chat messages over a data channel, so they're **never stored**. TURN relay included for mobile/strict networks.
- **Quick rounds**: optional 60-second chats, extended only when both people tap "+1 min".
- **Video effects** (on-device, MediaPipe): background blur or replacement, face masks (including full-face masks for anonymity, with the frame blurred if the face is lost), and beauty/colour filters. The partner sees exactly your preview.
- **Safety**:
  - On-device **face age check** with liveness before chatting, re-checked during video calls.
  - On-device **nudity detection** (NSFWJS model in `models/nsfw`): the partner's video stays blurred until checked, is hidden again on explicit content, and the person is auto-reported after repeated detections. Your own camera is switched off on nudity, and 3 strikes lock video for 24 h.
  - Report, block, profanity masking, a warning before sharing personal info, rate limiting, and XSS-safe rendering.
- **Friends & accounts**: sign in with Google (upgrades the anonymous account). Adding a friend needs **both** people to agree (enforced by Firestore rules). Friends get a list with online status, saved text chat, and **video calls** that ring.
- **Extras**: live "people online" count, installable app (PWA, works offline), dark/light theme, sounds, keyboard shortcuts, and a layout that works on phones.

## Files

| File | What it is |
|---|---|
| `index.html`, `styles.css` | Page and styles |
| `config.js` | **All settings**: Firebase, TURN, age check, effects, safety |
| `js/app.js` | App logic and UI |
| `js/transport.js` | Matching, signalling, presence (Firebase or local demo) |
| `js/effects.js`, `js/safety.js`, `js/friends.js`, `js/geo.js` | Features |
| `firestore.rules` | Database security rules: publish with `bash deploy.sh --rules-only` (or paste into the console) |
| `functions/` | Payment Cloud Functions (Razorpay) |
| `deploy.sh`, `firebase.json`, `.firebaserc` | One-command deploy of rules + functions |
| `legal.html` | Terms, Privacy, Refunds, Delivery, Contact (needed by Razorpay) |
| `sw.js`, `manifest.webmanifest`, `icons/` | Installable app |

## Running it

### Local demo (no setup)
Serve the folder and open the page in **two tabs of the same browser**:

```bash
python3 -m http.server 8000
# open http://localhost:8000 in two tabs
```

With no Firebase config, the app matches tabs with each other through `BroadcastChannel`.

### Production (Firebase)
1. Create a Firebase project. Enable **Anonymous** sign-in and **Cloud Firestore**.
2. Paste your web config into `firebase` in `config.js`. For friends, enable the **Google** sign-in provider and add your site's domain under Authentication → Settings → Authorized domains.
3. Deploy `firestore.rules`.
4. Add a **TURN server** to `iceServers` in `config.js`. Without one, roughly 10–20% of users (strict NATs, mobile carriers) can't connect.
5. Optional: set `geminiApiKey` in `config.js` to turn on translation. Put the key behind a proxy before going public.
6. Recommended: add a Firestore TTL policy on `queue.ts`, and on `rooms` / `signals`, to clean up abandoned docs.

## Accounts & Premium

| | Anonymous | Signed in with Google | Google + Premium pass |
|---|---|---|---|
| Random video/text chat, interests, quick rounds | ✅ | ✅ | ✅ |
| Blur background, 🕶️ mask, Beauty filter | ✅ | ✅ | ✅ |
| Friends: add, chat, video call | – | ✅ | ✅ |
| Gender & country filters, priority matching | – | – | ✅ |
| All backgrounds, masks & filters, 👑 badge | – | – | ✅ |

Premium passes (₹49 / 7 days, ₹149 / 30 days, ₹349 / 90 days) are **one-time payments** through Razorpay. Prices are set in `functions/index.js` (`PLANS`); the labels shown in the app are in `config.js` (`premium.plans`).

**How it stays secure:** the browser can't grant Premium. `functions/index.js` creates each order at the server price, checks Razorpay's signature, confirms the payment was captured for the right amount, and only then writes `entitlements/{uid}`, a collection the security rules make read-only for users. The rules also refuse filters or priority in the matching queue without an active pass. A webhook grants the pass if the buyer closes the page early, and granting is idempotent, so retries can't double it.

### Setting up payments
1. **Firebase Blaze plan:** Firebase console → ⚙ → *Usage and billing* → *Modify plan* → **Blaze**. Set a budget alert (e.g. ₹500). Cloud Functions need it; small sites usually stay within the free allowance.
2. **Razorpay account:** sign up at https://dashboard.razorpay.com. In **Test mode**: *Account & Settings → API Keys → Generate key*. Keep the **Key Id** and **Key Secret**.
3. **Deploy:** open https://shell.cloud.google.com (signed in as the Firebase project owner) and run:
   ```bash
   git clone https://github.com/maaknmusic/ohmygoal && cd ohmygoal && bash deploy.sh
   ```
   It asks for the Key Id, the Key Secret and a webhook secret (any long random text), then publishes `firestore.rules` and the functions. Later, `bash deploy.sh --rules-only` just republishes the rules.
4. **Webhook:** Razorpay → *Account & Settings → Webhooks → Add new webhook*. Use the URL printed by `deploy.sh` (`https://asia-south1-ohmygoal-c8a4a.cloudfunctions.net/razorpayWebhook`), the same webhook secret, and the event **order.paid**.
5. **Test:** buy a pass on the site with Razorpay test details (e.g. UPI `success@razorpay`, or test card `4111 1111 1111 1111`, any future date and CVV).
6. **Go live:** complete Razorpay KYC (they review the site, so fill in `business` in `config.js`, which feeds `legal.html`). Switch the dashboard to **Live mode**, generate live keys, run `bash deploy.sh --reset-secrets` with them, and add the webhook again in Live mode.

### Automatic deploys (optional)
`.github/workflows/firebase-deploy.yml` republishes the rules and functions whenever they change on GitHub. To enable it:
1. Google Cloud console → *IAM & Admin → Service accounts* → create one with the roles **Firebase Admin**, **Cloud Functions Admin**, **Service Account User** and **Secret Manager Secret Accessor**.
2. Create a JSON key for it.
3. In GitHub, add the key as the repository secret **FIREBASE_SERVICE_ACCOUNT**.

## Important before launch
- **Face age estimation is an estimate, not proof.** In testing with stock photos, the model rated several adults as 19–24 and several teenagers as 20–24. That's why the pass age is 25 (the same idea as "Challenge 25" in shops). The cost is that many real 18–24-year-olds will get "inconclusive". Set `ageCheck.fallbackUrl` to an ID-document verification provider so they still have a way in.
- **The check runs in the browser**, so a technical user can bypass it, and clearing site data removes the lockout. For stronger guarantees, use a certified age-assurance provider that verifies on its own servers.
- Moderators need a way to review the `reports` collection.
