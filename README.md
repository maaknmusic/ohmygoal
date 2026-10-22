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
- **Games** inside any chat, over the same peer-to-peer connection (no server): Tic-Tac-Toe, Stone-Paper-Scissors (commit-reveal, so nobody can peek), Four in a Row, Hand Cricket (odd-even super over) and Word Chain (English or Devanagari). Invite, accept, rematch; they appear as glass over the video or docked in the panel.
- **Reactions and conversation starters**: original drawn reactions (12 sprites made in code, no emoji) that float up over the video for both people: tap for one, press and hold for a burst, double-tap the video for a heart. The Premium pack adds stars, party poppers, balloons, rainbows, gems and sparks. Plus tappable icebreaker questions based on your shared interests.
- **Scam shield**: phone numbers, UPI IDs, links, social handles, money/OTP talk and photo requests from strangers are masked behind a heads-up card (with "Show anyway" and "Block & next"). Safety sheet with India's 1930 helpline.
- **Anonymous identity**: a generated handle and emoji avatar (dice to re-roll), nothing personal collected.
- **Languages**: everyone can pick **My language** (45 languages) in the preferences; chat partners see it ("Speaks हिन्दी"). Anonymous people keep it only in the browser; with a Google sign-in it is saved in the account together with nickname, avatar, interests and gender, so it follows the person to other devices.
- **Live translate (Premium)**: translate what you receive and/or what you type, one tap, in any chat. On the device when the browser can, otherwise through our server (see *Live translate* below).
- **Themes**: dark and light, plus colour themes (Rani and Monsoon free; Diwali, Holi, Chai and Mumbai are Premium).
- **Extras**: live "people online" count, installable app (PWA, works offline), dark/light theme, sounds, keyboard shortcuts, and a layout that works on phones.

## Files

| File | What it is |
|---|---|
| `index.html`, `styles.css` | Page and styles |
| `config.js` | **All settings**: Firebase, TURN, age check, effects, safety |
| `js/app.js` | App logic and UI |
| `js/transport.js` | Matching, signalling, presence (Firebase or local demo) |
| `js/effects.js` | Video effects pipeline (MediaPipe): backgrounds, masks, filters |
| `js/masks.js`, `js/mask-art.js`, `js/mask-kit.js` | Original vector face masks (drawn in code), face tracking and fitting |
| `js/backgrounds.js`, `js/matte.js`, `js/matte-gl.js` | Original background scenes, person cut-out smoothing, blur |
| `js/effects.js`, `js/safety.js`, `js/friends.js`, `js/geo.js`, `js/premium.js` | Features |
| `js/games/` | Two-player game engine (`engine.js`), the five games and their UI (`ui.js`) |
| `js/identity.js`, `js/icebreakers.js`, `js/shield.js`, `js/audio-meter.js`, `js/ui.js`, `js/landing.js` | Handles/avatars, conversation starters, scam shield, voice rings, bottom sheets, landing page behaviour |
| `js/languages.js`, `js/profile.js` | The 45 languages and their helpers; the Google-account profile (language, nickname, avatar, interests, gender) kept in sync with the browser |
| `js/translate.js`, `js/livetranslate.js`, `css/translate.css` | Live translate: the engine (on-device first, queue, cache, limits) and the chat UI (switches, slim bar, lines under messages) |
| `css/landing.css`, `css/chat.css` | Landing page and chat screen styles (`styles.css` holds the shared design tokens) |
| `js/access.js`, `js/fingerprint.js`, `js/cloud.js` | Server-side bans: access check, device fingerprint, Cloud Functions calls |
| `admin.html`, `js/admin.js` | **Admin page**: unban requests, bans, IP whitelist, reports |
| `firestore.rules` | Database security rules: publish with `bash deploy.sh --rules-only` (or paste into the console) |
| `functions/` | Cloud Functions: payments (`index.js`), bans and admin (`moderation.js`), Live translate (`translate.js`, `languages.js`) |
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
5. Live translate needs the Vertex AI API enabled once (see *Live translate* below). No API key goes into `config.js`.
6. Cleanup is automatic: rooms, connection-setup messages, dead queue entries and presence older than a day, and old appeal / visit records (see Privacy design) are removed by a small sweep that runs on a share of visits and whenever the admin overview opens. No TTL policy is needed.

