// Update check. From a git checkout: compare with GitHub (git fetch) and update with git pull + npm install.
// Packaged build: compare the version with the latest GitHub release.
const { execFile } = require('child_process');
const path = require('path');
const fs = require('fs');

const REPO = 'pravorov333-pixel/deepwork';

const run = (cmd, args, cwd) => new Promise(resolve => execFile(cmd, args, { cwd, windowsHide: true, timeout: 180000, shell: process.platform === 'win32' && cmd === 'npm' },
  (err, stdout, stderr) => resolve({ ok: !err, out: String(stdout || '').trim(), err: String(stderr || (err && err.message) || '').trim() })));

const newer = (a, b) => {
  const pa = a.replace(/^v/, '').split('.').map(Number), pb = b.replace(/^v/, '').split('.').map(Number);
  for (let i = 0; i < 3; i++) if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) > (pb[i] || 0);
  return false;
};

async function check({ dir, packaged, version, fetch }) {
  if (!packaged && fs.existsSync(path.join(dir, '.git'))) {
    const f = await run('git', ['fetch', '--quiet', 'origin'], dir);
    if (!f.ok) return { kind: 'git', error: 'Не получилось связаться с GitHub' };
    const behind = await run('git', ['rev-list', '--count', 'HEAD..@{u}'], dir);
    const log = await run('git', ['log', '--format=%s', '-5', 'HEAD..@{u}'], dir);
    const n = parseInt(behind.out, 10) || 0;
    return { kind: 'git', available: n > 0, count: n, notes: n ? log.out.split('\n') : [] };
  }
  try {
    const r = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`, { headers: { accept: 'application/vnd.github+json' } });
    if (r.status === 404) return { kind: 'release', available: false };
    const j = await r.json();
    return { kind: 'release', available: !!j.tag_name && newer(j.tag_name, version), version: j.tag_name, url: j.html_url, notes: (j.body || '').split('\n').slice(0, 5) };
  } catch {
    return { kind: 'release', error: 'Не получилось связаться с GitHub' };
  }
}

// git checkout only: fast-forward and reinstall deps if package files changed
async function applyGit(dir) {
  const before = await run('git', ['rev-parse', 'HEAD'], dir);
  const pull = await run('git', ['pull', '--ff-only'], dir);
  if (!pull.ok) return { ok: false, error: 'git pull не прошёл: ' + pull.err.split('\n')[0] };
  const changed = await run('git', ['diff', '--name-only', before.out, 'HEAD'], dir);
  if (/package(-lock)?\.json/.test(changed.out)) {
    const npm = await run('npm', ['install', '--no-audit', '--no-fund'], dir);
    if (!npm.ok) return { ok: false, error: 'npm install не прошёл' };
  }
  return { ok: true };
}

module.exports = { check, applyGit, newer, REPO };
