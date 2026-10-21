// Local WebSocket the Brave extension connects to. Only extension origins are accepted,
// so ordinary web pages can't talk to it.
const { WebSocketServer } = require('ws');
const { EventEmitter } = require('events');

const PORT = 47321;

class Bridge extends EventEmitter {
  constructor(getState, port = PORT) {
    super();
    this.port = port;
    this.getState = getState;
    this.clients = new Set();
    this.info = new Map();
  }

  start() {
    this.wss = new WebSocketServer({
      host: '127.0.0.1', port: this.port,
      verifyClient: ({ origin }) => /^(chrome|moz)-extension:\/\//.test(origin || ''),
    });
    this.wss.on('error', e => this.emit('error', e));
    this.wss.on('connection', ws => {
      this.clients.add(ws);
      ws.send(JSON.stringify({ type: 'state', state: this.getState() }));
      ws.on('message', raw => {
        let msg;
        try { msg = JSON.parse(raw); } catch { return; }
        if (msg.type === 'hello') { this.info.set(ws, msg); this.emitStatus(); }
        if (msg.type === 'attempt' && typeof msg.domain === 'string') this.emit('attempt', msg.domain.slice(0, 120));
      });
      ws.on('close', () => { this.clients.delete(ws); this.info.delete(ws); this.emitStatus(); });
      this.emitStatus();
    });
    // keeps the MV3 service worker alive and the state fresh
    this.ping = setInterval(() => this.broadcast(), 20000);
  }

  status() {
    const infos = [...this.info.values()];
    return { connected: this.clients.size > 0, incognito: infos.some(i => i.incognito), version: infos[0] && infos[0].version };
  }

  emitStatus() { this.emit('status', this.status()); }

  broadcast() {
    const data = JSON.stringify({ type: 'state', state: this.getState() });
    for (const ws of this.clients) if (ws.readyState === 1) ws.send(data);
  }

  stop() {
    clearInterval(this.ping);
    if (this.wss) this.wss.close();
  }
}

module.exports = { Bridge, PORT };
