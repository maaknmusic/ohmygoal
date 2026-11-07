// English topic pages: one page per thing people search for, each with its own useful content (no copies of each other).
// Facts must match the app (README, legal.html). Edit, then run: node tools/seo/build.mjs

export const EN_UI = {
    start: 'Start chatting', note: 'Free · no sign-up · 18+', faq: 'Questions', ready: 'Ready to say hi?', more: 'More about OhMyGoal',
    languages: 'In your language', footer: 'OhMyGoal is random video, voice and text chat that puts safety first. 18+ only.',
    terms: 'Terms', privacy: 'Privacy', contact: 'Contact',
    help: 'In India, report online blackmail or fraud on <b>1930</b> or at <a href="https://cybercrime.gov.in" rel="noopener">cybercrime.gov.in</a>.',
};

const UPDATED = '2026-11-07';
const base = { lang: 'en', ogLocale: 'en_IN', ui: EN_UI, updated: UPDATED };

export const TOPICS = [
    {
        ...base, slug: 'random-video-chat', crumb: 'Random video chat',
        title: 'Random Video Chat with Strangers – Free, No Sign-up | OhMyGoal',
        description: 'Free random video chat with strangers. One tap to meet someone new, no account needed, age-checked on your device and never recorded.',
        h1: 'Random video chat with strangers',
        lede: 'Press one button and you are face to face with someone new. OhMyGoal is free, needs no account, checks age on your own device and never records a chat.',
        points: [
            ['One tap to start', 'No sign-up, no app to install. Open the page, confirm you are 18+, press Start.'],
            ['Not recorded', 'Video goes directly between the two browsers. Nothing is stored on our side.'],
            ['Nudity blurred', 'An on-device check blurs explicit video before you see it.'],
            ['Next in a second', 'Not a good match? Press Next and meet someone else.'],
        ],
        sections: [
            { h: 'How random video chat works here', steps: [
                'Choose <b>Video</b>, <b>Voice</b> or <b>Text</b>. Add a few interests (cricket, music, study…) if you like, so you meet people who like the same things.',
                'Your camera estimates your age on your device before your first chat. Camera frames are never uploaded.',
                'We match you with a random person who is looking at the same moment. The call connects peer-to-peer.',
                'Talk, play a quick game, send a reaction. Press Next whenever you want someone new, or Report and Block if someone breaks the rules.',
            ] },
            { h: 'What makes it different from other random chat sites', list: [
                '<b>Safety is built in, not sold.</b> Blurring, the scam shield, reporting and blocking are free for everyone.',
                '<b>A scam shield.</b> If someone shares a phone number, UPI ID or social handle, you get a warning, because that is how most scams start.',
                '<b>Games and icebreakers.</b> Tic-tac-toe and other quick games and conversation starters so you are never stuck at “hi”.',
                '<b>Interests and themed rooms</b> such as Cricket night, Study hour and a language exchange.',
                '<b>18 languages</b> for the whole interface, including Hindi, Tamil, Telugu, Bengali and Marathi.',
            ] },
            { h: 'Works on your phone', p: [
                'It runs in any modern browser on Android, iPhone and desktop. You can add it to your home screen like an app. If your data is slow, the video quality adjusts by itself, and text chat works on almost any connection.',
            ] },
        ],
        faq: [
            ['Is random video chat on OhMyGoal free?', 'Yes. Video, voice and text chat, interests, games and every safety tool are free, and you do not need an account. Premium is an optional pass for extras such as choosing who you meet by gender or country.'],
            ['Do I need to sign up?', 'No. You can start chatting straight away. A Google sign-in is only needed for friends and Premium.'],
            ['Are chats recorded?', 'No. Video and messages go directly between you and the other person and are not stored by us. The other person’s device could still record their screen, so never share anything you would regret.'],
            ['Who can use it?', 'Adults only. Everyone must be 18 or older, and the age check runs on your device before your first chat.'],
        ],
    },
    {
        ...base, slug: 'omegle-alternative', crumb: 'Omegle alternative',
        title: 'Omegle Alternative 2026 – Safe Random Video Chat | OhMyGoal',
        description: 'Omegle closed in November 2023. OhMyGoal is a free, safer Omegle alternative: random video and text chat, age-checked, nudity blurred, never recorded.',
        h1: 'A safer Omegle alternative',
        lede: 'Omegle shut down on 8 November 2023 after 14 years. If you miss meeting random people, OhMyGoal gives you the same one-tap random chat, with the safety tools Omegle never had.',
        points: [
            ['Same idea', 'Random person, one tap, no account. Video, voice or text.'],
            ['18+ only, checked', 'An on-device age check before your first chat.'],
            ['Nudity blurred', 'Explicit video is blurred on your device before you see it.'],
            ['Real reporting', 'Report and Block in every chat, reviewed by moderators.'],
        ],
        sections: [
            { h: 'Why Omegle closed', p: [
                'Omegle’s founder said that running the site had become impossible because of misuse, including adults targeting minors, and the cost of fighting it. It had very little moderation and no age check. That is exactly what we designed OhMyGoal to avoid.',
            ] },
            { h: 'OhMyGoal compared with Omegle', list: [
                '<b>Age:</b> Omegle asked you to tick a box. OhMyGoal estimates age on your device before your first chat and can re-check during video calls.',
                '<b>Nudity:</b> Omegle showed whatever the camera sent. OhMyGoal blurs explicit video on your device and lets you report it in one tap.',
                '<b>Scams:</b> a scam shield warns you when someone shares a phone number, UPI ID or social handle.',
                '<b>Bans that stick:</b> rule-breakers are banned by device, network and account, and the ban screen says why. Appeals are free.',
                '<b>Privacy:</b> video is peer-to-peer and never recorded. Messages are not stored.',
                '<b>More to do:</b> interests, themed rooms, quick games, reactions, group rooms and friends.',
            ] },
            { h: 'Other things people look for after Omegle', p: [
                'Text-only chat (choose <a href="/text-chat/">Text</a>), voice without a camera (<a href="/voice-chat/">Voice</a>), meeting people from India in your own language (<a href="/video-chat-india/">video chat India</a>), and group rooms with up to 8 people.',
            ] },
        ],
        faq: [
            ['Is Omegle coming back?', 'Omegle closed for good in November 2023 and its website now only shows the founder’s farewell message. Sites using the Omegle name today are not the original Omegle.'],
            ['Is OhMyGoal free like Omegle?', 'Yes. Random video, voice and text chat are free, with no account needed. An optional Premium pass adds extras such as gender and country filters.'],
            ['Is OhMyGoal safer than Omegle was?', 'It is built to be: adults only with an on-device age check, nudity blurring, a scam shield, one-tap reporting and blocking, and bans that apply to the device and network, not just one account.'],
            ['Does it work on phones?', 'Yes, in any modern browser on Android and iPhone. No app download is needed.'],
        ],
    },
    {
        ...base, slug: 'talk-to-strangers', crumb: 'Talk to strangers',
        title: 'Talk to Strangers Online – Video, Voice & Text | OhMyGoal',
        description: 'Talk to strangers online for free: random video, voice or text chat with people who share your interests. No sign-up, adults only, safety built in.',
        h1: 'Talk to strangers online',
        lede: 'Sometimes you just want to talk to someone new: about cricket, an exam, music, or nothing at all. Pick video, voice or text and you are talking in seconds.',
        points: [
            ['Video, voice or text', 'Show your face, only your voice, or just type. Your choice, every chat.'],
            ['Shared interests', 'Add interests and we try to match you with people who share them.'],
            ['Never stuck at “hi”', 'Icebreaker questions and quick games start the conversation for you.'],
            ['Leave any time', 'One tap to move on. Report and Block are always there.'],
        ],
        sections: [
            { h: 'Good ways to start a conversation with a stranger', list: [
                'Start with something you can see or share: “What are you listening to?” or “Which city are you in?” (no need to say more than a city).',
                'Use the icebreaker cards and games: a round of tic-tac-toe breaks the ice faster than small talk.',
                'Pick a themed room such as Study hour or Cricket night, so you already have something in common.',
                'If the conversation is not working, it is fine to press Next. The other person will meet someone new too.',
            ] },
            { h: 'Stay safe while you talk', list: [
                'Do not share your phone number, address, UPI ID or social media in the first chats. The scam shield warns you when someone asks.',
                'Never undress or do anything intimate on camera. A stranger can record their screen.',
                'If someone threatens to share a recording, do not pay. Block, report and read our <a href="/safe-video-chat/">safety guide</a>.',
            ] },
            { h: 'Make friends, if you both want', p: [
                'If a chat goes well, you can both choose to add each other as friends (with a Google sign-in) and call again later. Nobody can add you without your OK, and you can remove a friend at any time.',
            ] },
        ],
        faq: [
            ['Is it free to talk to strangers here?', 'Yes. Chatting is free and you do not need an account.'],
            ['Can I talk without showing my face?', 'Yes. Choose Voice for audio only, or Text for typing only. In video chats you can also use a background blur or a face mask effect.'],
            ['Can I choose who I talk to?', 'You can add interests and join themed rooms for free. Choosing by gender or country is part of the optional Premium pass.'],
            ['What if someone is rude?', 'Press Next to leave, or Report and Block. Reports are reviewed by moderators, and blocked people are never matched with you again.'],
        ],
    },
    {
        ...base, slug: 'video-chat-india', crumb: 'Video chat India',
        title: 'Random Video Chat India – Meet People in Your Language | OhMyGoal',
        description: 'Random video chat made in India: meet new people in Hindi, Tamil, Telugu, Bengali, Marathi and more. Free, safe, adults only, works on any phone.',
        h1: 'Random video chat in India',
        lede: 'OhMyGoal is built in India for people in India: in your language, light enough for mobile data, with safety tools made for the scams people here actually face.',
        points: [
            ['Your language', 'The whole app in Hindi, Bengali, Tamil, Telugu, Marathi, Gujarati, Kannada, Malayalam, Punjabi and English.'],
            ['Light on data', 'Video adapts to your connection; text chat works almost anywhere.'],
            ['UPI-safe', 'A warning when someone shares a UPI ID or phone number.'],
            ['Pay by UPI', 'Optional Premium from ₹49, one-time, no auto-renew.'],
        ],
        sections: [
            { h: 'Meet people from across India', p: [
                'Add interests like cricket, Bollywood, music or exams, or join themed rooms such as Cricket night and Study hour. The language exchange room matches you with someone who speaks the language you want to practise.',
                'With the optional Premium pass you can choose to meet people from a particular country, and use Live translate to chat with someone who speaks another language.',
            ] },
            { h: 'Made for Indian phones and networks', list: [
                'Runs in Chrome on any Android phone, no download needed. You can add it to your home screen.',
                'Video quality goes up and down with your network, so a call keeps going on 4G.',
                'Switch to Voice or Text when data is low.',
            ] },
            { h: 'Safety that fits the risks here', list: [
                'The scam shield warns about phone numbers, UPI IDs and social handles shared in chat.',
                'Nudity is blurred on your device, and you can report in one tap.',
                'If someone blackmails you with a recording, do not pay. Call the national cyber crime helpline <b>1930</b> or report at cybercrime.gov.in. Our <a href="/safe-video-chat/">safety guide</a> explains what to do step by step.',
            ] },
            { h: 'Choose your language', p: [
                '<a href="/hi/">हिन्दी</a> · <a href="/bn/">বাংলা</a> · <a href="/ta/">தமிழ்</a> · <a href="/te/">తెలుగు</a> · <a href="/mr/">मराठी</a> · <a href="/gu/">ગુજરાતી</a> · <a href="/kn/">ಕನ್ನಡ</a> · <a href="/ml/">മലയാളം</a> · <a href="/pa/">ਪੰਜਾਬੀ</a>',
            ] },
        ],
        faq: [
            ['Is OhMyGoal an Indian website?', 'Yes. OhMyGoal is run from India, prices are in rupees and payments are by UPI.'],
            ['Can I chat in Hindi or my regional language?', 'Yes. Switch the language from the top of the page. The interface is available in 9 Indian languages and English, and you can add your language as an interest to meet people who speak it.'],
            ['How much does Premium cost?', '₹49 for 7 days, ₹149 for 30 days or ₹349 for 90 days, paid once by UPI. It does not renew by itself. Chatting itself is free.'],
            ['Where do I report online blackmail in India?', 'Call 1930 (National Cyber Crime Helpline) or file a complaint at cybercrime.gov.in. Also report the person inside the chat.'],
        ],
    },
    {
        ...base, slug: 'safe-video-chat', crumb: 'Safety guide',
        title: 'Safe Video Chat Guide: Avoid Scams & Blackmail | OhMyGoal',
        description: 'How to stay safe on random video chat: spot sextortion and UPI scams, what to do if someone blackmails you, and how to report it in India (1930).',
        h1: 'How to stay safe on video chat',
        lede: 'Most video chats are fun and harmless. A few people use them to scam or blackmail. This guide explains how those scams start, how to avoid them, and exactly what to do if it happens to you.',
        points: [
            ['Never undress on camera', 'Anyone can record their screen.'],
            ['Never pay a blackmailer', 'Paying leads to more demands, not deletion.'],
            ['Keep your details private', 'No phone number, UPI ID, address or socials early on.'],
            ['Report: 1930', 'India’s National Cyber Crime Helpline.'],
        ],
        sections: [
            { h: 'How video call blackmail (sextortion) usually starts', steps: [
                'Someone friendly and attractive starts chatting, often very quickly flattering you.',
                'They ask you to move to another app (WhatsApp, Instagram, Telegram) or to show more on camera.',
                'They record the call. Sometimes the “person” is a pre-recorded video.',
                'They threaten to send the recording to your family, friends or employer unless you pay, usually by UPI.',
            ] },
            { h: 'If someone is blackmailing you', steps: [
                '<b>Do not pay.</b> Paying almost never makes them delete anything. It tells them you will pay again.',
                '<b>Stop replying.</b> Do not negotiate or argue.',
                '<b>Keep evidence:</b> screenshots of messages, usernames, the UPI ID or number they gave.',
                '<b>Report:</b> call <b>1930</b> or file at <a href="https://cybercrime.gov.in" rel="noopener">cybercrime.gov.in</a>. Report and block the account on every app they used.',
                '<b>Tell someone you trust.</b> You are the victim of a crime, not the one at fault.',
                'If you are under 18 or the images involve someone under 18, <a href="https://takeitdown.ncmec.org" rel="noopener">Take It Down</a> can help get images removed.',
            ] },
            { h: 'Other scams to watch for', list: [
                '<b>UPI and “investment” scams:</b> a new “friend” suggests a trading app or asks you to send money to unlock a payment. Never send money to someone you met in a chat.',
                '<b>Fake police or officials:</b> real police do not call to demand money over a video call.',
                '<b>Links:</b> do not open links from strangers or install apps they suggest.',
            ] },
            { h: 'How OhMyGoal helps', list: [
                'A safety reminder before your first voice or video chat.',
                'Nudity blurred on your device, and automatic reports when it keeps happening.',
                'A scam shield that warns when phone numbers, UPI IDs or social handles appear in chat.',
                'Report and Block in every chat; bans that apply to device, network and account.',
                'We never record chats, so nothing you say is stored on our side.',
            ] },
        ],
        faq: [
            ['What is sextortion?', 'Sextortion is blackmail using intimate images or video, often recorded during a video call. The criminal threatens to share it unless you pay or send more.'],
            ['Should I pay if someone threatens to share my video?', 'No. Do not pay and stop replying. Keep evidence and report it: in India call 1930 or use cybercrime.gov.in.'],
            ['Can OhMyGoal see or record my calls?', 'No. Video and messages go directly between the two people and are not stored by us. That is also why you should be careful: the other person can still record their own screen.'],
            ['Where do I report in India?', 'Call 1930, the National Cyber Crime Helpline, or report online at cybercrime.gov.in. In an emergency call 112.'],
        ],
    },
    {
        ...base, slug: 'text-chat', crumb: 'Text chat',
        title: 'Random Text Chat with Strangers – No Camera Needed | OhMyGoal',
        description: 'Anonymous random text chat with strangers. No camera, no sign-up: type, play games and send stickers. Messages are never stored. Adults only.',
        h1: 'Random text chat with strangers',
        lede: 'No camera, no pressure. Just type. Text chat is the easiest way to meet someone new, and it works even on slow mobile data.',
        points: [
            ['Messages not stored', 'Chats go directly between the two of you and disappear when you leave.'],
            ['Stickers and games', 'Send stickers, reactions and play quick games inside the chat.'],
            ['Light on data', 'Works on almost any connection.'],
            ['Typing in your language', 'The app works in 18 languages.'],
        ],
        sections: [
            { h: 'How it works', steps: [
                'Choose <b>Text</b> on the start screen and confirm you are 18+.',
                'Add interests if you like. We look for someone who shares them.',
                'Chat, send stickers, start a game. Press Next for someone new.',
            ] },
            { h: 'Why people prefer text', list: [
                'You stay anonymous: no face, no voice.',
                'You can think before you answer, which is easier in a second language.',
                'With the Premium pass, Live translate lets you chat with someone who writes in another language.',
            ] },
            { h: 'Keep it friendly and safe', p: [
                'The scam shield warns you before you send, or when someone sends, a phone number, UPI ID or social handle. Report and Block are always one tap away.',
            ] },
        ],
        faq: [
            ['Is text chat anonymous?', 'You choose a nickname; your name, number and email are never shown. Messages are not stored by us.'],
            ['Do I need a camera for text chat?', 'No. Text chat needs no camera or microphone. Like every chat on OhMyGoal it is for adults only.'],
            ['Can I switch to video later?', 'Yes. Go back to the start screen and choose Video or Voice for your next chat.'],
        ],
    },
    {
        ...base, slug: 'voice-chat', crumb: 'Voice chat',
        title: 'Random Voice Chat with Strangers – Audio Only | OhMyGoal',
        description: 'Talk to strangers by voice only: random audio chat with no camera, no sign-up and no recording. Group voice rooms for up to 8 people too.',
        h1: 'Random voice chat',
        lede: 'Hear a new voice without showing your face. Voice chat connects you with a random person for an audio-only conversation, and group voice rooms hold up to 8 people.',
        points: [
            ['Audio only', 'Your camera stays off. Only your voice is sent.'],
            ['Not recorded', 'Calls go peer-to-peer and are never stored by us.'],
            ['Group rooms', 'Voice rooms for up to 8 people, by topic.'],
            ['Good on 4G', 'Voice needs far less data than video.'],
        ],
        sections: [
            { h: 'One-to-one voice chat', p: [
                'Choose <b>Voice</b> on the start screen. You will be matched with someone who is also looking for a voice chat. You can mute yourself, send reactions and play games during the call.',
            ] },
            { h: 'Group voice rooms', p: [
                'Prefer a crowd? Join a voice room on a topic you like. Rooms hold up to 8 people, and you can leave any time. Group rooms are in beta, so tell us what you would like next.',
            ] },
            { h: 'Practise a language by voice', p: [
                'The language exchange room matches you with someone who speaks the language you are learning and wants to learn yours. Speaking is the fastest way to improve.',
            ] },
        ],
        faq: [
            ['Is voice chat free?', 'Yes, one-to-one voice chat and group voice rooms are free.'],
            ['Can the other person see me?', 'No. In voice chat only audio is sent; your camera is not used.'],
            ['Can I report someone in a voice chat?', 'Yes. Report and Block are available in every chat and every room.'],
        ],
    },
];

