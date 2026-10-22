// Syntax check of every script in the app and the extension (no Electron needed).
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const roots = ['main.js', 'preload.js', 'core', 'renderer/js', 'extension', 'tools', 'test'];
const files = [];
const walk = p => fs.statSync(p).isDirectory() ? fs.readdirSync(p).forEach(f => walk(path.join(p, f))) : p.endsWith('.js') && files.push(p);
roots.forEach(r => fs.existsSync(r) && walk(r));
let bad = 0;
for (const f of files) {
  try { execFileSync(process.execPath, ['--check', f], { stdio: 'pipe' }); }
  catch (e) { bad++; console.error('✖', f, '\n', String(e.stderr).split('\n').slice(0, 4).join('\n')); }
}
for (const f of ['extension/manifest.json', 'package.json']) JSON.parse(fs.readFileSync(f, 'utf8'));
console.log(bad ? `${bad} file(s) failed` : `✔ ${files.length} files OK`);
process.exit(bad ? 1 : 0);
