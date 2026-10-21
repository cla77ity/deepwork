// macOS layer: Focus via Shortcuts, /etc/hosts via the admin password prompt,
// process list from lsappinfo + ps, Brave via `open`.
const { execFile, spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { hostsFile } = require('./hosts');

function run(cmd, args) {
  return new Promise(resolve => {
    execFile(cmd, args, { timeout: 60000, maxBuffer: 8 * 1024 * 1024 }, (err, stdout, stderr) =>
      resolve({ ok: !err, out: String(stdout || '').trim(), err: String(stderr || (err && err.message) || '').trim() }));
  });
}

// ---- Do Not Disturb -------------------------------------------------------
// macOS has no public switch for Focus. The supported way is two user-made Shortcuts
// ("Set Focus: Do Not Disturb On/Off"), run through the `shortcuts` CLI.
const SHORTCUT_ON = 'Deepwork Focus On';
const SHORTCUT_OFF = 'Deepwork Focus Off';

async function dndOn() {
  const list = await run('shortcuts', ['list']);
  const names = list.out.split('\n').map(s => s.trim());
  if (!names.includes(SHORTCUT_ON) || !names.includes(SHORTCUT_OFF)) return { ok: false, missing: true };
  const r = await run('shortcuts', ['run', SHORTCUT_ON]);
  return { ok: r.ok };
}

async function dndOff(snap) {
  if (snap && snap.ok) await run('shortcuts', ['run', SHORTCUT_OFF]);
}

// ---- hosts ----------------------------------------------------------------
const hosts = hostsFile('/etc/hosts', '\n');
const osaQuote = s => '"' + s.replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"';

// One macOS password prompt; resolves true when the file matches.
async function writeHosts(domains) {
  const want = hosts.build(domains);
  if (want === hosts.read()) return true;
  const tmp = path.join(os.tmpdir(), `deepwork-hosts-${process.pid}.txt`);
  fs.writeFileSync(tmp, want);
  const sh = `cp '${tmp}' /etc/hosts && dscacheutil -flushcache && killall -HUP mDNSResponder`;
  await run('osascript', ['-e', `do shell script ${osaQuote(sh)} with administrator privileges with prompt "Deepwork блокирует сайты во всех браузерах на время фокуса."`]);
  try { fs.unlinkSync(tmp); } catch { }
  return hosts.read() === want;
}

// ---- processes ------------------------------------------------------------
// rows: [name, pid, hasWindow (0/1), title]. App names come from lsappinfo (the name shown in the
// Dock, e.g. "Telegram", "Google Chrome"); "Foreground" apps are the ones with a window/Dock icon.
// ps adds background processes; its names are executable names, cut to 16 characters by macOS.
async function listProcesses() {
  const [psr, ls] = await Promise.all([run('ps', ['-axco', 'pid=,comm=']), run('lsappinfo', ['list'])]);
  const rows = new Map();
  for (const line of psr.out.split('\n')) {
    const m = line.trim().match(/^(\d+)\s+(.+)$/);
    if (m) rows.set(+m[1], [m[2], +m[1], 0, '']);
  }
  const re = /^\s*\d+\)\s+"([^"]+)"[\s\S]*?\bpid\s*=\s*(\d+)\s+type="(\w+)"/gm;
  let m;
  while ((m = re.exec(ls.out))) rows.set(+m[2], [m[1], +m[2], m[3] === 'Foreground' ? 1 : 0, m[1]]);
  return [...rows.values()];
}

function watchProcesses(onList) {
  let stopped = false, busy = false;
  const iv = setInterval(async () => {
    if (busy || stopped) return;
    busy = true;
    try { onList(await listProcesses()); } finally { busy = false; }
  }, 1500);
  return () => { stopped = true; clearInterval(iv); };
}

// ---- apps & browser -------------------------------------------------------
const APP_FILTERS = [{ name: 'Программы', extensions: ['app'] }];

// The blocker matches the app's display name (CFBundleName), e.g. VS Code → "Code".
async function appInfo(p) {
  const file = path.basename(p).replace(/\.app$/i, '');
  const r = await run('defaults', ['read', path.join(p, 'Contents', 'Info'), 'CFBundleName']);
  const proc = r.ok && r.out ? r.out : file;
  return { path: p, name: file, proc: proc.toLowerCase() };
}

function openBrave(urls) {
  if (!fs.existsSync('/Applications/Brave Browser.app') && !fs.existsSync(path.join(os.homedir(), 'Applications', 'Brave Browser.app'))) return false;
  spawn('open', ['-na', 'Brave Browser', '--args', '--new-window', ...urls], { detached: true, stdio: 'ignore' }).unref();
  return true;
}

module.exports = {
  platform: 'mac', run, dndOn, dndOff, writeHosts,
  hostsHasBlock: hosts.hasBlock, buildHosts: hosts.build,
  listProcesses, watchProcesses, APP_FILTERS, appInfo, openBrave,
  SHORTCUT_ON, SHORTCUT_OFF,
};
