// Where data.json lives (default: the app's userData; can be moved to OneDrive/iCloud to share
// between computers), daily backups, export and import.
const fs = require('fs');
const path = require('path');

const ymd = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const KEEP = 14;

class DataHome {
  constructor(userDir) {
    this.userDir = userDir;
    this.locFile = path.join(userDir, 'location.json');
    this.backupDir = path.join(userDir, 'backups');
  }

  dir() {
    try {
      const d = JSON.parse(fs.readFileSync(this.locFile, 'utf8')).dir;
      if (d && fs.existsSync(d)) return d;
    } catch { }
    return this.userDir;
  }

  file() { return path.join(this.dir(), 'data.json'); }

  setDir(dir) {
    if (!dir || path.resolve(dir) === path.resolve(this.userDir)) { try { fs.unlinkSync(this.locFile); } catch { } return; }
    fs.writeFileSync(this.locFile, JSON.stringify({ dir }));
  }

  // one copy per day, the last KEEP days kept
  backup() {
    const src = this.file();
    if (!fs.existsSync(src)) return null;
    fs.mkdirSync(this.backupDir, { recursive: true });
    const dst = path.join(this.backupDir, `data-${ymd(new Date())}.json`);
    if (!fs.existsSync(dst)) fs.copyFileSync(src, dst);
    const all = this.backups();
    all.slice(KEEP).forEach(b => { try { fs.unlinkSync(path.join(this.backupDir, b.name)); } catch { } });
    return dst;
  }

  // newest first
  backups() {
    try {
      return fs.readdirSync(this.backupDir).filter(f => /^data-.*\.json$/.test(f))
        .map(name => ({ name, size: fs.statSync(path.join(this.backupDir, name)).size }))
        .sort((a, b) => b.name.localeCompare(a.name));
    } catch { return []; }
  }

  readBackup(name) {
    if (!/^data-[\w-]+\.json$/.test(name)) throw new Error('bad name');
    return parse(fs.readFileSync(path.join(this.backupDir, name), 'utf8'));
  }
}

// validates an exported/backup file; throws with a readable message
function parse(text) {
  let d;
  try { d = JSON.parse(text); } catch { throw new Error('Файл не похож на данные Deepwork (не JSON)'); }
  if (!d || typeof d !== 'object' || !d.settings || !Array.isArray(d.tasks) || !Array.isArray(d.sessions)) throw new Error('В файле нет данных Deepwork');
  return d;
}

module.exports = { DataHome, parse };
