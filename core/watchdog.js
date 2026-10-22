// Watchdog: a tiny separate process that relaunches Deepwork if it is killed during a guarded session
// (levels with `guard`). Deepwork, in turn, respawns the watchdog if that one gets killed.
//
// Runs as plain Node via ELECTRON_RUN_AS_NODE:
//   <electron> watchdog.js <parentPid> <stateFile> <exe> <argsJson>
const fs = require('fs');
const { spawn } = require('child_process');

const alive = pid => { try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; } };

function runAsWatchdog() {
  const [ppid, stateFile, exe, argsJson] = process.argv.slice(2);
  const iv = setInterval(() => {
    if (alive(+ppid)) return;
    clearInterval(iv);
    let st = null;
    try { st = JSON.parse(fs.readFileSync(stateFile, 'utf8')); } catch { }
    // relaunch only if the session is still on and it was guarded; a normal quit clears both
    if (st && st.session && st.guard) {
      const env = { ...process.env };
      delete env.ELECTRON_RUN_AS_NODE;
      spawn(exe, [...JSON.parse(argsJson), '--hidden', '--revived'], { detached: true, stdio: 'ignore', env }).unref();
    }
    process.exit(0);
  }, 1500);
}

// Used by the main process: keeps one watchdog alive while `wanted()` is true.
class Guard {
  constructor({ stateFile, exe, args, log }) {
    Object.assign(this, { stateFile, exe, args, log });
    this.pid = null;
    this.timer = null;
  }

  ensure() {
    if (this.pid && alive(this.pid)) return;
    const env = { ...process.env, ELECTRON_RUN_AS_NODE: '1' };
    const p = spawn(this.exe, [__filename, String(process.pid), this.stateFile, this.exe, JSON.stringify(this.args)],
      { detached: true, stdio: 'ignore', env, windowsHide: true });
    p.unref();
    this.pid = p.pid;
    this.log('watchdog started', p.pid);
  }

  // on: guarded session running; checks every 5 s and respawns the watchdog if it was killed
  set(on) {
    if (on) {
      this.ensure();
      if (!this.timer) this.timer = setInterval(() => this.ensure(), 5000);
    } else {
      clearInterval(this.timer);
      this.timer = null;
      if (this.pid) { try { process.kill(this.pid); } catch { } this.pid = null; }
    }
  }
}

if (require.main === module) runAsWatchdog();

module.exports = { Guard };
