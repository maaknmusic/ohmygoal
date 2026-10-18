// =====================================================================
// Conversation starters for strangers. Pure data + one picker (no DOM).
// Packs: 'general' plus one per interest tag, in English and Hindi (Devanagari).
// Prompts are warm and safe for work, and never ask for personal details.
// =====================================================================

export const LANGS = ['en', 'hi'];

export const TAGS = Object.freeze([
    'cricket', 'music', 'bollywood', 'movies', 'gaming', 'travel', 'food',
    'coding', 'study', 'anime', 'fitness', 'books', 'art', 'tech',
]);

const MAX_COUNT = 20;
const DEFAULT_COUNT = 3;

// Alternative spellings people type in an interests box. Anything not listed or in TAGS is ignored.
const SYNONYMS = new Map(Object.entries({
    ipl: 'cricket', t20: 'cricket', bcci: 'cricket',
    songs: 'music', singing: 'music', guitar: 'music', 'hip hop': 'music', hiphop: 'music',
    bolly: 'bollywood', 'hindi movies': 'bollywood', 'hindi films': 'bollywood',
    film: 'movies', films: 'movies', movie: 'movies', cinema: 'movies', ott: 'movies', series: 'movies', netflix: 'movies',
    games: 'gaming', game: 'gaming', videogames: 'gaming', 'video games': 'gaming', esports: 'gaming', bgmi: 'gaming', pubg: 'gaming',
    travelling: 'travel', traveling: 'travel', trekking: 'travel', trips: 'travel', roadtrips: 'travel',
    foodie: 'food', cooking: 'food', cuisine: 'food', baking: 'food',
    programming: 'coding', code: 'coding', developer: 'coding', dev: 'coding', software: 'coding', hacking: 'coding',
    studies: 'study', studying: 'study', exams: 'study', education: 'study', jee: 'study', neet: 'study', upsc: 'study',
    manga: 'anime', otaku: 'anime',
    gym: 'fitness', workout: 'fitness', yoga: 'fitness', running: 'fitness', health: 'fitness',
    reading: 'books', book: 'books', novels: 'books', literature: 'books',
    painting: 'art', drawing: 'art', sketching: 'art', design: 'art', photography: 'art',
    technology: 'tech', gadgets: 'tech', ai: 'tech', phones: 'tech',
}));

