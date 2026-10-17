/*
 * App configuration. Edit this file to deploy.
 * - firebase: Firebase web config. When null, the app runs in LOCAL DEMO mode
 *   (matching only works between tabs of the same browser).
 * - iceServers: STUN/TURN servers. TURN lets users behind strict NATs / mobile data connect.
 * - geminiApiKey: optional, enables the "Translate" button on incoming messages.
 * - ageCheck: on-device face age estimation settings.
 */
window.APP_CONFIG = {
    firebase: {
        apiKey: 'AIzaSyDTgaX2GRn7n9Zo_b-TyU3bmWfOvJpXlps',
        authDomain: 'ohmygoal-c8a4a.firebaseapp.com',
        projectId: 'ohmygoal-c8a4a',
        storageBucket: 'ohmygoal-c8a4a.firebasestorage.app',
        messagingSenderId: '719459235525',
        appId: '1:719459235525:web:5886e6a4a5d5ee2ab122ac',
    },
    appId: 'anon-connect',
    iceServers: [
        { urls: ['stun:stun.l.google.com:19302', 'stun:stun.relay.metered.ca:80'] },
        // Metered TURN relay: used only when a direct connection is blocked (mobile data, strict NATs).
        {
            urls: [
                'turn:global.relay.metered.ca:80',
                'turn:global.relay.metered.ca:80?transport=tcp',
                'turn:global.relay.metered.ca:443',
                'turns:global.relay.metered.ca:443?transport=tcp',
            ],
            username: '2a803601019d1d0bb1078a86',
            credential: 'Hcp9CNhuUNyqjV2f',
        },
    ],
    geminiApiKey: '',
    geminiModel: 'gemini-2.5-flash',

    // Face-based age estimation (runs on-device; no image ever leaves the browser).
    // Video effects (background blur/replacement, face masks). Loaded only when a user opens the effects panel.
    effects: {
        libUrl: 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.0.1/vision_bundle.mjs',
        wasmUrl: 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.0.1/wasm',
        segmenterModel: 'https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_segmenter/float16/latest/selfie_segmenter.tflite',
        faceModel: 'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task',
    },

    // Premium = signed in with Google + a pass bought through Razorpay (verified by the Cloud Functions
    // in /functions). Prices shown here are for display; the real prices live in functions/index.js.
    premium: {
        enabled: true,
        functionsRegion: 'asia-south1',
        checkoutUrl: 'https://checkout.razorpay.com/v1/checkout.js',
        plans: [
            { id: 'week', label: '7 days', price: '₹49' },
            { id: 'month', label: '30 days', price: '₹149', note: 'Most popular' },
            { id: 'quarter', label: '90 days', price: '₹349', note: 'Best value' },
        ],
    },

    // On-device nudity detection for video chats.
    safety: {
        nudityModelUrl: 'models/nsfw/model.json',
        // The model gives false positives around 0.6-0.8 on dim, skin-heavy (but clothed) scenes;
        // real nudity typically scores above 0.9.
        blurThreshold: 0.85,   // porn+hentai probability that hides the partner's video
        selfThreshold: 0.92,   // ... that turns off your own camera (a strike)
        strikesForBan: 3,      // strikes within 24 h before video chat is locked for 24 h
    },

    ageCheck: {
        enabled: true,
        passAge: 25,        // estimated age needed to pass (margin for model error, like "Challenge 25")
        minAge: 18,         // estimates below this are denied and the device is locked out
        maxAttempts: 3,     // inconclusive attempts allowed before a lockout
        lockHours: 24,
        validDays: 30,      // how long a successful check is remembered on this device
        recheckDuringVideo: true, // periodically re-estimate age of the camera feed during video chats
        fallbackUrl: '',    // optional: link to an ID-document verification provider for inconclusive results
        libUrl: 'https://cdn.jsdelivr.net/npm/@vladmandic/face-api@1.7.15/dist/face-api.esm.js',
        modelUrl: 'https://cdn.jsdelivr.net/npm/@vladmandic/face-api@1.7.15/model/',
    },
};