// ---------------------------------------------------------------------------------------------------------------------------------
// Comparisons. Only facts the other services state themselves (their app-store listings and websites) or that Wikipedia and well-known
// security companies report, checked in November 2026, with the sources listed on each page. "—" means we found nothing either way.
// ---------------------------------------------------------------------------------------------------------------------------------
const CHECKED = 'Checked in November 2026. Apps change; check their own pages before you decide.';
const SOURCES = {
    ometv: '<a href="https://en.wikipedia.org/wiki/OmeTV" rel="noopener">OmeTV on Wikipedia</a>, <a href="https://play.google.com/store/apps/details?id=omegle.tv" rel="noopener">OmeTV on Google Play</a>, <a href="https://ome.tv/" rel="noopener">ome.tv</a>',
    monkey: '<a href="https://www.monkey.app/" rel="noopener">monkey.app</a>, <a href="https://www.avast.com/c-monkey-app" rel="noopener">Avast on the Monkey app</a>, <a href="https://www.bitdefender.com/en-us/blog/hotforsecurity/parents-need-know-monkey" rel="noopener">Bitdefender on the Monkey app</a>',
    chatroulette: '<a href="https://en.wikipedia.org/wiki/Chatroulette" rel="noopener">Chatroulette on Wikipedia</a>',
    azar: '<a href="https://play.google.com/store/apps/details?id=com.azarlive.android" rel="noopener">Azar on Google Play</a>, <a href="https://www.kedglobal.com/mergers-acquisitions/newsView/ked202102100013" rel="noopener">Match Group buys Hyperconnect (KED Global)</a>',
};
const TABLE = [
    ['', 'OhMyGoal', 'OmeTV', 'Monkey', 'Chatroulette', 'Azar'],
    ['Where it runs', 'Any browser (Android, iPhone, computer), no download', 'Website and Android/iPhone app', 'Website and app', 'Website', 'Android/iPhone app'],
    ['Age check', 'Age estimated on your device before the first chat, can re-check in video', 'A checkbox (per Wikipedia)', '18+ rule; security firms report no real age verification', '—', '—'],
    ['Nudity protection', 'Blurred on your device before you see it', 'Automatic monitoring and moderators (per its Play listing)', '—', 'Moderators and recognition software (per Wikipedia)', '“In-Match Blur” (per its Play listing)'],
    ['Choose gender or country', 'Premium pass, from ₹49 (one-time UPI)', 'Pick a country; you set your own gender', '—', '—', 'Subscription'],
    ['Translation', 'Live translate (Premium)', 'Built-in translation', '—', '—', 'Voice-to-subtitle translation'],
    ['Indian languages in the app', 'Hindi, Bengali, Tamil, Telugu, Marathi, Gujarati, Kannada, Malayalam, Punjabi', '—', '—', '—', '—'],
    ['Voice-only and text-only chat', 'Both', 'Text if the camera fails (per its Play listing)', '—', '—', 'Voice'],
];
TOPICS.push(
    {
        ...base, slug: 'sites-like-omegle', crumb: 'Sites like Omegle',
        title: 'Sites Like Omegle (2026): 5 Random Video Chats Compared | OhMyGoal',
        description: 'Sites like Omegle compared: OhMyGoal, OmeTV, Monkey, Chatroulette and Azar. Age checks, nudity protection, filters, prices and what to watch out for.',
        h1: 'Sites like Omegle, compared',
        lede: 'Since Omegle closed in November 2023, many sites offer random video chat. They differ most in the things that matter for your safety: who checks age, what happens with nudity, and what you have to pay for.',
        points: [
            ['Check the age check', 'A checkbox is not an age check. Look for real verification.'],
            ['Check nudity protection', 'Blurring before you see it beats reporting after.'],
            ['Check what is paid', 'Filters by gender or country usually cost money.'],
            ['Check the reporting', 'You should be able to report someone in one tap.'],
        ],
        sections: [
            { h: 'The comparison', table: TABLE, after: [CHECKED] },
            { h: 'The sites, one by one', list: [
                '<b>OhMyGoal</b> (this site): runs in the browser, free, with an on-device age estimate, nudity blur, a scam shield for phone numbers and UPI IDs, and the app in 9 Indian languages. Premium (₹49 for 7 days) adds gender and country filters and Live translate.',
                '<b>OmeTV</b>: owned by Bad Kitty’s Dad, LDA in Portugal; website and apps with country selection and translation. Wikipedia notes the age check is a checkbox. <a href="/ometv-alternative/">OmeTV alternative</a>',
                '<b>Monkey</b>: an app and website for quick video chats with an 18+ rule; Avast and Bitdefender report there is no real age verification. <a href="/monkey-alternative/">Monkey alternative</a>',
                '<b>Chatroulette</b>: the original random video chat, launched on 16 November 2009 by Andrey Ternovskiy, then 17, in Moscow. <a href="/chatroulette-alternative/">Chatroulette alternative</a>',
                '<b>Azar</b>: an app by Hyperconnect, which Match Group bought in 2021; offers voice-to-subtitle translation and an “In-Match Blur”, with gender and region filters behind a subscription. <a href="/azar-alternative/">Azar alternative</a>',
            ] },
            { h: 'How to choose', steps: [
                'Prefer a service that checks age for real and blurs nudity before you see it.',
                'Look for one-tap Report and Block, and bans that stop the same person coming back.',
                'Be wary of anything that asks for money to “unlock” someone, or pushes you to move to WhatsApp or Telegram.',
                'Read our <a href="/safe-video-chat/">safety guide</a>: the scams are the same on every site.',
            ] },
            { h: 'Sources', cls: 'sources', p: [`${SOURCES.ometv}; ${SOURCES.monkey}; ${SOURCES.chatroulette}; ${SOURCES.azar}. ${CHECKED}`] },
        ],
        faq: [
            ['What is the best site like Omegle?', 'It depends on what you want. For safety, choose one with a real age check and nudity blurring. OhMyGoal does both, free, in the browser, and in 9 Indian languages.'],
            ['Is there an Omegle with a gender filter?', 'Several services offer gender filters, usually paid. On OhMyGoal it is part of Premium, from ₹49 for 7 days, paid once by UPI with no auto-renewal.'],
            ['Are sites like Omegle safe?', 'They can be, if you never share personal details or undress on camera, and if the site has real age checks, nudity blurring and reporting.'],
        ],
    },
    {
        ...base, slug: 'ometv-alternative', crumb: 'OmeTV alternative',
        title: 'OmeTV Alternative – Random Video Chat with Real Age Checks | OhMyGoal',
        description: 'Looking for an OmeTV alternative? OhMyGoal is free random video chat in your browser with an on-device age estimate, nudity blur and Indian languages.',
        h1: 'An OmeTV alternative',
        lede: 'OmeTV is one of the biggest random video chats, on the web and in apps. If you want the same quick video chat with stronger age checks, nudity blurring and the whole app in your language, try OhMyGoal.',
        points: [
            ['No download', 'Works in any browser; add it to your home screen if you like.'],
            ['Age estimated on your device', 'Not just a checkbox.'],
            ['Nudity blurred first', 'Explicit video is blurred before you see it.'],
            ['Your language', '9 Indian languages and 8 world languages.'],
        ],
        sections: [
            { h: 'OmeTV and OhMyGoal side by side', table: TABLE.map(r => [r[0], r[1], r[2]]), after: [CHECKED] },
            { h: 'What OmeTV does well', p: ['OmeTV has a very large number of people online, a country selector and built-in translation, and it runs on the web and in apps. Those are real strengths.'] },
            { h: 'Why people look for an alternative', list: [
                'Age: Wikipedia notes OmeTV checks age with a checkbox. OhMyGoal estimates age on your device before your first chat.',
                'Language: OhMyGoal’s whole interface is available in Hindi, Tamil, Telugu, Bengali, Marathi, Gujarati, Kannada, Malayalam and Punjabi.',
                'Scams: OhMyGoal warns you when someone shares a phone number, UPI ID or social handle.',
            ] },
            { h: 'Sources', cls: 'sources', p: [`${SOURCES.ometv}. ${CHECKED}`] },
        ],
        faq: [
            ['Is OhMyGoal free like OmeTV?', 'Yes. Random video, voice and text chat are free with no account. Premium is optional.'],
            ['Can I choose the country on OhMyGoal?', 'Yes, with the Premium pass (from ₹49 for 7 days). You can also add interests for free.'],
            ['Do I need to install an app?', 'No. OhMyGoal runs in the browser on Android, iPhone and computers.'],
        ],
    },
    {
        ...base, slug: 'monkey-alternative', crumb: 'Monkey alternative',
        title: 'Monkey App Alternative – Safer Random Video Chat, 18+ | OhMyGoal',
        description: 'A Monkey app alternative for adults: free random video chat with an on-device age estimate, nudity blur, a scam shield and one-tap reporting. No download.',
        h1: 'A Monkey app alternative for adults',
        lede: 'Monkey made quick, one-tap video chats popular. It says it is for adults only, but security companies report it has no real age verification. OhMyGoal keeps the quick matching and adds the checks.',
        points: [
            ['Adults only, checked', 'Age is estimated on your device before your first chat.'],
            ['Quick matching', 'One tap to start, one tap for the next person.'],
            ['Safety built in', 'Nudity blur, scam shield, Report and Block.'],
            ['No app needed', 'Runs in your browser.'],
        ],
        sections: [
            { h: 'Monkey and OhMyGoal side by side', table: TABLE.map(r => [r[0], r[1], r[3]]), after: [CHECKED] },
            { h: 'What carries over', p: ['Fast matching with new people, interests, games to break the ice, and the option to add someone as a friend when you both want to.'] },
            { h: 'What is different', list: [
                'An on-device age estimate before your first chat, instead of only a rule.',
                'Nudity is blurred on your device, and you can report in one tap.',
                'Bans apply to the device, network and account, so a banned person cannot simply make a new account.',
            ] },
            { h: 'Sources', cls: 'sources', p: [`${SOURCES.monkey}. ${CHECKED}`] },
        ],
        faq: [
            ['Is OhMyGoal for teenagers?', 'No. OhMyGoal is for adults (18+) only, and age is checked on your device before your first chat.'],
            ['Is it free?', 'Yes, chatting is free with no account. An optional Premium pass adds extras.'],
            ['Can I add people as friends?', 'Yes, if you both choose to, with a Google sign-in.'],
        ],
    },
    {
        ...base, slug: 'chatroulette-alternative', crumb: 'Chatroulette alternative',
        title: 'Chatroulette Alternative – Free Random Video Chat in India | OhMyGoal',
        description: 'A Chatroulette alternative: free random video, voice and text chat in your browser, with an on-device age estimate, nudity blur and Indian languages.',
        h1: 'A Chatroulette alternative',
        lede: 'Chatroulette started random video chat in November 2009. OhMyGoal is a modern take on the same idea: one tap to meet someone new, with safety tools built in and an interface in your language.',
        points: [
            ['Video, voice or text', 'Choose how you want to talk, every chat.'],
            ['Age-checked', 'An on-device age estimate before your first chat.'],
            ['Nudity blurred', 'Before you see it, on your device.'],
            ['Games and icebreakers', 'Never stuck at “hi”.'],
        ],
        sections: [
            { h: 'Chatroulette and OhMyGoal side by side', table: TABLE.map(r => [r[0], r[1], r[4]]), after: [CHECKED] },
            { h: 'A short history', p: ['Andrey Ternovskiy, then a 17-year-old student in Moscow, launched Chatroulette on 16 November 2009. It grew to millions of users within months and is still running. Its early years also showed why moderation matters, and it brought in moderators and recognition software.'] },
            { h: 'What OhMyGoal adds', list: [
                'Voice-only and text-only chats, not just video.',
                'Interests and themed rooms (cricket, study, music, language exchange).',
                'A scam shield for phone numbers, UPI IDs and social handles.',
            ] },
            { h: 'Sources', cls: 'sources', p: [`${SOURCES.chatroulette}. ${CHECKED}`] },
        ],
        faq: [
            ['Is OhMyGoal like Chatroulette?', 'The idea is the same: random people, one tap. OhMyGoal adds voice and text modes, interests, games and on-device safety checks.'],
            ['Does it work in India?', 'Yes. It is run from India, payments are by UPI, and the app is available in 9 Indian languages.'],
            ['Is it free?', 'Yes, with no account needed.'],
        ],
    },
    {
        ...base, slug: 'azar-alternative', crumb: 'Azar alternative',
        title: 'Azar Alternative – Gender Filter from ₹49, No Subscription | OhMyGoal',
        description: 'An Azar alternative: free random video chat in your browser; gender and country filters with a one-time UPI pass from ₹49, no auto-renewing subscription.',
        h1: 'An Azar alternative',
        lede: 'Azar is a polished video chat app with translation and filters. Its gender and region filters come with a subscription. On OhMyGoal the same kind of filters come with a one-time pass from ₹49 that never renews by itself.',
        points: [
            ['No subscription', 'Premium is paid once by UPI: 7, 30 or 90 days.'],
            ['No download', 'Works in any browser.'],
            ['Live translate', 'Chat with someone in another language (Premium).'],
            ['Free to chat', 'Video, voice and text chat cost nothing.'],
        ],
        sections: [
            { h: 'Azar and OhMyGoal side by side', table: TABLE.map(r => [r[0], r[1], r[5]]), after: [CHECKED] },
            { h: 'What Azar does well', p: ['Azar, made by Hyperconnect (bought by Match Group in 2021), offers voice-to-subtitle translation, an “In-Match Blur” for inappropriate content and a large global audience.'] },
            { h: 'Why choose OhMyGoal', list: [
                'Prices in rupees with UPI, and nothing that renews by itself: ₹49 for 7 days, ₹149 for 30 days, ₹349 for 90 days.',
                'No app to install; it runs in your browser.',
                'The interface in 9 Indian languages, and a scam shield for phone numbers and UPI IDs.',
            ] },
            { h: 'Sources', cls: 'sources', p: [`${SOURCES.azar}. ${CHECKED}`] },
        ],
        faq: [
            ['Does OhMyGoal have a gender filter?', 'Yes, as part of Premium, from ₹49 for 7 days, paid once by UPI.'],
            ['Does Premium renew automatically?', 'No. It is a one-time payment for 7, 30 or 90 days. There is nothing to cancel.'],
            ['Is there translation?', 'Yes. Live translate is part of Premium and lets you chat with someone who speaks another language.'],
        ],
    },
    {
        ...base, slug: 'video-chat-no-login', crumb: 'Video chat without login',
        title: 'Video Chat Without Login or Registration – Free | OhMyGoal',
        description: 'Random video chat with no login, no registration and no app download. Open the page, confirm you are 18+, and meet someone new in seconds. Free.',
        h1: 'Video chat without login or registration',
        lede: 'No account, no email, no phone number, no app. Open OhMyGoal in your browser, confirm you are 18 or older, and you are talking to someone new in seconds.',
        points: [
            ['No account', 'Nothing to sign up for, nothing to remember.'],
            ['No phone number', 'We never ask for it.'],
            ['No app download', 'Runs in Chrome, Safari or any modern browser.'],
            ['Still safe', 'Age estimate, nudity blur and reporting work without an account.'],
        ],
        sections: [
            { h: 'How it works without an account', steps: [
                'Open <a href="/">ohmygoal.app</a>. A random nickname and avatar are made for you (change them if you like).',
                'Confirm you are 18+ and allow the camera. Your age is estimated on your device; no image is uploaded.',
                'Press Start. When you want someone new, press Next.',
            ] },
            { h: 'When a sign-in helps (optional)', list: [
                'Friends: keep in touch with people you liked talking to, if they agree.',
                'Premium: gender and country filters, Live translate and more.',
                'Your settings on every device. Sign-in is with Google only and is never needed just to chat.',
            ] },
        ],
        faq: [
            ['Do I need an account to video chat?', 'No. You can chat by video, voice or text without any account.'],
            ['Is my phone number needed?', 'No. OhMyGoal never asks for a phone number.'],
            ['Why do you check my age without an account?', 'Because the site is for adults only. The estimate runs on your device and no image leaves it.'],
        ],
    },
    {
        ...base, slug: 'anonymous-video-call', crumb: 'Anonymous video call',
        title: 'Anonymous Video Call with Strangers – Stay Private | OhMyGoal',
        description: 'Make anonymous video calls with strangers: a random nickname, no account, background blur and masks, voice-only mode, and nothing recorded. 18+ only.',
        h1: 'Anonymous video calls with strangers',
        lede: 'Talk face to face without giving away who you are. On OhMyGoal you get a random nickname, your name and number are never shown, and you decide how much of yourself the other person sees.',
        points: [
            ['Random nickname', 'Made for you; your real name is never shown.'],
            ['Blur or mask', 'Background blur and a face mask are free.'],
            ['Voice only', 'Or skip the camera completely.'],
            ['Not recorded', 'We never store calls or messages.'],
        ],
        sections: [
            { h: 'Ways to stay anonymous', list: [
                'Keep the random nickname, or pick your own that does not include your real name.',
                'Use the free background blur so your room cannot be recognised, or a mask effect.',
                'Choose Voice or Text instead of Video.',
                'With Premium, “Hide my IP address” sends the call through a relay so the other person never sees your IP address.',
            ] },
            { h: 'What anonymity does not protect', p: [
                'The other person can still record their own screen. So never show your face if you want to stay unknown, never share your phone number, social media or UPI ID, and never undress on camera. Our <a href="/safe-video-chat/">safety guide</a> explains why.',
            ] },
        ],
        faq: [
            ['Can strangers see my name or number?', 'No. They only see the nickname and avatar you choose.'],
            ['Can the other person see my IP address?', 'A direct video call can reveal an IP address to the other side, as on any video call. With Premium, “Hide my IP address” routes the call through a relay so they cannot.'],
            ['Are anonymous calls recorded?', 'Not by us. Calls go directly between you and the other person and are never stored.'],
        ],
    },
    {
        ...base, slug: 'make-friends-online', crumb: 'Make friends online',
        title: 'How to Make Friends Online in India – Safely | OhMyGoal',
        description: 'How to make friends online in India: meet people who share your interests by video, voice or text, add friends when you both want to, and stay safe.',
        h1: 'Make friends online, safely',
        lede: 'New city, new college, or just want new people to talk to? Random chat is a quick way to meet people who like the same things. Here is how to turn a good chat into a friendship, safely.',
        points: [
            ['Start with interests', 'Cricket, music, exams, gaming: meet people who share them.'],
            ['Themed rooms', 'Study hour, Cricket night, Music jam, Game night and more, at set times.'],
            ['Add as a friend', 'Only if you both agree; call again later.'],
            ['Your pace', 'Video, voice or text, whatever feels right.'],
        ],
        sections: [
            { h: 'Five steps from stranger to friend', steps: [
                'Add two or three interests so you are matched with people who share them.',
                'Use an icebreaker or a quick game to get past “hi”.',
                'Talk for a while before sharing anything personal. A city is enough; no address, school or workplace.',
                'If you both enjoyed it, add each other as friends (with a Google sign-in). Nobody can add you without your OK.',
                'Keep chatting on OhMyGoal for a while before moving to other apps.',
            ] },
            { h: 'Red flags', list: [
                'Asking for money, a UPI payment or “help” early on.',
                'Pushing you to move to WhatsApp, Telegram or Instagram straight away.',
                'Asking you to undress or show more on camera. Leave, block and report.',
            ] },
        ],
        faq: [
            ['Can I make friends on OhMyGoal?', 'Yes. If you both choose to, you can add each other as friends and call again later.'],
            ['Do I need an account?', 'Not to chat. Friends need a Google sign-in so you can find each other again.'],
            ['Can I remove a friend?', 'Yes, at any time.'],
        ],
    },
    {
        ...base, slug: 'video-chat-safety-for-women', crumb: 'Safety for women',
        title: 'Video Chat Safety for Women – Tools and Tips | OhMyGoal',
        description: 'Video chat safety for women: blur and masks, voice or text only, gender filter, one-tap block and report, and what to do about harassment or blackmail.',
        h1: 'Video chat safety for women',
        lede: 'You should be able to meet new people without putting up with harassment. These are the tools OhMyGoal gives you, and practical tips that work on any site.',
        points: [
            ['Leave in one tap', 'Next, Block and Report are always on screen.'],
            ['Nudity blurred', 'Explicit video is blurred before you see it.'],
            ['Choose who you meet', 'A gender filter with Premium (from ₹49).'],
            ['Hide your face', 'Background blur, masks, or voice or text only.'],
        ],
        sections: [
            { h: 'Tools you can use', list: [
                '<b>Blur and masks:</b> free background blur and a mask effect, so you share only what you want.',
                '<b>Voice or Text:</b> start without video and switch only if you feel comfortable.',
                '<b>Gender and country filters</b> with the Premium pass.',
                '<b>Block:</b> a blocked person is never matched with you again. <b>Report:</b> moderators review it, and bans cover device, network and account.',
                '<b>Scam shield:</b> a warning when someone shares a phone number, UPI ID or social handle.',
            ] },
            { h: 'Practical tips', list: [
                'Keep your face out of frame at first if you prefer; a blurred background hides your room.',
                'Do not share your surname, workplace, college, address or social media.',
                'If someone harasses or threatens you, block and report. In India call <b>1930</b> or use cybercrime.gov.in, and the women helpline <b>181</b>.',
            ] },
        ],
        faq: [
            ['Can I talk only to women?', 'With Premium you can choose to meet women (or men). Chatting itself is free.'],
            ['What happens when I report someone?', 'The report goes to moderators. People who break the rules are banned by device, network and account.'],
            ['Can someone record me?', 'We never record chats, but the other person could record their screen. Use blur, masks or voice-only if you want to stay private.'],
        ],
    },
    {
        ...base, slug: 'practice-english-speaking', crumb: 'Practice English speaking',
        title: 'Practice English Speaking Online with Strangers – Free | OhMyGoal',
        description: 'Practice English speaking online for free: the language exchange room matches you with people who speak English and want to learn your language.',
        h1: 'Practice English speaking online',
        lede: 'The fastest way to get better at spoken English is to speak it. The language exchange room on OhMyGoal matches you with someone who speaks English and wants to practise your language in return.',
        points: [
            ['Language exchange room', 'You help with Hindi (or your language), they help with English.'],
            ['Voice or video', 'Speak first; video only if you want.'],
            ['Text when stuck', 'Type a word you cannot say, then say it.'],
            ['Free', 'No account, no fee.'],
        ],
        sections: [
            { h: 'How to set it up', steps: [
                'Open the rooms and pick <b>Language exchange</b>.',
                'Choose the language you speak and the one you want to practise (English).',
                'Start a Voice chat. You will be matched with someone who fits.',
            ] },
            { h: 'Tips for a good practice chat', list: [
                'Agree to switch: ten minutes in English, ten in their language.',
                'Ask them to correct one mistake at a time, not every word.',
                'Talk about something you know well: your city, your food, cricket, films.',
                'With Premium, Live translate helps when you are really stuck.',
            ] },
        ],
        faq: [
            ['Is English speaking practice free?', 'Yes. The language exchange room and all chats are free.'],
            ['Who will I talk to?', 'Adults who speak the language you are learning and want to learn yours.'],
            ['Do I need to show my face?', 'No. Choose Voice for audio only.'],
        ],
    },
    {
        ...base, slug: 'group-video-chat', crumb: 'Group video chat',
        title: 'Group Video Chat with Strangers – Rooms for 4, Voice for 8 | OhMyGoal',
        description: 'Free group video chat with strangers: video rooms for up to 4 people and voice rooms for up to 8, by topic. No sign-up, adults only.',
        h1: 'Group video chat with strangers',
        lede: 'Sometimes one-to-one is too much pressure. Group rooms let you join a conversation already going: video rooms for up to 4 people and voice rooms for up to 8.',
        points: [
            ['Video rooms', 'Up to 4 people.'],
            ['Voice rooms', 'Up to 8 people.'],
            ['By topic', 'Join a room about something you like.'],
            ['Leave any time', 'No pressure to stay.'],
        ],
        sections: [
            { h: 'How group rooms work', steps: [
                'Open <b>Group rooms</b> from the start page.',
                'Choose Video or Voice and a topic.',
                'You join a room with space, or a new one opens. Everyone connects directly to everyone else.',
            ] },
            { h: 'Good to know', list: [
                'Group rooms are in beta: tell us what you would like next.',
                'The same rules apply as in one-to-one chats, and you can report anyone in the room.',
                'For bigger audiences, Live sessions let a host talk to many people at once.',
            ] },
        ],
        faq: [
            ['How many people can join a group video chat?', 'Video rooms hold up to 4 people and voice rooms up to 8.'],
            ['Is group chat free?', 'Yes.'],
            ['Can I report someone in a group?', 'Yes. Report and Block work in group rooms too.'],
        ],
    },
);
