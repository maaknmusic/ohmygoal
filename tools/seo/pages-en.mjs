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
