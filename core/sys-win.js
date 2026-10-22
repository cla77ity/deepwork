// Windows layer: PowerShell/reg runners, Do Not Disturb, elevated hosts edit, process list, Brave.
const { execFile, spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { hostsFile } = require('./hosts');

function run(cmd, args, input) {
  return new Promise(resolve => {
    const p = execFile(cmd, args, { windowsHide: true, timeout: 60000 }, (err, stdout, stderr) =>
      resolve({ ok: !err, out: String(stdout || '').trim(), err: String(stderr || (err && err.message) || '').trim() }));
    if (input != null) { p.stdin.write(input); p.stdin.end(); }
  });
}

// -EncodedCommand: multi-line scripts (here-strings, loops) silently fail when piped via stdin
const encode = script => Buffer.from(script, 'utf16le').toString('base64');
function ps(script) {
  return run('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encode(script)]);
}

// ---- Do Not Disturb -------------------------------------------------------
// Two layers: the quiet-hours WNF state (live toggle of Windows "Do not disturb",
// 2 = alarms only) and the persistent registry switches for toast banners.
const WNF = `
Add-Type -TypeDefinition @"
using System; using System.Runtime.InteropServices;
public static class DwWnf {
  [DllImport("ntdll.dll")] public static extern int NtQueryWnfStateData(ref ulong s, IntPtr t, IntPtr e, out int cs, byte[] b, ref int n);
  [DllImport("ntdll.dll")] public static extern int NtUpdateWnfStateData(ref ulong s, byte[] b, int n, IntPtr t, IntPtr e, int m, int c);
}
"@
$s = [uint64]"0x0D83063EA3BF1C75"
function Get-Q { $b = New-Object byte[] 4; $n = 4; $cs = 0; $r = [DwWnf]::NtQueryWnfStateData([ref]$s, [IntPtr]::Zero, [IntPtr]::Zero, [ref]$cs, $b, [ref]$n); if ($r -ne 0) { return -1 }; return [BitConverter]::ToInt32($b, 0) }
function Set-Q($v) { $b = [BitConverter]::GetBytes([int]$v); return [DwWnf]::NtUpdateWnfStateData([ref]$s, $b, 4, [IntPtr]::Zero, [IntPtr]::Zero, 0, 0) }
`;

const REG_KEYS = [
  ['HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\PushNotifications', 'ToastEnabled'],
  ['HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Notifications\\Settings', 'NOC_GLOBAL_SETTING_TOASTS_ENABLED'],
];

async function regGet(key, name) {
  const r = await run('reg.exe', ['query', key, '/v', name]);
  const m = r.ok && r.out.match(/REG_DWORD\s+0x([0-9a-f]+)/i);
  return m ? parseInt(m[1], 16) : null;
}
const regSet = (key, name, v) => run('reg.exe', ['add', key, '/v', name, '/t', 'REG_DWORD', '/d', String(v), '/f']);
const regDel = (key, name) => run('reg.exe', ['delete', key, '/v', name, '/f']);

// Returns a snapshot to pass to dndOff later.
async function dndOn() {
  const snap = { reg: [], quiet: -1 };
  for (const [k, n] of REG_KEYS) {
    snap.reg.push(await regGet(k, n));
    await regSet(k, n, 0);
  }
  const r = await ps(WNF + '$o = Get-Q; $st = Set-Q 2; "$o|$st|$(Get-Q)"');
  const [old, , now] = r.out.split('|').map(Number);
  snap.quiet = Number.isFinite(old) ? old : -1;
  snap.ok = now === 2;
  return snap;
}

async function dndOff(snap) {
  if (!snap) return;
  for (let i = 0; i < REG_KEYS.length; i++) {
    const [k, n] = REG_KEYS[i];
    const v = snap.reg && snap.reg[i];
    if (v == null) await regDel(k, n); else await regSet(k, n, v);
  }
  const back = snap.quiet >= 0 ? snap.quiet : 0;
  await ps(WNF + `Set-Q ${back} | Out-Null`);
}

// ---- hosts ----------------------------------------------------------------
const hosts = hostsFile(path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'drivers', 'etc', 'hosts'), '\r\n');

// Writes hosts through one UAC prompt. Resolves true when the file matches.
async function writeHosts(domains) {
  const want = hosts.build(domains);
  if (want === hosts.read()) return true;
  const tmp = path.join(os.tmpdir(), `deepwork-hosts-${process.pid}.txt`);
  fs.writeFileSync(tmp, want);
  const inner = `Copy-Item -LiteralPath '${tmp}' -Destination '${hosts.file}' -Force; ipconfig /flushdns | Out-Null`;
  await ps(`try { Start-Process powershell.exe -Verb RunAs -Wait -WindowStyle Hidden -ArgumentList '-NoProfile','-EncodedCommand','${encode(inner)}' } catch { exit 1 }`);
  try { fs.unlinkSync(tmp); } catch { }
  return hosts.read() === want;
}

// ---- processes ------------------------------------------------------------
// rows: [name, pid, hasWindow (0/1), windowTitle]
const LIST = `ConvertTo-Json -InputObject @(Get-Process | ForEach-Object { ,@($_.ProcessName, $_.Id, [int]($_.MainWindowHandle -ne 0), $_.MainWindowTitle) }) -Compress -Depth 3`;

async function listProcesses() {
  const r = await ps(`$ErrorActionPreference='SilentlyContinue'; ${LIST}`);
  try { return JSON.parse(r.out); } catch { return []; }
}

// One long-lived PowerShell prints the list every 1.5 s — much cheaper than spawning each time.
function watchProcesses(onList) {
  const loop = `$ErrorActionPreference = 'SilentlyContinue'
while ($true) {
  [Console]::Out.WriteLine((${LIST}))
  [Console]::Out.Flush()
  Start-Sleep -Milliseconds 1500
}`;
  let proc = null, stopped = false;
  const start = () => {
    proc = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', encode(loop)], { windowsHide: true });
    let buf = '';
    proc.stdout.on('data', d => {
      buf += d;
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i).trim();
        buf = buf.slice(i + 1);
        if (!line) continue;
        try { onList(JSON.parse(line)); } catch { }
      }
    });
    proc.on('exit', () => { if (!stopped) setTimeout(() => !stopped && start(), 2000); });
  };
  start();
  return () => { stopped = true; if (proc) proc.kill(); };
}

