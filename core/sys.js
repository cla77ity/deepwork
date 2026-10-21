// Windows helpers: PowerShell/reg runners, Do Not Disturb, elevated hosts edit.
const { execFile } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

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
const HOSTS = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'drivers', 'etc', 'hosts');
const MARK_A = '# >>> deepwork (auto, removed after focus)';
const MARK_B = '# <<< deepwork';

function readHosts() {
  try { return fs.readFileSync(HOSTS, 'utf8'); } catch { return ''; }
}

function stripBlock(text) {
  const re = new RegExp(`\\r?\\n?${MARK_A}[\\s\\S]*?${MARK_B}\\r?\\n?`, 'g');
  return text.replace(re, '\r\n').replace(/(\r?\n){3,}$/, '\r\n');
}

function hostsHasBlock() { return readHosts().includes(MARK_A); }

function buildHosts(domains) {
  let text = stripBlock(readHosts()).replace(/\s+$/, '') + '\r\n';
  if (domains.length) {
    const lines = [];
    for (const d of domains) {
      lines.push(`0.0.0.0 ${d}`);
      if (!d.startsWith('www.') && d.split('.').length === 2) lines.push(`0.0.0.0 www.${d}`);
    }
    text += `\r\n${MARK_A}\r\n${lines.join('\r\n')}\r\n${MARK_B}\r\n`;
  }
  return text;
}

// Writes hosts through one UAC prompt. Resolves true when the file matches.
async function writeHosts(domains) {
  const want = buildHosts(domains);
  if (want === readHosts()) return true;
  const tmp = path.join(os.tmpdir(), `deepwork-hosts-${process.pid}.txt`);
  fs.writeFileSync(tmp, want);
  const inner = `Copy-Item -LiteralPath '${tmp}' -Destination '${HOSTS}' -Force; ipconfig /flushdns | Out-Null`;
  await ps(`try { Start-Process powershell.exe -Verb RunAs -Wait -WindowStyle Hidden -ArgumentList '-NoProfile','-EncodedCommand','${encode(inner)}' } catch { exit 1 }`);
  try { fs.unlinkSync(tmp); } catch { }
  return readHosts() === want;
}

module.exports = { run, ps, encode, dndOn, dndOff, writeHosts, hostsHasBlock, buildHosts };
