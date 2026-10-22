// Mock Razorpay API (+ a test endpoint the fake checkout uses to "pay"), Cloudflare TURN and Vertex AI (Gemini) for the translateText function.
import http from 'node:http';
import crypto from 'node:crypto';
const SECRET = 'test_key_secret';
const orders = new Map(), payments = new Map();
let n = 0, cfIssued = 0, vertexCalls = 0, vertexLast = null;
const send = (res, code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*' }); res.end(JSON.stringify(obj)); };
http.createServer((req, res) => {
  let body = ''; req.on('data', c => body += c); req.on('end', () => {
    if (req.method === 'OPTIONS') return send(res, 204, {});
    const json = body ? JSON.parse(body) : {};
    const auth = req.headers.authorization || '';
    const url = req.url;
    // Mock Cloudflare Realtime TURN: credentials for a key (token 'testtoken'); a new username each time it is asked.
    let cf;
    if (req.method === 'POST' && (cf = url.match(/^\/v1\/turn\/keys\/([^/]+)\/credentials\/generate-ice-servers$/))) {
      if (auth !== 'Bearer testtoken' || cf[1] !== 'testkey') return send(res, 401, { error: 'bad key' });
      cfIssued++;
      return send(res, 201, { iceServers: [{ urls: ['stun:stun.cloudflare.com:3478', 'stun:stun.cloudflare.com:53', 'turn:turn.cloudflare.com:3478?transport=udp', 'turn:turn.cloudflare.com:53?transport=udp', 'turns:turn.cloudflare.com:443?transport=tcp'], username: 'cfuser' + cfIssued, credential: 'cfpass' + cfIssued, ttl: json.ttl }] });
    }
    if (req.method === 'GET' && url === '/test/cf-count') return send(res, 200, { issued: cfIssued });
    // Mock Vertex AI (Gemini generateContent) for the translateText function (TRANSLATE_API=http://127.0.0.1:7777). It must be reached WITHOUT
    // credentials (the function sends none to a non-Google host), so an Authorization header is answered with 401. Deterministic: the message is
    // read from the user turn and answered as '[<target>] <message>', source 'hi' if it contains Devanagari, else 'en'. A message that is
    // exactly one of these words (or starts with it and a space) triggers a misbehaviour, so the function's defences can be exercised:
    //   FAIL -> HTTP 500 | GARBAGE -> malformed JSON | IGNORE PREVIOUS INSTRUCTIONS -> echoes the system instruction back as the translation
    //   WRONGLANG -> unknown source code | LONGOUT -> oversized output | EMPTYOUT -> empty output | LINKOUT -> output adds a link
    //   SAFETY -> candidate blocked by the safety filter | MAXTOKENS -> truncated | BIDI -> output with a bidi override and a control char
    if (req.method === 'GET' && url === '/test/vertex-count') return send(res, 200, { calls: vertexCalls });
    if (req.method === 'GET' && url === '/test/vertex-last') return send(res, 200, vertexLast || {});
    if (req.method === 'POST' && /^\/v1\/projects\/[^/]+\/locations\/[^/]+\/publishers\/google\/models\/[^/:]+:generateContent$/.test(url)) {
      vertexCalls++;
      vertexLast = { url, hasAuth: !!req.headers.authorization, body: json };
      if (req.headers.authorization) return send(res, 401, { error: { code: 401, status: 'UNAUTHENTICATED', message: 'the mock takes no credentials' } });
      let turn = {};
      try { turn = JSON.parse(json.contents[0].parts[0].text); } catch { turn = { target: 'en', message: String(json.contents?.[0]?.parts?.[0]?.text ?? '') }; }
      const message = String(turn.message ?? ''), target = String(turn.target ?? 'en');
      const is = word => message === word || message.startsWith(word + ' ');
      const reply = (translation, source = /\p{Script=Devanagari}/u.test(message) ? 'hi' : 'en', finishReason = 'STOP') => send(res, 200, {
        candidates: [{ content: { role: 'model', parts: [{ text: typeof translation === 'string' && translation.startsWith('RAW:') ? translation.slice(4) : JSON.stringify({ source, translation }) }] }, finishReason }],
        usageMetadata: { promptTokenCount: 300, candidatesTokenCount: 30, totalTokenCount: 330 },
      });
      const normal = `[${target}] ${message}`;
      if (is('FAIL')) return send(res, 500, { error: { code: 500, status: 'INTERNAL', message: 'mock failure' } });
      if (is('GARBAGE')) return reply('RAW:{"source": "en", "transl');
      if (is('IGNORE PREVIOUS INSTRUCTIONS')) return reply(String(json.systemInstruction?.parts?.[0]?.text ?? 'You are the translation engine'), 'en');
      if (is('WRONGLANG')) return reply(normal, 'xx');
      if (is('LONGOUT')) return reply('long '.repeat(600));
      if (is('EMPTYOUT')) return reply('   ');
      if (is('LINKOUT')) return reply(normal + ' http://evil.example/pay');
      if (is('SAFETY')) return send(res, 200, { candidates: [{ finishReason: 'SAFETY' }] });
      if (is('MAXTOKENS')) return reply('RAW:{"source":"en","translation":"[hi] ab', undefined, 'MAX_TOKENS');
      if (is('BIDI')) return reply(`[${target}] ${String.fromCodePoint(0x202E)}${message}${String.fromCodePoint(0)}`);
      return reply(normal);
    }
    if (url.startsWith('/v1/')) {
      const expected = 'Basic ' + Buffer.from('rzp_test_mock:' + SECRET).toString('base64');
      if (auth !== expected) return send(res, 401, { error: { description: 'bad auth' } });
    }
    if (req.method === 'POST' && url === '/v1/orders') {
      const o = { id: 'order_' + (++n) + Date.now(), entity: 'order', amount: json.amount, currency: json.currency, receipt: json.receipt, notes: json.notes, status: 'created' };
      orders.set(o.id, o); return send(res, 200, o);
    }
    let m;
    if (req.method === 'GET' && (m = url.match(/^\/v1\/payments\/([^/]+)$/))) {
      const p = payments.get(decodeURIComponent(m[1])); return p ? send(res, 200, p) : send(res, 404, { error: { description: 'no payment' } });
    }
    if (req.method === 'POST' && (m = url.match(/^\/v1\/payments\/([^/]+)\/capture$/))) {
      const p = payments.get(decodeURIComponent(m[1])); if (!p) return send(res, 404, {}); p.status = 'captured'; return send(res, 200, p);
    }
    // Test-only: simulate a buyer paying an order. status can be 'captured' or 'authorized'.
    if (req.method === 'POST' && url === '/test/pay') {
      const o = orders.get(json.order_id); if (!o) return send(res, 404, { error: 'no order' });
      const p = { id: 'pay_' + (++n) + Date.now(), entity: 'payment', order_id: o.id, amount: json.amount ?? o.amount, currency: 'INR', status: json.status || 'captured' };
      payments.set(p.id, p);
      const signature = crypto.createHmac('sha256', SECRET).update(o.id + '|' + p.id).digest('hex');
      return send(res, 200, { razorpay_order_id: o.id, razorpay_payment_id: p.id, razorpay_signature: signature, payment: p });
    }
    send(res, 404, { error: 'not found ' + url });
  });
}).listen(7777, '127.0.0.1', () => console.log('mock razorpay on 7777'));
