# Anonymous Connect

Random one-on-one **video or text** chat with strangers. Everything is in a single `index.html` file, with no build step.

## Features

- **Real matchmaking**: a Firestore queue with transactional claiming, so two people never grab the same partner. People who share interests are matched first.
- **Peer-to-peer video and chat**: video goes over WebRTC, and messages go over a WebRTC data channel. Messages are **never written to a database**.
- **Video controls**: mute, camera on/off, switch camera (front/back), fullscreen, and a connection-quality indicator (round-trip time).
- **Chat**: typing indicator, emoji picker, large emoji-only messages, timestamps, and optional Gemini translation of incoming messages.
- **Face age verification**: runs on the user's device and nothing is uploaded. Users center their face, turn their head left and right (a liveness check, so a still photo fails), then look straight ahead while the model estimates their age. Estimates of 25+ pass, estimates under 18 are denied and the device is locked out for 24 hours, and anything in between is "inconclusive" (3 tries). During video chats, the camera feed is re-checked every 15 seconds. All of this is set in `APP_CONFIG.ageCheck`; add `?agedebug` to the URL to see live readings.
- **Safety**: an 18+ confirmation with community rules, a report flow (stored for moderators), blocking (the blocked person is never matched with you again, in either direction), masking of profanity in incoming messages, a warning before you send personal info (phone, email, links, social handles), message rate limiting, and XSS-safe rendering.
- **Ease of use**: Next needs two presses (Esc works too), you're automatically re-matched when a partner leaves, dark/light theme, sound cues, and a layout that works on phones.

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
2. Paste your web config into `APP_CONFIG.firebase` at the top of `index.html`.
3. Deploy `firestore.rules`.
4. Add a **TURN server** to `APP_CONFIG.iceServers`. Without one, roughly 10–20% of users (strict NATs, mobile carriers) can't connect.
5. Optional: set `APP_CONFIG.geminiApiKey` to turn on translation. Put the key behind a proxy before going public.
6. Recommended: add a Firestore TTL policy on `queue.ts`, and on `rooms` / `signals`, to clean up abandoned docs.

## Important before launch
- **Face age estimation is an estimate, not proof.** In testing with stock photos, the model rated several adults as 19–24 and several teenagers as 20–24. That's why the pass age is 25 (the same idea as "Challenge 25" in shops). The cost is that many real 18–24-year-olds will get "inconclusive". Set `ageCheck.fallbackUrl` to an ID-document verification provider so they still have a way in.
- **The check runs in the browser**, so a technical user can bypass it, and clearing site data removes the lockout. For stronger guarantees, use a certified age-assurance provider that verifies on its own servers.
- Moderators need a way to review the `reports` collection.
