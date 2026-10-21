// Mock Razorpay API (+ a test endpoint the fake checkout uses to "pay").
import http from 'node:http';
import crypto from 'node:crypto';
const SECRET = 'test_key_secret';
const orders = new Map(), payments = new Map();
let n = 0, cfIssued = 0;
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
