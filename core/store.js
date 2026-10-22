// Tiny JSON file store with atomic writes. Notices when another program (e.g. OneDrive syncing
// from a second computer) replaced the file, so the app can reload it.
const fs = require('fs');
const path = require('path');

class Store {
  constructor(file, defaults) {
    this.file = file;
    this.defaults = defaults;
    this.data = defaults;
    this.timer = null;
    this.mtime = 0;
    this.load();
  }

  load() {
    try {
      const raw = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      this.data = { ...this.defaults, ...raw };
      this.mtime = fs.statSync(this.file).mtimeMs;
      return true;
    } catch { return false; } // first run or corrupt file: keep what we have
  }

  save() {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.saveNow(), 300);
  }

  saveNow() {
    clearTimeout(this.timer);
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const tmp = this.file + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(this.data, null, 1));
    fs.renameSync(tmp, this.file);
    try { this.mtime = fs.statSync(this.file).mtimeMs; } catch { }
  }

  // true when the file on disk is newer than what we wrote or read last
  changedOnDisk() {
    try { return fs.statSync(this.file).mtimeMs > this.mtime + 1; } catch { return false; }
  }
}

module.exports = { Store };
