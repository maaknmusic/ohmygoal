# Anonymous Connect

Random one-on-one **video or text** chat with strangers. A static site (plain HTML, CSS and JavaScript modules, no build step) on Firebase.

## Features

- **Matching**: random 1-on-1 video or text chat via a Firestore queue (transactional, so two people never grab the same partner). Shared interests are matched first. **Country** (auto-detected, shown as a flag) and **self-declared gender** filters work both ways.
- **Peer-to-peer**: video over WebRTC, random-chat messages over a data channel, so they're **never stored**. TURN relay included for mobile/strict networks.
- **Quick rounds**: optional 60-second chats, extended only when both people tap "+1 min".
- **Video effects** (on-device, MediaPipe): background blur or replacement, face masks (including full-face masks for anonymity, with the frame blurred if the face is lost), and beauty/colour filters. The partner sees exactly your preview.
- **Safety**:
  - On-device **face age check** with liveness before chatting, re-checked during video calls.
  - On-device **nudity detection** (NSFWJS model in `models/nsfw`): the partner's video stays blurred until checked, is hidden again on explicit content, and the person is auto-reported after repeated detections. Your own camera is switched off on nudity, and 3 strikes lock video for 24 h.
  - **Bans that stick**: age-check and nudity penalties are decided on the server and applied to the person's **IP address, device and account**, so a private window, a cleared browser or a new account doesn't reset them. Banned people see a countdown and can request a review.
  - Report, block, profanity masking, a warning before sharing personal info, rate limiting, and XSS-safe rendering.
- **Friends & accounts**: sign in with Google (upgrades the anonymous account). Adding a friend needs **both** people to agree (enforced by Firestore rules). Friends get a list with online status, saved text chat, and **video calls** that ring.
- **Video, voice or text**: voice chat is audio only (low data, nobody sees you), with avatars whose rings pulse with each person's voice. It needs the updated `firestore.rules` (`bash deploy.sh --rules-only`) because voice is its own matching pool.
- **Games** inside any chat, over the same peer-to-peer connection (no server): Tic-Tac-Toe, Stone-Paper-Scissors (commit-reveal, so nobody can peek), Connect Four, Hand Cricket (odd-even super over) and Word Chain (English or Devanagari). Invite, accept, rematch; they appear as glass over the video or docked in the panel.
- **Reactions and conversation starters**: emoji that float up over the video for both people (double-tap for ❤️), and tappable icebreaker questions based on your shared interests.
- **Scam shield**: phone numbers, UPI IDs, links, social handles, money/OTP talk and photo requests from strangers are masked behind a heads-up card (with "Show anyway" and "Block & next"). Safety sheet with India's 1930 helpline.
- **Anonymous identity**: a generated handle and emoji avatar (dice to re-roll), nothing personal collected.
- **Themes**: dark and light, plus colour themes (Rani and Monsoon free; Diwali, Holi, Chai and Mumbai are Premium).
- **Extras**: live "people online" count, installable app (PWA, works offline), dark/light theme, sounds, keyboard shortcuts, and a layout that works on phones.

## Files

| File | What it is |
|---|---|
| `index.html`, `styles.css` | Page and styles |
| `config.js` | **All settings**: Firebase, TURN, age check, effects, safety |
| `js/app.js` | App logic and UI |
| `js/transport.js` | Matching, signalling, presence (Firebase or local demo) |
| `js/effects.js`, `js/safety.js`, `js/friends.js`, `js/geo.js`, `js/premium.js` | Features |
| `js/games/` | Two-player game engine (`engine.js`), the five games and their UI (`ui.js`) |
| `js/identity.js`, `js/icebreakers.js`, `js/shield.js`, `js/audio-meter.js`, `js/ui.js`, `js/landing.js` | Handles/avatars, conversation starters, scam shield, voice rings, bottom sheets, landing page behaviour |
| `css/landing.css`, `css/chat.css` | Landing page and chat screen styles (`styles.css` holds the shared design tokens) |
| `js/access.js`, `js/fingerprint.js`, `js/cloud.js` | Server-side bans: access check, device fingerprint, Cloud Functions calls |
| `admin.html`, `js/admin.js` | **Admin page**: unban requests, bans, IP whitelist, reports |
| `firestore.rules` | Database security rules: publish with `bash deploy.sh --rules-only` (or paste into the console) |
| `functions/` | Cloud Functions: payments (`index.js`), bans and admin (`moderation.js`) |
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
   It asks for the Key Id, the Key Secret, a webhook secret (any long random text) and the admin Google email(s), then deploys the functions and publishes `firestore.rules`. Later, `bash deploy.sh --rules-only` just republishes the rules.
