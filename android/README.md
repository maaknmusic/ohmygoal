# Android app (Trusted Web Activity)

The Android app is this website, packaged: it opens full screen with no browser bar, uses the same camera, microphone and
notifications as Chrome, and updates whenever you deploy the site. There is no second code base.

You need (once): a Google Play developer account (one-time US$25), a Windows/Mac/Linux computer with Node 18+ and Java 17, and
about an hour. The steps below use Google's Bubblewrap; if you would rather not install anything, **pwabuilder.com** does the same
thing in the browser (enter `https://ohmygoal.app`, choose Android, and use the values in `twa-manifest.json`).

## 1. Build the app bundle
```
npm i -g @bubblewrap/cli
mkdir anonconnect-android && cd anonconnect-android
cp <repo>/android/twa-manifest.json .
bubblewrap init --manifest=https://ohmygoal.app/manifest.webmanifest   # accepts the answers from twa-manifest.json
bubblewrap build                                                           # makes app-release-bundle.aab and a test .apk
```
Bubblewrap creates a signing key (`android.keystore`) the first time. **Back it up and keep the password**: it is how you
update the app later. (If you use Play App Signing, the key you upload is only an upload key; see step 3.)

## 2. Create the app in Google Play Console
New app, "OhMyGoal", free. Content rating: this is an 18+ app (state that in the questionnaire). Data safety form: the
site's Privacy Policy (`legal.html#privacy`) is the source for the answers. Upload `app-release-bundle.aab` to an internal
testing track first.

## 3. Tell Android that the site and the app belong together (digital asset links)
Play Console, Setup, **App signing**: copy the **SHA-256 certificate fingerprint** of the *App signing key* (not the upload key).
Put it in `well-known/assetlinks.json` in this repository (replace `REPLACE_WITH_THE_SHA256_FINGERPRINT_FROM_PLAY_CONSOLE`; the
package name there must match `packageId`), then deploy hosting:
```
bash deploy.sh      # or: npx firebase-tools deploy --only hosting
```
Check it: open `https://ohmygoal.app/.well-known/assetlinks.json` (it is served from `well-known/` by a rewrite in
`firebase.json`, because Firebase Hosting ignores folders that start with a dot). Without this file the app opens with a
browser bar showing the address.

## 4. Friend notifications
Push works in the app exactly as in the browser (the user taps Menu, Friend notifications). It needs the Web Push key:
Firebase console, Project settings, Cloud Messaging, **Web Push certificates**, Generate key pair. Put the public key in
`config.js` as `push: { vapidKey: '...' }`, then `bash deploy.sh`. Until it is set the notification items stay hidden.

## 5. Release
Internal test, then closed test (Google requires 12 testers for 14 days for new personal developer accounts), then production.
Each new site deploy reaches the app immediately; you only rebuild the .aab to change the app name, icon or Android version.

## Things Google Play checks
- An 18+ social/chat app needs working **report** and **block** (both are one tap in every chat) and a moderation process (see `legal.html`).
- A link to the privacy policy in the store listing and inside the app (the menu has it).
- Permissions: camera, microphone, notifications (and approximate location only if the person turns on distance).