## Accounts & Premium

| | Anonymous | Signed in with Google | Google + Premium pass |
|---|---|---|---|
| Random video/text chat, interests, quick rounds | ✅ | ✅ | ✅ |
| Blur background, 🕶️ mask, Beauty filter | ✅ | ✅ | ✅ |
| Friends: add, chat, video call | – | ✅ | ✅ |
| Gender & country filters, priority matching | – | – | ✅ |
| Live translate | – | – | ✅ |
| My language (shown to partners, saved in the browser or the Google account) | ✅ | ✅ | ✅ |
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

## Live translate (Premium)

Chat with someone in another language. Premium people open it from the globe button in the chat (on phones: **Menu in the chat header → This chat → Live translate**, or the slim bar that appears above the message box). Everyone can pick **My language** in the preferences; free people who tap Live translate get the Premium sheet.

**What it does**
- **Translate messages I receive** into my language (or another one I pick): the message reads in my language, with a small line *🌐 Hindi → English · Show original*. A message already in my language is left alone; emoji, numbers, links and messages over 400 characters are not translated.
- **Translate what I type** into the partner's language (available once they have chosen one that differs from mine): the partner gets the translated text with my original wording underneath, and my own message shows *Sent as Hindi: …*. If a translation fails, the original text is sent unchanged and the message says so.
- When the partner's language is known and differs from mine, Premium people get a one-tap suggestion ("Hindi speaker: turn on live translate?") once per chat.
- Off by default, per chat: it resets on Next. *Remember my choice for new chats* keeps the switches as they were (`ac.translate` in localStorage). It turns itself off if Premium ends or the person signs out.

**Where the text goes**
1. **On the device first.** If the browser has the built-in Translator / Language Detector (Chrome), the message is translated there: free, private, nothing is sent. Language packs download on first use (the sheet shows the progress).
2. **Otherwise our server.** The browser calls the `translateText` Cloud Function (`functions/translate.js`, region `asia-south1`), which asks Gemini 2.5 Flash-Lite on Vertex AI to translate the one message. The text is never stored or logged; the function keeps only a 30-minute in-memory cache of short messages and a list of request times per person for the limits. Message text is untrusted data for the model, and its answer is validated (shape, language code, length, no new links) before it is used.
3. Nothing is translated, on the device or on the server, unless the person turned the matching switch on, and the privacy policy (`legal.html`) says so.

The chat itself is unchanged: random-chat messages still travel peer to peer and are never stored. The only new fields on the data channel are `lang` in the greeting (only when the person chose a language) and `orig` / `olang` on a message the sender translated (both checked as untrusted input and run through the scam shield, like the message).

**Limits** (constants at the top of `functions/translate.js`, `SETTINGS`): 30 translations per person per minute and 500 per day, 400 characters per message. The browser also queues requests (one at a time, 8 waiting at most, ten-second time-out, never while the tab is hidden) and shows a note once if a limit is reached.

**Cost.** Gemini 2.5 Flash-Lite is about $0.10 per million input tokens and $0.40 per million output tokens. One short chat message costs roughly 0.002 to 0.006 US cents (the fixed instruction is most of the input), so a million translated messages cost on the order of $20 to $60. Cloud Translation would be about $20 per million characters, roughly 20 to 50 times more for chat-sized messages. The per-person daily cap bounds the worst case to about three US cents per Premium person per day, and every message translated on the device costs nothing.

**One-time setup** (the owner, from Cloud Shell as the project owner):
```bash
gcloud services enable aiplatform.googleapis.com --project ohmygoal-c8a4a
# the functions' service account needs the Vertex AI User role unless it already has Editor:
gcloud projects add-iam-policy-binding ohmygoal-c8a4a \
  --member=serviceAccount:<project-number>-compute@developer.gserviceaccount.com --role=roles/aiplatform.user
bash deploy.sh        # functions, rules (the new `profiles` collection), hosting
```
Until the API is enabled the function answers *Translation is unavailable right now* and the app shows a small retry link; browsers that translate on the device keep working. Model and region can be changed with `TRANSLATE_MODEL` / `TRANSLATE_LOCATION` in `functions/.env`.