4. **Webhook:** Razorpay → *Account & Settings → Webhooks → Add new webhook*. Use the URL printed by `deploy.sh` (`https://asia-south1-ohmygoal-c8a4a.cloudfunctions.net/razorpayWebhook`), the same webhook secret, and the event **order.paid**.
5. **Test:** buy a pass on the site with Razorpay test details (e.g. UPI `success@razorpay`, or test card `4111 1111 1111 1111`, any future date and CVV).
6. **Go live:** complete Razorpay KYC (they review the site, so fill in `business` in `config.js`, which feeds `legal.html`). Switch the dashboard to **Live mode**, generate live keys, run `bash deploy.sh --reset-secrets` with them, and add the webhook again in Live mode.

## Bans & the admin page

**How bans work.** On every visit the app calls the `checkAccess` function, which looks up bans for the visitor's **IP address**, **device fingerprint** and **account**, and, if they're allowed, writes a short-lived *access pass* (`access/{uid}`, 2 hours, renewed automatically). The security rules only let people join the matching queue or start a call with a valid pass, so a ban holds even in a private window or a modified copy of the app.

| What happened | Penalty (set in `functions/moderation.js` → `RULES`) |
|---|---|
| Age check estimates under 18 | No chatting for **24 h** |
| Age check inconclusive 3 times within an hour | No chatting for **15 min** |
| Your own camera shows nudity 3 times in a day | **Video** locked for 24 h (text still works) |
| You ban someone from the admin page | Whatever you choose |

Browsers can't read MAC addresses, so the device is identified by a fingerprint: a hash of the browser, screen, graphics card and similar traits. It survives private windows and clearing site data, but not switching to a different browser or device. Phones of the same model and browser version often have the same fingerprint, so a device ban only applies **on the same network neighbourhood** (IPv4 /24, IPv6 /48). That catches someone who reconnects to get a new IP, without banning strangers with the same phone elsewhere. IPv6 addresses are banned by their /64 block, since one home or phone usually has a whole block.

**Admin page:** `admin.html`, at **https://ohmygoal-c8a4a.web.app/admin.html** once `deploy.sh` has published the website to Firebase Hosting. Open it only from there: `raw.githack.com` is one address shared with every other GitHub project, so another site on it could read your admin sign-in. Sign in with a Google account listed in the `ADMIN_EMAILS` secret, which `deploy.sh` asks for (to change it later: `bash deploy.sh --reset-secrets`). There you can:
- **Unban requests:** approve (removes the bans and resets their strike counters, so they can try the age check again), approve and whitelist their IP, or reject.
- **Active bans:** unban, whitelist the IP, or add a ban by IP address or user ID.
- **IP whitelist:** for shared networks. On a whitelisted IP only **account** bans apply (no IP or device bans), so a banned person there could get back in with a private window. Whitelist only when innocent people on that network are being blocked.
- **Reports:** ban the reported person for 24 h, 7 days, or from video only.

The page also shows **your IP as the server sees it**. Check that it matches your real IP (search "what is my ip"); if it shows a Google address instead, IP bans won't work correctly, so tell your developer.

**Shared IP addresses.** Many Indian mobile networks put lots of people behind one IPv4 address, and so do colleges and offices. An IP ban there also blocks innocent people on that network until it expires. If people from one network keep asking for reviews, whitelist that IP; account bans still apply to the person who broke the rules.

### Automatic deploys (optional)
`.github/workflows/firebase-deploy.yml` republishes the rules and functions whenever they change on GitHub. To enable it:
1. Google Cloud console → *IAM & Admin → Service accounts* → create one with the roles **Firebase Admin**, **Firebase Hosting Admin**, **Cloud Functions Admin**, **Service Account User** and **Secret Manager Secret Accessor**.
2. Create a JSON key for it.
3. In GitHub, add the key as the repository secret **FIREBASE_SERVICE_ACCOUNT**.