const PACKS = {
    en: {
        general: [
            'Chai or coffee?',
            'Mountains or beaches?',
            'Early bird or night owl?',
            'Cats or dogs?',
            'Biryani or pizza?',
            'Rain or sunshine?',
            'Movie night at home or a night out?',
            'Sweet or spicy?',
            'Books or podcasts?',
            'Summer or winter?',
            'Window seat or aisle seat?',
            'Midnight Maggi or morning chai?',
            'What is the best thing that happened to you this week?',
            'What song is stuck in your head right now?',
            'What is one small thing that made you smile today?',
            'If you could instantly learn any skill, what would it be?',
            'What is your go-to comfort food?',
            'What is the best street food you have ever had?',
            'Which show or movie could you watch a hundred times?',
            'If you could teleport anywhere right now, where would you go?',
            'What is a hobby you have always wanted to try?',
            'What is the best advice anyone has ever given you?',
            'Which superpower would you pick, and what would you do with it first?',
            'How do you like to spend a lazy Sunday?',
            'What is a tiny thing in life that you are oddly passionate about?',
            'If you could have dinner with anyone from history, who would it be?',
            'What is the most useful thing you have learned recently?',
            'Which festival do you enjoy the most, and why?',
            'What would your perfect weekend look like?',
            'What is the best trip you have taken, or the one you dream about?',
            'Which movie dialogue do you quote way too often?',
            'Which language would you love to learn?',
            'If you opened a cafe, what would you name it?',
            'What is a childhood game you still miss?',
            'What is your go-to way to cheer yourself up after a rough day?',
            'If you could swap places with a fictional character for a day, who would it be?',
            'What is something you are really proud of?',
            'What is the weirdest food combo you secretly love?',
            'What was your favourite cartoon growing up?',
            'What is something that always makes you laugh?',
            'What is something you are looking forward to?',
        ],
        cricket: [
            'Which cricketer could you watch bat all day?',
            'Test cricket or T20, which one wins for you?',
            'What is the best match you have ever watched?',
            'What was the funniest gully cricket rule you grew up with?',
            'Which IPL team do you support, and what made you pick it?',
            'Would you rather score a century or take a hat-trick?',
            'Which World Cup moment gave you goosebumps?',
            'Who would be in your all-time dream XI?',
        ],
        music: [
            'What is the one song you never skip?',
            'Which artist have you been playing on repeat lately?',
            'Old classics or new releases, which fills your playlist more?',
            'Which song instantly takes you back to a memory?',
            'If you could attend any concert, whose would it be?',
            'Do you play an instrument or sing, or is it just shower concerts?',
            'What is the best song for a long journey?',
            'Lo-fi, rock or classical for studying or working?',
        ],
        bollywood: [
            'Which Bollywood movie can you recite dialogues from by heart?',
            'Which actor\'s films do you never miss?',
            'Old-school Bollywood or modern films, which side are you on?',
            'What is the best Bollywood song for a road trip?',
            'Which Bollywood film made you cry or laugh the most?',
            'If your life had a Bollywood soundtrack, what would the opening song be?',
            'Which movie villain do you secretly love?',
            'Which Bollywood dance number do you know every step of?',
        ],
        movies: [
            'What is the last movie that genuinely blew your mind?',
            'Which movie have you watched the most times?',
            'Theatre or OTT at home, where do you enjoy films more?',
            'Which movie ending left you speechless?',
            'Which movie should everyone watch at least once?',
            'Which film has the best soundtrack in your opinion?',
            'Comedy, thriller or sci-fi, what is your usual pick?',
            'If you could step inside any movie world for a day, which one would it be?',
        ],
        gaming: [
            'Which game can you play for hours without noticing the time?',
            'Mobile, console or PC, where do you game?',
            'What was the first video game you ever played?',
            'Co-op with friends or solo adventures?',
            'Which game has the best story you have ever played?',
            'Which game soundtrack is stuck in your head?',
            'What is the most satisfying win you have had in a game?',
            'Which game do you wish you could play again for the first time?',
        ],
        travel: [
            'What is the most beautiful place you have ever been to?',
            'Beach holiday or mountain trek?',
            'What is on your travel bucket list?',
            'What is the best road trip snack?',
            'Planner or spontaneous, how do you travel?',
            'Which city do you think everyone should visit once?',
            'Train, flight or road, what is your favourite way to travel?',
            'What is the best local dish you have found while travelling?',
        ],
        food: [
            'If you could eat only one cuisine forever, which one would it be?',
            'What is the best dish you have ever cooked, or tried to cook?',
            'Which street food stall do you dream about?',
            'Dosa, paratha or biryani, pick one!',
            'What is your comfort meal after a long day?',
            'What is the best home-cooked dish you have ever eaten?',
            'Sweet tooth or spice lover?',
            'What is the most unusual thing you have eaten?',
        ],
        coding: [
            'What was the first thing you ever built with code?',
            'Tabs or spaces? Be honest.',
            'Which programming language do you enjoy the most, and why?',
            'What is the most satisfying bug you have ever fixed?',
            'What are you building or learning right now?',
            'Dark mode forever or light mode warrior?',
            'Which side project would you build if you had a free month?',
            'What is your best tip for someone who is just starting to code?',
        ],
        study: [
            'What are you studying or learning these days?',
            'What is your favourite subject, and what makes it fun?',
            'Morning study sessions or late-night cramming?',
            'What is your best trick for staying focused?',
            'Which teacher made a big difference to you?',
            'Study music or total silence?',
            'What is the most interesting thing you have learned this month?',
            'If you could master any subject overnight, what would it be?',
        ],
        anime: [
            'What is the first anime you ever watched?',
            'Which anime ending hit you the hardest?',
            'Sub or dub, where do you stand?',
            'Which anime world would you love to live in?',
            'Who is your favourite anime character, and why?',
            'Which anime should I add to my watchlist?',
            'What is the best anime opening song ever?',
            'Shonen action or slice-of-life, what is your vibe?',
        ],
        fitness: [
            'What is your favourite way to stay active?',
            'Gym, yoga or a long walk, which one is your reset button?',
            'Morning workout or evening workout?',
            'What is a fitness goal you are proud of?',
            'What is your go-to snack after a workout?',
            'Which sport would you love to try someday?',
            'What motivation trick works best for you?',
            'What is the top song on your workout playlist?',
        ],
        books: [
            'What is the best book you have read this year?',
            'Paperback or e-reader?',
            'Which book character would you love to have as a friend?',
            'Which book do you recommend to everyone?',
            'Fiction or non-fiction, where do you spend more time?',
            'Which book kept you up way past bedtime?',
            'Which author would you love to meet?',
            'What is on your to-read pile right now?',
        ],
        art: [
            'What kind of art do you enjoy making or looking at?',
            'Sketching, painting or digital art, which one is your style?',
            'Whose artwork could you stare at for hours?',
            'What is the last thing you created that you were proud of?',
            'Rangoli, mehendi or doodles, which one is your thing?',
            'If you could paint a mural anywhere, where would it be?',
            'What inspires you most when you create something?',
            'Which museum or gallery is on your wish list?',
        ],
        tech: [
            'What is the coolest gadget you own?',
            'Android or iPhone, and why?',
            'Which app can you not live without?',
            'Which technology do you think will change everyone\'s life next?',
            'If you could invent one gadget, what would it do?',
            'What is the most useful phone trick you know?',
            'Which tech launch are you most excited about?',
            'A clean home screen or one packed with apps?',
        ],
    },
    hi: {
        general: [
            'चाय या कॉफ़ी?',
            'पहाड़ या समंदर का किनारा?',
            'सुबह जल्दी उठने वाले या रात के उल्लू?',
            'बिल्ली या कुत्ता?',
            'बिरयानी या पिज़्ज़ा?',
            'बारिश या धूप?',
            'घर पर मूवी नाइट या बाहर घूमना?',
            'मीठा या तीखा?',
            'किताबें या पॉडकास्ट?',
            'गर्मी या सर्दी?',
            'खिड़की वाली सीट या गलियारे वाली?',
            'आधी रात की मैगी या सुबह की चाय?',
            'इस हफ़्ते की सबसे अच्छी बात क्या रही?',
            'आजकल कौन-सा गाना दिमाग़ में अटका हुआ है?',
            'आज किस छोटी-सी बात ने आपको मुस्कुराने पर मजबूर किया?',
            'अगर आप कोई भी हुनर पल भर में सीख सकें, तो कौन-सा चुनेंगे?',
            'आपका पसंदीदा कम्फ़र्ट फ़ूड क्या है?',
            'अब तक का सबसे लाजवाब स्ट्रीट फ़ूड कौन-सा खाया है?',
            'ऐसी कौन-सी फ़िल्म या सीरीज़ है जिसे आप सौ बार देख सकते हैं?',
            'अगर अभी कहीं भी पहुँच सकें, तो कहाँ जाना चाहेंगे?',
            'कौन-सा शौक़ आज़माने का मन हमेशा से रहा है?',
            'अब तक की सबसे अच्छी सलाह कौन-सी मिली है?',
            'कौन-सी सुपरपावर चुनेंगे, और सबसे पहले उसका क्या करेंगे?',
            'आलसी रविवार आप कैसे बिताना पसंद करते हैं?',
            'ज़िंदगी की किस छोटी-सी चीज़ के लिए आप हद से ज़्यादा जुनूनी हैं?',
            'इतिहास की किस शख़्सियत के साथ डिनर करना चाहेंगे?',
            'हाल ही में सीखी हुई सबसे काम की बात क्या है?',
            'कौन-सा त्योहार आपको सबसे ज़्यादा पसंद है, और क्यों?',
            'आपका परफ़ेक्ट वीकेंड कैसा होगा?',
            'अब तक की सबसे यादगार ट्रिप कौन-सी रही, या कहाँ जाने का सपना है?',
            'कौन-सा फ़िल्मी डायलॉग आप ज़रूरत से ज़्यादा बोलते हैं?',
            'कौन-सी भाषा सीखना चाहेंगे?',
            'अगर आप कैफ़े खोलें, तो उसका नाम क्या रखेंगे?',
            'बचपन का कौन-सा खेल आज भी याद आता है?',
            'बुरे दिन के बाद ख़ुद को खुश करने का आपका तरीक़ा क्या है?',
            'एक दिन के लिए किस काल्पनिक किरदार की जगह लेना चाहेंगे?',
            'किस बात पर आपको सच में गर्व है?',
            'कौन-सा अजीब फ़ूड कॉम्बिनेशन आप चुपके से पसंद करते हैं?',
            'बचपन का आपका पसंदीदा कार्टून कौन-सा था?',
            'कौन-सी बात हमेशा आपको हँसा देती है?',
            'ऐसा क्या है जिसका आपको बेसब्री से इंतज़ार है?',
        ],
        cricket: [
            'कौन-सा क्रिकेटर है जिसकी बल्लेबाज़ी आप दिन भर देख सकते हैं?',
            'टेस्ट क्रिकेट या T20, आपका वोट किसे?',
            'अब तक देखा हुआ सबसे शानदार मैच कौन-सा था?',
            'गली क्रिकेट का सबसे मज़ेदार नियम कौन-सा था जो आपके मोहल्ले में चलता था?',
            'आप कौन-सी आईपीएल टीम को सपोर्ट करते हैं, और क्यों?',
            'शतक बनाना या हैट्रिक लेना, क्या चुनेंगे?',
            'वर्ल्ड कप का कौन-सा पल देखकर रोंगटे खड़े हो गए थे?',
            'आपकी ऑल-टाइम ड्रीम इलेवन में कौन-कौन होगा?',
        ],
        music: [
            'वो कौन-सा गाना है जिसे आप कभी स्किप नहीं करते?',
            'आजकल किस कलाकार को रिपीट पर सुन रहे हैं?',
            'पुराने क्लासिक गाने या नई रिलीज़, आपकी प्लेलिस्ट में किसका पलड़ा भारी है?',
            'कौन-सा गाना सुनते ही कोई पुरानी याद ताज़ा हो जाती है?',
            'किसी भी कॉन्सर्ट में जाने का मौक़ा मिले, तो किसका चुनेंगे?',
            'क्या आप कोई वाद्य बजाते हैं या गाते हैं, या बस बाथरूम सिंगर हैं?',
            'लंबे सफ़र के लिए सबसे बढ़िया गाना कौन-सा है?',
            'पढ़ाई या काम के वक़्त लो-फ़ाई, रॉक या क्लासिकल, क्या चलता है?',
        ],
        bollywood: [
            'कौन-सी बॉलीवुड फ़िल्म के डायलॉग आपको ज़ुबानी याद हैं?',
            'किस अभिनेता की फ़िल्म आप कभी मिस नहीं करते?',
            'पुराने ज़माने की फ़िल्में या आज की, आप किस तरफ़ हैं?',
            'रोड ट्रिप के लिए सबसे बढ़िया बॉलीवुड गाना कौन-सा है?',
            'किस बॉलीवुड फ़िल्म ने आपको सबसे ज़्यादा रुलाया या हँसाया?',
            'अगर आपकी ज़िंदगी पर फ़िल्म बने, तो शुरुआती गाना कौन-सा होगा?',
            'किस फ़िल्मी विलेन को आप चुपके से पसंद करते हैं?',
            'किस डांस नंबर के सारे स्टेप आपको आते हैं?',
        ],
        movies: [
            'आख़िरी कौन-सी फ़िल्म थी जिसने आपको सच में हैरान कर दिया?',
            'कौन-सी फ़िल्म आपने सबसे ज़्यादा बार देखी है?',
            'सिनेमाघर या घर पर ओटीटी, फ़िल्म का मज़ा कहाँ ज़्यादा आता है?',
            'किस फ़िल्म का क्लाइमैक्स देखकर आप सन्न रह गए थे?',
            'ऐसी कौन-सी फ़िल्म है जो सबको कम से कम एक बार देखनी चाहिए?',
            'आपके हिसाब से किस फ़िल्म का साउंडट्रैक सबसे अच्छा है?',
            'कॉमेडी, थ्रिलर या साइ-फ़ाई, आप आम तौर पर क्या चुनते हैं?',
            'एक दिन के लिए किसी भी फ़िल्म की दुनिया में जा सकें, तो कौन-सी चुनेंगे?',
        ],
        gaming: [
            'कौन-सा गेम है जिसे खेलते हुए आपको वक़्त का पता ही नहीं चलता?',
            'मोबाइल, कंसोल या पीसी, आप कहाँ गेमिंग करते हैं?',
            'पहला वीडियो गेम कौन-सा खेला था?',
            'दोस्तों के साथ को-ऑप या अकेले का एडवेंचर?',
            'अब तक खेला हुआ सबसे बढ़िया कहानी वाला गेम कौन-सा है?',
            'किस गेम का म्यूज़िक आपके दिमाग़ में बैठ गया है?',
            'गेम में आपकी सबसे यादगार जीत कौन-सी रही?',
            'कौन-सा गेम आप दोबारा पहली बार खेलना चाहेंगे?',
        ],
        travel: [
            'अब तक की सबसे ख़ूबसूरत जगह कौन-सी देखी है?',
            'समुद्र किनारे की छुट्टी या पहाड़ों का ट्रेक?',
            'आपकी ट्रैवल बकेट लिस्ट में सबसे ऊपर क्या है?',
            'रोड ट्रिप का सबसे बढ़िया स्नैक कौन-सा है?',
            'आप प्लान बनाकर घूमते हैं या अचानक निकल पड़ते हैं?',
            'कौन-सा शहर हर किसी को एक बार ज़रूर देखना चाहिए?',
            'सफ़र का आपका पसंदीदा तरीक़ा क्या है, ट्रेन, हवाई जहाज़ या सड़क?',
            'घूमते हुए चखा हुआ सबसे लाजवाब लोकल व्यंजन कौन-सा है?',
        ],
        food: [
            'सिर्फ़ एक ही तरह का खाना हमेशा खाना पड़े, तो कौन-सा चुनेंगे?',
            'आपने अब तक का सबसे बढ़िया कौन-सा पकवान बनाया है, या बनाने की कोशिश की है?',
            'किस स्ट्रीट फ़ूड के ठेले की याद आपको सपनों में भी आती है?',
            'डोसा, पराठा या बिरयानी, कोई एक चुनिए!',
            'लंबे दिन के बाद आपका कम्फ़र्ट मील क्या होता है?',
            'घर का बना सबसे लाजवाब खाना कौन-सा खाया है?',
            'आप मीठे के शौक़ीन हैं या तीखे के दीवाने?',
            'अब तक की सबसे अनोखी चीज़ क्या खाई है?',
        ],
        coding: [
            'कोड से आपने सबसे पहली चीज़ क्या बनाई थी?',
            'टैब या स्पेस? सच-सच बताइए।',
            'कौन-सी प्रोग्रामिंग भाषा आपको सबसे ज़्यादा पसंद है, और क्यों?',
            'अब तक का सबसे मज़ेदार बग कौन-सा ठीक किया है?',
            'आजकल आप क्या बना रहे हैं या सीख रहे हैं?',
            'हमेशा डार्क मोड या लाइट मोड वाले योद्धा?',
            'एक महीने की फ़ुर्सत मिले, तो कौन-सा साइड प्रोजेक्ट बनाएँगे?',
            'कोडिंग शुरू करने वालों को आप सबसे बढ़िया सलाह क्या देंगे?',
        ],
        study: [
            'आजकल आप क्या पढ़ रहे हैं या सीख रहे हैं?',
            'आपका पसंदीदा विषय कौन-सा है, और उसमें मज़ा क्या है?',
            'सुबह की पढ़ाई या रात को आख़िरी वक़्त की रटाई?',
            'ध्यान लगाए रखने की आपकी सबसे बढ़िया तरकीब क्या है?',
            'किस टीचर ने आपकी ज़िंदगी में बड़ा फ़र्क़ डाला?',
            'पढ़ाई के वक़्त म्यूज़िक या एकदम सन्नाटा?',
            'इस महीने सबसे दिलचस्प चीज़ क्या सीखी?',
            'एक रात में कोई भी विषय सीख सकें, तो कौन-सा चुनेंगे?',
        ],
        anime: [
            'पहला एनीमे कौन-सा देखा था?',
            'किस एनीमे के अंत ने आपको सबसे ज़्यादा झकझोरा?',
            'सब या डब, आप किस तरफ़ हैं?',
            'किस एनीमे की दुनिया में रहना चाहेंगे?',
            'आपका पसंदीदा एनीमे किरदार कौन-सा है, और क्यों?',
            'मेरी वॉचलिस्ट में कौन-सा एनीमे जोड़ना चाहिए?',
            'अब तक का सबसे बढ़िया एनीमे ओपनिंग गाना कौन-सा है?',
            'शोनेन एक्शन या स्लाइस-ऑफ़-लाइफ़, आपका मूड क्या है?',
        ],
        fitness: [
            'सक्रिय रहने का आपका पसंदीदा तरीक़ा क्या है?',
            'जिम, योग या लंबी सैर, आपका रीसेट बटन कौन-सा है?',
            'सुबह की वर्कआउट या शाम की?',
            'फ़िटनेस का कौन-सा लक्ष्य आपने पूरा किया है जिस पर गर्व है?',
            'वर्कआउट के बाद आपका पसंदीदा स्नैक क्या है?',
            'कौन-सा खेल आप कभी आज़माना चाहेंगे?',
            'मोटिवेशन बनाए रखने की आपकी कौन-सी तरकीब काम करती है?',
            'आपकी वर्कआउट प्लेलिस्ट में सबसे ऊपर कौन-सा गाना है?',
        ],
        books: [
            'इस साल पढ़ी हुई सबसे अच्छी किताब कौन-सी है?',
            'काग़ज़ की किताब या ई-रीडर?',
            'किस किताब के किरदार को आप दोस्त बनाना चाहेंगे?',
            'कौन-सी किताब आप हर किसी को पढ़ने को कहते हैं?',
            'कहानियाँ या ज्ञान की किताबें, आप किसमें ज़्यादा डूबते हैं?',
            'किस किताब ने आपको सोने का वक़्त भुला दिया?',
            'किस लेखक से मिलना चाहेंगे?',
            'आपकी पढ़ने वाली सूची में अभी क्या-क्या है?',
        ],
        art: [
            'आपको किस तरह की कला बनाना या देखना पसंद है?',
            'स्केचिंग, पेंटिंग या डिजिटल आर्ट, आपका अंदाज़ कौन-सा है?',
            'किस कलाकार की कृति आप घंटों निहार सकते हैं?',
            'आख़िरी बार आपने ऐसा क्या बनाया जिस पर आपको नाज़ हुआ?',
            'रंगोली, मेहंदी या डूडल, आपका मनपसंद कौन-सा है?',
            'किसी भी दीवार पर भित्तिचित्र बना सकें, तो कहाँ बनाएँगे?',
            'कुछ रचते वक़्त आपको सबसे ज़्यादा प्रेरणा कहाँ से मिलती है?',
            'कौन-सा म्यूज़ियम या गैलरी आपकी विश-लिस्ट में है?',
        ],
        tech: [
            'आपके पास सबसे मस्त गैजेट कौन-सा है?',
            'एंड्रॉइड या आईफ़ोन, और क्यों?',
            'कौन-सा ऐप आपके बिना नहीं चलता?',
            'आपके हिसाब से अगली कौन-सी टेक्नोलॉजी सबकी ज़िंदगी बदलेगी?',
            'कोई एक गैजेट बना सकें, तो वो क्या करेगा?',
            'फ़ोन की सबसे काम की ट्रिक कौन-सी जानते हैं?',
            'किस टेक लॉन्च का आपको सबसे ज़्यादा इंतज़ार है?',
            'साफ़-सुथरी होम स्क्रीन या ऐप्स से भरी हुई?',
        ],
    },
};