**Language profile.** For a Google account the preferences are stored in `artifacts/<app>/public/data/profiles/{uid}`: readable and writable only by that account (and only with a Google sign-in), with a strict schema in `firestore.rules`. After signing in the app loads it (what the account holds wins; a missing document is created from the values on the device), and later edits are saved a moment after they are made. Anonymous accounts never write it.

## Bans & the admin page

**How bans work.** On every visit the app calls the `checkAccess` function, which looks up bans for the visitor's **IP address**, **device fingerprint** and **account**, and, if they're allowed, writes a short-lived *access pass* (`access/{uid}`, 2 hours, renewed automatically). The security rules only let people join the matching queue or start a call with a valid pass, so a ban holds even in a private window or a modified copy of the app.

| What happened | Penalty (set in `functions/moderation.js` → `RULES`) |
|---|---|
| Age check estimates under 18 | No chatting for **24 h** |
| Age check inconclusive 3 times within an hour | No chatting for **15 min** |
| Your own camera shows nudity 3 times in a day | **Video** locked for 24 h (text still works) |
| You ban someone from the admin page | Whatever you choose |

Browsers can't read MAC addresses, so the device is identified by a fingerprint: a hash of the browser, screen, graphics card and similar traits. It survives private windows and clearing site data, but not switching to a different browser or device. Phones of the same model and browser version often have the same fingerprint, so a device ban only applies **on the same network neighbourhood** (IPv4 /24, IPv6 /48). That catches someone who reconnects to get a new IP, without banning strangers with the same phone elsewhere. IPv6 addresses are banned by their /64 block, since one home or phone usually has a whole block.

**Admin page:** `admin.html`, at **https://ohmygoal.web.app/admin.html** once `deploy.sh` has published the website to Firebase Hosting. Open it only from there: `raw.githack.com` is one address shared with every other GitHub project, so another site on it could read your admin sign-in. Sign in with a Google account listed in the `ADMIN_EMAILS` secret, which `deploy.sh` asks for (to change it later: `bash deploy.sh --reset-secrets`). There you can:
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