## Privacy design

What strangers can and can't learn about each other, and what we store:

- **IP address: hidden by default.** All chat traffic goes through your TURN relay (Metered), so the other person never sees an IP address, not even in text chats (WebRTC otherwise exposes it). Menu → **Hide my IP address** turns it off for that person. It is controlled by `privacy.hideIp` in `config.js` and needs working `iceServers` with a `turn:` entry. **Cost:** relayed video uses your relay's bandwidth; check your Metered usage, and set `hideIp: false` if the quota can't carry it. If a relayed connection fails, the person is told how to allow direct connections; nothing falls back silently.
- **Distance (optional, off by default).** Each person's phone rounds its position to a ~5 km grid square (`location.cellDeg` in `config.js`, bigger = more private) and sends only that square to the partner, only if both turned it on. It is never stored or sent to our servers, never used for matching, and shown only as a coarse band ("about 1,200 km away"). Exact distances are deliberately not offered: with a few spoofed positions they would let anyone triangulate where a person lives.
- **Likes ("good vibes").** Counted by the `likeUser` Cloud Function, which checks the chat was real (30 s to 2 h old), that the caller was in it, that the caller has access, and that it is one like per chat, per person per day, with daily caps. Clients can't write counts. Anyone signed in can read one person's count, nobody can list everyone.
- **What a signed-in stranger can read in the database** (the matching queue and presence are public to signed-in users, by design): another person's mode, interests, declared gender, country, their blocked-user ids and a timestamp. IP addresses, device fingerprints, ban records, reports, friend lists, messages, Premium status, access passes and likes' bookkeeping are not readable by clients. An attacker-style test with a second account confirmed that during the review.
- **What a stranger controls**: everything they send over the chat channel is size-limited, rate-limited, validated and shown only as text; extra channels and unwanted media are refused; a flooding partner is disconnected and reported.

## Important before launch
- **Serve the site from your own address, not `raw.githack.com`.** That domain is shared by every GitHub project, so another page there could read the admin's sign-in. `bash deploy.sh` publishes the site to Firebase Hosting at `https://ohmygoal-c8a4a.web.app`, with security headers (no framing, no sniffing, referrer policy). Use that address for the admin page and, ideally, for everyone.
- **The TURN username and password in `config.js` are public** (every browser needs them). Anyone can use your relay's bandwidth with them. Rotate them in the Metered dashboard if you see unexpected usage; short-lived credentials issued by a Cloud Function are the proper fix.
- **Age and nudity checks run in the browser**, so a modified browser can skip them. Bans, access passes and reports are enforced on the server, but the age estimate itself is advisory. For stronger guarantees use a certified age-assurance provider (`ageCheck.fallbackUrl`).
- **Face age estimation is an estimate, not proof.** In testing with stock photos, the model rated several adults as 19–24 and several teenagers as 20–24. So the pass age is **21** (`ageCheck.passAge`): estimates under 18 lock the person out for 24 h (IP address, device and account), and 18–20 are "inconclusive", allowing 3 tries and then a 15-minute cooldown. Raising it to 25 ("Challenge 25") stops more teenagers but sends many real adults under 25 to "inconclusive". Set `ageCheck.fallbackUrl` to an ID-document verification provider so they still have a way in.
- **The check runs in the browser**, so a technical user can bypass it (for example by faking the camera). Lockouts are enforced by the server, but the age estimate itself isn't. For stronger guarantees, use a certified age-assurance provider that verifies on its own servers.
- Review reports and unban requests on the admin page regularly.
- **Matching runs in the users' browsers.** The rules enforce the important parts: Premium filters and priority on your own queue entry, block lists and the other person's filters when claiming, and real rooms. But anyone signed in can read the waiting queue (mode, declared gender, country, interests). A technically skilled free user could modify their copy of the app to pick whom to claim, giving themselves a filter-like effect. Closing that completely means moving matching into a Cloud Function, which would be a good next step once payments are live.
- Refunds are handled in the Razorpay dashboard. To also remove the Premium time, edit `premiumUntil` in `entitlements/{uid}` in the Firestore console.
