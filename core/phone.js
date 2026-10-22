// Phone companion: a small web app served on the local network (same Wi-Fi). Open the address on
// the phone, enter the PIN, "Add to Home Screen" — works on iPhone and Android without an app store.
// Only private-network clients are answered; every API call needs the PIN.
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');

const PRIVATE = /^(127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.|::1$|fe80:|fd)/i;
const TYPES = { '.html': 'text/html; charset=utf-8', '.json': 'application/json', '.png': 'image/png', '.woff2': 'font/woff2', '.webmanifest': 'application/manifest+json' };

function lanAddresses() {
  const out = [];
  for (const list of Object.values(os.networkInterfaces())) {
    for (const a of list || []) if (a.family === 'IPv4' && !a.internal && PRIVATE.test(a.address)) out.push(a.address);
  }
  return out;
}

class PhoneServer {
  // getState() → JSON for the phone; act(name, body) → result (throws Error with a message on refusal)
  constructor({ port, pin, root, getState, act, log }) {
    Object.assign(this, { port, pin, root, getState, act, log });
    this.fails = new Map();
  }

  start() {
    if (this.server) return;
    this.server = http.createServer((req, res) => this.handle(req, res).catch(e => this.reply(res, 500, { error: e.message })));
    this.server.on('error', e => { this.log('phone server', e.message); this.error = e.message; });
    this.server.listen(this.port, '0.0.0.0');
  }

  stop() { if (this.server) { this.server.close(); this.server = null; } }

  urls() { return lanAddresses().map(a => `http://${a}:${this.port}`); }

  reply(res, code, obj) {
    res.writeHead(code, { 'content-type': 'application/json', 'cache-control': 'no-store' });
    res.end(JSON.stringify(obj));
  }

  authed(req) {
    const cookie = (req.headers.cookie || '').match(/dwpin=(\d+)/);
    return (req.headers['x-pin'] || (cookie && cookie[1])) === String(this.pin);
  }

  async body(req) {
    let b = '';
    for await (const ch of req) { b += ch; if (b.length > 1e5) throw new Error('too big'); }
    return b ? JSON.parse(b) : {};
  }

  async handle(req, res) {
    const ip = (req.socket.remoteAddress || '').replace(/^::ffff:/, '');
    if (!PRIVATE.test(ip)) { res.writeHead(403); return res.end(); }
    const url = new URL(req.url, 'http://x');

    if (url.pathname === '/api/login' && req.method === 'POST') {
      const f = this.fails.get(ip) || { n: 0, t: 0 };
      if (f.n >= 5 && Date.now() - f.t < 60000) return this.reply(res, 429, { error: 'Слишком много попыток, подожди минуту' });
      const { pin } = await this.body(req);
      if (String(pin) !== String(this.pin)) { this.fails.set(ip, { n: f.n + 1, t: Date.now() }); return this.reply(res, 401, { error: 'Неверный PIN' }); }
      this.fails.delete(ip);
      res.writeHead(200, { 'content-type': 'application/json', 'set-cookie': `dwpin=${this.pin}; Path=/; Max-Age=31536000; SameSite=Strict; HttpOnly` });
      return res.end('{"ok":true}');
    }
    if (url.pathname.startsWith('/api/')) {
      if (!this.authed(req)) return this.reply(res, 401, { error: 'Нужен PIN' });
      if (url.pathname === '/api/state') return this.reply(res, 200, this.getState());
      if (req.method === 'POST') {
        try { return this.reply(res, 200, { ok: true, result: await this.act(url.pathname.slice(5), await this.body(req)) }); }
        catch (e) { return this.reply(res, 400, { error: e.message }); }
      }
      return this.reply(res, 404, { error: 'нет такого' });
    }
    // static files of the phone app
    // root is renderer/: the phone page lives in phone/, fonts are shared with the desktop app
    const rel = url.pathname === '/' ? 'phone/index.html' : url.pathname.slice(1);
    if (!/^(phone|fonts)\//.test(rel)) { res.writeHead(404); return res.end(); }
    const file = path.join(this.root, path.normalize(rel).replace(/^(\.\.[/\\])+/, ''));
    if (!file.startsWith(this.root) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
  }
}

module.exports = { PhoneServer, lanAddresses };