- **IP address: hidden for Premium, direct for everyone else.** Chats are peer-to-peer, so a free user's IP address is visible to the person they chat with (as in any video call). **Hide my IP address** (Menu) is a Premium feature: it sends all of that person's chat traffic through your TURN relay (Cloudflare), so the other person never sees an IP address, not even in text chats. Premium users start with it on (`privacy.hideIpForPremium` in `config.js`) and can switch it off; it needs working `iceServers` with a `turn:` entry. Free users still use the relay automatically on networks that block direct connections (that traffic is the relay's main load; see HANDOFF.md for capacity numbers). If a relayed connection fails for a Premium user, they are told how to allow direct connections; nothing falls back silently.
- **Distance (optional, off by default).** Each person's phone rounds its position to a ~5 km grid square (`location.cellDeg` in `config.js`, bigger = more private) and sends only that square to the partner, only if both turned it on. It is never stored or sent to our servers, never used for matching, and shown only as a coarse band ("about 1,200 km away"). Exact distances are deliberately not offered: with a few spoofed positions they would let anyone triangulate where a person lives.
- **Likes ("good vibes").** Counted by the `likeUser` Cloud Function, which checks the chat was real (30 s to 2 h old), that the caller was in it, that the caller has access, and that it is one like per chat, per person per day, with daily caps. Clients can't write counts. Anyone signed in can read one person's count, nobody can list everyone. Rooms themselves can only be created by the matchmaking claim (stamped with server time, with a person who is really waiting in the queue) or between two accepted friends, so a browser can't invent a chat with a chosen victim to farm likes or reports. Two accounts that collude can still exchange likes, which the per-pair and daily caps limit.
- **What a signed-in stranger can read in the database** (the matching queue and presence are public to signed-in users, by design): another person's mode, interests, declared gender, country, their blocked-user ids and a timestamp. IP addresses, device fingerprints, ban records, reports, friend lists, messages, Premium status, access passes and likes' bookkeeping are not readable by clients. An attacker-style test with a second account confirmed that during the review.
- **Live translate and languages.** Translation is off until a person turns it on in a chat; then only the messages it covers are translated, on the device when the browser can (nothing leaves it), otherwise through the `translateText` function to Vertex AI. The text is never stored or logged on our side. The language a person chooses is shown to their chat partner; the profile document of a Google account (language, nickname, avatar, interests, gender) can only be read or written by that account, and anonymous accounts never have one.
- **What a stranger controls**: everything they send over the chat channel is size-limited, rate-limited, validated and shown only as text; extra channels and unwanted media are refused; a flooding partner is disconnected and reported.

## Important before launch
- **Serve the site from your own address, not `raw.githack.com`.** That domain is shared by every GitHub project, so another page there could read the admin's sign-in. `bash deploy.sh` publishes the site to Firebase Hosting at `https://ohmygoal-c8a4a.web.app`, with security headers (no framing, no sniffing, referrer policy). Use that address for the admin page and, ideally, for everyone.
- **Relay (TURN) = Cloudflare Realtime TURN, with short-lived credentials.** The long-term TURN key lives in Secret Manager (`CF_TURN_KEY_ID`, `CF_TURN_API_TOKEN`, asked for by `deploy.sh`); the `turnCredentials` function hands signed-in people with an access pass a 4-hour credential (shared for an hour, at most 30 requests per person per hour), so nothing relay-related is public in `config.js`. Setup: Cloudflare dashboard → **Realtime → TURN Server → Create**, copy the Key ID and API Token, then run `bash deploy.sh` (it only asks for secrets that are not set yet; `--reset-secrets` would ask for all of them again, Razorpay included). Type `unset` for both to run without a relay (chats connect directly; Premium "Hide my IP address" is then unavailable). Cost: $0.05/GB of relayed data leaving Cloudflare, first 1,000 GB a month free.
- **Age and nudity checks run in the browser**, so a modified browser can skip them. Bans, access passes and reports are enforced on the server, but the age estimate itself is advisory. For stronger guarantees use a certified age-assurance provider (`ageCheck.fallbackUrl`).
- **Face age estimation is an estimate, not proof.** In testing with stock photos, the model rated several adults as 19–24 and several teenagers as 20–24. So the pass age is **21** (`ageCheck.passAge`): estimates under 18 lock the person out for 24 h (IP address, device and account), and 18–20 are "inconclusive", allowing 3 tries and then a 15-minute cooldown. Raising it to 25 ("Challenge 25") stops more teenagers but sends many real adults under 25 to "inconclusive". Set `ageCheck.fallbackUrl` to an ID-document verification provider so they still have a way in.
- **The check runs in the browser**, so a technical user can bypass it (for example by faking the camera). Lockouts are enforced by the server, but the age estimate itself isn't. For stronger guarantees, use a certified age-assurance provider that verifies on its own servers.
- Review reports and unban requests on the admin page regularly.
- **Bans from self-reported age/nudity results cover the whole IP address.** That is what makes a ban hold in a private window, but on a shared network (college, office, mobile carrier) one person calling the function directly can lock out everyone behind that IP for 24 h. Remedy: whitelist that network on the admin page (the ban then applies to the account only). Premium status is private (only you can read your own pass); the matching queue still carries a `premium` flag so Premium people are matched first, which any signed-in user can see.
- Old records are cleaned up when the admin overview is opened: appeals and IP/device visit records after 90 days, expired bans after 30 days, counters after a week.
- **Matching runs in the users' browsers.** The rules enforce the important parts: Premium filters and priority on your own queue entry, block lists and the other person's filters when claiming, and real rooms. But anyone signed in can read the waiting queue (mode, declared gender, country, interests). A technically skilled free user could modify their copy of the app to pick whom to claim, giving themselves a filter-like effect. Signalling documents are limited to the four WebRTC message kinds with bounded sizes, and each report is stored under `reporter_room_reason`, so a person can't flood moderators with copies. Closing the matching gap completely means moving matching into a Cloud Function, which would be a good next step once payments are live.
- Refunds are handled in the Razorpay dashboard. To also remove the Premium time, edit `premiumUntil` in `entitlements/{uid}` in the Firestore console.