// Name of the app in the foreground, every `everyMs` (for "focus quality").
function watchForeground(onName, everyMs = 3000) {
  const loop = `$ErrorActionPreference = 'SilentlyContinue'
Add-Type -TypeDefinition @"
using System; using System.Runtime.InteropServices;
public static class DwFg {
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
}
"@
while ($true) {
  $p = 0; [void][DwFg]::GetWindowThreadProcessId([DwFg]::GetForegroundWindow(), [ref]$p)
  $n = ''; if ($p) { $n = (Get-Process -Id $p).ProcessName }
  [Console]::Out.WriteLine($n); [Console]::Out.Flush()
  Start-Sleep -Milliseconds ${everyMs}
}`;
  let proc = null, stopped = false;
  const start = () => {
    proc = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', encode(loop)], { windowsHide: true });
    let buf = '';
    proc.stdout.on('data', d => {
      buf += d;
      let i;
      while ((i = buf.indexOf('\n')) >= 0) { const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1); onName(line.toLowerCase()); }
    });
    proc.on('exit', () => { if (!stopped) setTimeout(() => !stopped && start(), 3000); });
  };
  start();
  return () => { stopped = true; if (proc) proc.kill(); };
}

// ---- apps & browser -------------------------------------------------------
const APP_FILTERS = [{ name: 'Программы и ярлыки', extensions: ['exe', 'lnk', 'bat', 'cmd', 'url'] }, { name: 'Все файлы', extensions: ['*'] }];

// name shown in the preset + process name the blocker must spare
async function appInfo(p) {
  const base = path.basename(p);
  const name = base.replace(/\.(exe|lnk|bat|cmd|url)$/i, '');
  return { path: p, name, proc: /\.exe$/i.test(base) ? name.toLowerCase() : null };
}

function findBrave() {
  const roots = [process.env.ProgramFiles, process.env['ProgramFiles(x86)'], process.env.LOCALAPPDATA].filter(Boolean);
  for (const r of roots) {
    const p = path.join(r, 'BraveSoftware', 'Brave-Browser', 'Application', 'brave.exe');
    if (fs.existsSync(p)) return p;
  }
  return null;
}

// Opens the URLs in a new Brave window; false when Brave isn't installed.
function openBrave(urls) {
  const brave = findBrave();
  if (!brave) return false;
  spawn(brave, ['--new-window', ...urls], { detached: true, stdio: 'ignore' }).unref();
  return true;
}

module.exports = {
  platform: 'win', run, ps, encode, dndOn, dndOff, writeHosts,
  hostsHasBlock: hosts.hasBlock, buildHosts: hosts.build,
  listProcesses, watchProcesses, watchForeground, APP_FILTERS, appInfo, openBrave,
};
