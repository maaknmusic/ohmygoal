# Handoff notes (project state and what is left)

Anonymous Connect: random video / voice / text chat (WebRTC P2P, Firestore signalling, Firebase Hosting + Functions, Razorpay Premium).
Read `README.md` first (files, deploy, privacy design). Tests: `tests/README.md`.

## State
- `main` holds the v2 redesign (new UI, games, voice, themes, likes, approximate distance, relay-only IP hiding, tightened rules).
- Production needs `bash deploy.sh` (functions, then rules, then hosting) from Google Cloud Shell after every merge.
- All test suites passed on the last run: unit (~1,300), UI (v2, hardening, distance, failclosed), emulator (fixes, friends, bans 58, premium 22, privacy, likes 52).

## Still open
1. `config.js` → `business` (email, phone, address): empty. Razorpay's live-mode review and `legal.html` need them.
2. Razorpay: still in test mode until KYC / go-live is done; then `bash deploy.sh --reset-secrets` with the live keys.
3. Metered TURN credentials are static and public in `config.js` (the relay is used by Premium "Hide my IP address" and as the fallback for networks that block direct connections). Better: a Cloud Function that issues short-lived credentials (needs the Metered API key as a secret). Check Metered quota after real use; users can switch the relay off in the menu.
4. Accepted / deferred review findings:
   - presence is readable by any signed-in user (a past partner's online status can be polled);
   - `loc:true` in the hello message is self-declared, so a modified client can receive an opted-in partner's ~5 km square;
   - a self-reported age/nudity violation bans the whole IP for 24 h (remedy: whitelist shared networks on the admin page);
   - peer `like` / `friend-done` notices are shown without a server check (the counts themselves are server-verified);
   - signing in to an existing Google account mid-chat changes the uid, so friend/report/like actions work from the next chat;
   - signalling documents left by closed tabs are removed by the daily-ish sweep, not instantly;
   - matching runs in browsers (queue is readable by signed-in users), the age estimate is advisory.

## Moving to another account (checklist)
- **Code:** the repo is on GitHub (`maaknmusic/ohmygoal`). A new Claude Code account needs GitHub access to it (invite the new GitHub user as collaborator, or transfer the repo). Chat history does not move between accounts; this file, `README.md` and `tests/` are the handoff.
- **Firebase / Google Cloud project `ohmygoal-c8a4a`:** add the new Google account as Owner (Project settings → Users and permissions, and IAM). Deploy from Cloud Shell with that account.
- **Admin page:** the `ADMIN_EMAILS` secret lists who may open `admin.html`; update it (`firebase functions:secrets:set ADMIN_EMAILS` or re-run `deploy.sh`, which asks for it) and redeploy functions.
- **Razorpay and Metered:** separate accounts; add the new login as a user or move the keys (they live in Secret Manager, not in git).
