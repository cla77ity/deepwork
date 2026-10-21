// Process watcher: the OS layer delivers the process list every 1.5 s, Node decides what to close.
const { EventEmitter } = require('events');
const sys = require('./sys');

class AppWatcher extends EventEmitter {
  constructor({ dry, log }) {
    super();
    this.dry = dry;
    this.log = log;
    this.stopWatch = null;
    this.rules = null;
    this.killedRecently = new Map();
  }

  // rules: { mode: 'block'|'whitelist', block: Set, allow: Set, safe: Set }
  start(rules) {
    this.rules = rules;
    if (!this.stopWatch) this.stopWatch = sys.watchProcesses(list => this.onList(list));
  }

  stop() {
    this.rules = null;
    if (this.stopWatch) { this.stopWatch(); this.stopWatch = null; }
  }

  // Which running processes the rules would close (also used for the start preview).
  match(list, rules) {
    const out = [];
    for (const [name, pid, hasWin, title] of list) {
      const n = String(name).toLowerCase();
      if (pid === process.pid || rules.safe.has(n)) continue;
      const hit = rules.block.has(n) || (rules.mode === 'whitelist' && hasWin && !rules.allow.has(n));
      if (hit) out.push({ name: n, pid, title: title || '' });
    }
    return out;
  }

  onList(list) {
    if (!this.rules) return;
    const victims = this.match(list, this.rules);
    const names = new Set();
    for (const v of victims) {
      if (this.dry) { this.log('dry: would close', v.name, v.pid); }
      else { try { process.kill(v.pid); } catch { } }
      names.add(v.name);
    }
    const now = Date.now();
    for (const n of names) {
      // one "attempt" per app per 20s, launchers spawn many processes
      if (now - (this.killedRecently.get(n) || 0) > 20000) this.emit('closed', n);
      this.killedRecently.set(n, now);
    }
  }

  // One-shot snapshot (for previews and the "add running app" picker).
  snapshot() { return sys.listProcesses(); }
}

module.exports = { AppWatcher };
