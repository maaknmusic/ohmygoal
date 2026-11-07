# Handoff notes (project state and what is left)

OhMyGoal: random video / voice / text chat (WebRTC P2P, Firestore signalling, Firebase Hosting + Functions, Razorpay Premium).
Read `README.md` first (files, deploy, privacy design). Tests: `tests/README.md`.

## State
- `main` holds the v2 redesign (new UI, games, voice, themes, likes, approximate distance, relay-only IP hiding, tightened rules), group rooms, Live sessions with host payouts, coin gifting between users, and interface languages (see below).
- **Address:** the live site is **https://ohmygoal.app** (confirmed working, deployed and loading). The old `ohmygoal.web.app` still answers but `js/move-domain.js` sends visitors to the new address. DNS lives in Cloudflare and those records must stay **DNS-only** (grey cloud). `ohmygoal.app` and `www.ohmygoal.app` must stay in Firebase Auth → Authorized domains and in the reCAPTCHA key's domains.
- Production needs `bash deploy.sh` (functions, then rules, then hosting) from Google Cloud Shell after every merge.
- All test suites passed on the last run: unit (~1,300), UI (v2, hardening, distance, failclosed), emulator (fixes, friends, bans 58, premium 22, privacy, likes 52).

## Live sessions, payouts and coin gifting (current rules)
Full description: `README.md` (*Live sessions*, *Gifting coins*). The real numbers live in `functions/live.js` and `functions/gifts.js`; `js/live.js` holds a display-only copy and a unit test keeps the two equal. All money moves on the server in transactions.
- **Who can host:** anyone signed in with Google, no approval. Voice rooms hold 8 people, video rooms 4. A session closes by itself after 3 hours, or when the host has been silent for 3 minutes. Max 12 starts per account per day.
- **Prices:** going live costs **49 coins**; **each account's first session is free**. Public sessions are free for guests; in a private session each guest pays **200 coins**.
- **Shares:** the host earns **70%** of every gift and private fee (rounded down), the platform **30%**.
- **Payouts:** an earned coin is worth **₹0.75**; the minimum payout is **300 earned coins** (about ₹225). Payouts are **manual**: the host enters a UPI ID or bank details, an admin pays outside the app and marks it paid with a reference (Admin → Hosts). Rejecting a request returns the coins. Admins can suspend or reinstate hosts there too.
- **Coin gifting between users** (`functions/coingifts.js`, constants in `functions/gifts.js`): only **bought** coins can be gifted; the platform keeps **30%** and the recipient gets **70%** as spend-only coins (cannot be cashed out or gifted again). **10 to 500 coins per gift, 1,000 coins per day, 20 gifts per hour.** Only to someone you are with now (open one-to-one chat, or the same running live session); the recipient must be signed in with Google.
- **Coins and gifts:** packs 60 / 200 / 500 coins (₹49 / ₹149 / ₹349); free daily coins 2 (5 for Premium); gifts 5 to 50 coins; at most 30 gifts per hour; wallet cap 100,000 coins.
- **Deploy:** any change to these rules is in `functions/` (and `firestore.rules` for the private tree), so run `bash deploy.sh`.

## Interface languages
- English is the source text in the HTML and JS. `js/i18n.js` translates by exact English string; each language is `js/i18n/<code>.js` (see the header of `js/i18n.js`). A key containing `{}` is a template; the first matching key wins, so put specific templates **before** generic ones such as `"{} coins"`.
- Complete: hi, es, pt, ar (right to left), id, tr, ru, fr, de. These nine must have identical key sets in the same order (`tests/unit/i18n.test.mjs`).
- Only partly translated (about 110 keys, none of the Live sessions or coin-gifting texts yet): bn, ta, te, mr, gu, kn, ml, pa. Untranslated text simply stays English.
- When you add English text to the UI: add the key to all nine complete files. Text that other people wrote (nicknames, session titles, chat) must sit in an element with `data-no-i18n`. `<option>` text, `confirm()` boxes and server messages are translated only because the code passes them through `ctx.t` (`i18n.t`).

## Still open
1. `config.js` → `business` (email, phone, address): empty. Razorpay's live-mode review and `legal.html` need them.
2. Razorpay: still in test mode until KYC / go-live is done; then `bash deploy.sh --reset-secrets` with the live keys.
3. Relay: Cloudflare Realtime TURN via the `turnCredentials` function (see README). Needs `CF_TURN_KEY_ID` / `CF_TURN_API_TOKEN` secrets. If they are `unset`, chats connect directly and Premium IP hiding is unavailable. The old Metered password is in git history: delete or rotate that app in the Metered dashboard.
4. Live translate (Premium) needs a one-time setup before it works on the live site: enable the Vertex AI API (`gcloud services enable aiplatform.googleapis.com --project ohmygoal-c8a4a`), make sure the functions' service account has `roles/aiplatform.user` (or Editor), then `bash deploy.sh` (functions + the new `profiles` rules). Details, limits and cost: README, section *Live translate*. Until then the function answers "Translation is unavailable right now" (browsers that translate on the device still work).
5. Accepted / deferred review findings:
   - presence is readable by any signed-in user (a past partner's online status can be polled);
   - `loc:true` in the hello message is self-declared, so a modified client can receive an opted-in partner's ~5 km square;
   - a self-reported age/nudity violation bans the whole IP for 24 h (remedy: whitelist shared networks on the admin page);
   - peer `like` / `friend-done` notices are shown without a server check (the counts themselves are server-verified);
   - signing in to an existing Google account mid-chat changes the uid, so friend/report/like actions work from the next chat;
   - signalling documents left by closed tabs are removed by the daily-ish sweep, not instantly;
   - matching runs in browsers (queue is readable by signed-in users), the age estimate is advisory.
   - Live translate: a partner's `lang`, `orig` and `olang` are self-declared (a modified client can show any language label, or an "original" that is not what the translation says); they are validated and shown as text, and the original goes through the scam shield like the message;
   - profiles: on a shared device, a Google sign-in whose account has no profile yet copies the language, nickname, interests and gender already saved in that browser into the new profile; an existing profile wins over the browser's values (fields it lacks are filled from the browser).

## Moving to another account (checklist)
- **Code:** the repo is on GitHub (`maaknmusic/ohmygoal`). A new Claude Code account needs GitHub access to it (invite the new GitHub user as collaborator, or transfer the repo). Chat history does not move between accounts; this file, `README.md` and `tests/` are the handoff.
- **Firebase / Google Cloud project `ohmygoal-c8a4a`:** add the new Google account as Owner (Project settings → Users and permissions, and IAM). Deploy from Cloud Shell with that account.
- **Admin page:** the `ADMIN_EMAILS` secret lists who may open `admin.html`; update it (`firebase functions:secrets:set ADMIN_EMAILS` or re-run `deploy.sh`, which asks for it) and redeploy functions.
- **Razorpay and Cloudflare:** separate accounts; add the new login as a user or move the keys (they live in Secret Manager, not in git).
