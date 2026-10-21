// Process watcher: one long-lived PowerShell prints the process list every 1.5s,
// Node decides what to close.
const { spawn } = require('child_process');
const { EventEmitter } = require('events');
const { ps, encode } = require('./sys');

const LOOP = `
$ErrorActionPreference = 'SilentlyContinue'
while ($true) {
  $p = Get-Process
  $list = @($p | ForEach-Object { ,@($_.ProcessName, $_.Id, [int]($_.MainWindowHandle -ne 0), $_.MainWindowTitle) })
  [Console]::Out.WriteLine((ConvertTo-Json -InputObject $list -Compress -Depth 3))
  [Console]::Out.Flush()
  Start-Sleep -Milliseconds 1500
}
`;

class AppWatcher extends EventEmitter {
  constructor({ dry, log }) {
    super();
    this.dry = dry;
    this.log = log;
    this.proc = null;
    this.rules = null;
    this.killedRecently = new Map();
  }

  // rules: { mode: 'block'|'whitelist', block: Set, allow: Set, safe: Set }
  start(rules) {
    this.rules = rules;
    if (this.proc) return;
    this.proc = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', encode(LOOP)], { windowsHide: true });
    let buf = '';
    this.proc.stdout.on('data', d => {
      buf += d;
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i).trim();
        buf = buf.slice(i + 1);
        if (line) this.onList(line);
      }
    });
    this.proc.on('exit', () => {
      this.proc = null;
      if (this.rules) setTimeout(() => this.rules && this.start(this.rules), 2000);
    });
  }

  stop() {
    this.rules = null;
    if (this.proc) { this.proc.kill(); this.proc = null; }
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

  onList(line) {
    if (!this.rules) return;
    let list;
    try { list = JSON.parse(line); } catch { return; }
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
  async snapshot() {
    const r = await ps(`$ErrorActionPreference='SilentlyContinue'; ConvertTo-Json -InputObject @(Get-Process | ForEach-Object { ,@($_.ProcessName, $_.Id, [int]($_.MainWindowHandle -ne 0), $_.MainWindowTitle) }) -Compress -Depth 3`);
    try { return JSON.parse(r.out); } catch { return []; }
  }
}

module.exports = { AppWatcher };