/** Random index below n; tolerates a rand() that returns garbage. */
function pickIndex(n, rand) {
    const r = Number(rand());
    return Number.isFinite(r) ? Math.min(n - 1, Math.max(0, Math.floor(r * n))) : 0;
}

/** Fisher-Yates on a copy. */
function shuffled(list, rand) {
    const out = list.slice();
    for (let i = out.length - 1; i > 0; i--) {
        const j = pickIndex(i + 1, rand);
        [out[i], out[j]] = [out[j], out[i]];
    }
    return out;
}

/** Interest tags (in the order given, no repeats) from free-typed interests like 'IPL' or 'films'. */
function normalizeTags(interests) {
    const tags = [];
    if (!Array.isArray(interests)) return tags;
    for (const raw of interests.slice(0, 50)) {
        if (typeof raw !== 'string') continue;
        const key = raw.trim().toLowerCase().replace(/^#/, '');
        const tag = TAGS.includes(key) ? key : SYNONYMS.get(key);
        if (tag && !tags.includes(tag)) tags.push(tag);
    }
    return tags;
}

/** 'hi-IN' / 'HI' -> 'hi'; anything unknown -> 'en'. */
function normalizeLang(lang) {
    const base = typeof lang === 'string' ? lang.trim().toLowerCase().split(/[-_]/)[0] : '';
    return LANGS.includes(base) ? base : 'en';
}

/** A pack in the requested language, or the English one when that language doesn't have it. */
const packOf = (lang, tag) => PACKS[lang]?.[tag] || PACKS.en[tag] || [];

/** Several shuffled lists woven together, so every tag gets a turn before any gets a second one. */
function interleave(lists) {
    const out = [];
    const longest = Math.max(0, ...lists.map(l => l.length));
    for (let i = 0; i < longest; i++) {
        for (const list of lists) if (i < list.length) out.push(list[i]);
    }
    return out;
}

/**
 * Up to `count` distinct conversation starters: shared-interest prompts first,
 * then the general pack. Prompts in `exclude` (a Set or array of strings) are skipped.
 * Returns fewer than `count` only when the packs run out.
 */
export function pickPrompts(options) {
    const { interests = [], lang = 'en', count = DEFAULT_COUNT, exclude, rand = Math.random } =
        options && typeof options === 'object' ? options : {};
    const random = typeof rand === 'function' ? rand : Math.random;
    const want = Number.isFinite(count) ? Math.max(0, Math.min(Math.floor(count), MAX_COUNT)) : DEFAULT_COUNT;
    const l = normalizeLang(lang);
    const skip = new Set(exclude instanceof Set || Array.isArray(exclude) ? exclude : []);

    const tags = shuffled(normalizeTags(interests), random);
    const pool = [
        ...interleave(tags.map(tag => shuffled(packOf(l, tag), random))),
        ...shuffled(packOf(l, 'general'), random),
    ];

    const out = [];
    const seen = new Set();
    for (const prompt of pool) {
        if (out.length >= want) break;
        if (seen.has(prompt) || skip.has(prompt)) continue;
        seen.add(prompt);
        out.push(prompt);
    }
    return out;
}
