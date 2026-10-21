// Turns a level config into real effects (DND, hosts, app watcher) and undoes them.
// Everything that must be undone is recorded in `restore` so a crash can be cleaned up on next start.
const sys = require('./sys');
const { OTHER_BROWSERS, APP_SAFE } = require('./defaults');

function siteLists(settings) {
  const cats = settings.lists.siteCats.filter(c => c.on);
  const block = [...new Set(cats.flatMap(c => c.domains).map(d => d.trim().toLowerCase()).filter(Boolean))];
  return { block, allow: settings.lists.siteAllow.map(d => d.trim().toLowerCase()).filter(Boolean) };
}

function appRules(settings, lvl) {
  const block = new Set(settings.lists.appCats.filter(c => c.on).flatMap(c => c.names).map(n => n.toLowerCase()));
  if (lvl.onlyBrave) OTHER_BROWSERS.forEach(n => block.add(n));
  const allow = new Set(settings.lists.appAllow.map(n => n.toLowerCase()));
  allow.forEach(n => block.delete(n));
  return { mode: lvl.apps, block, allow, safe: new Set(APP_SAFE) };
}

class Enforcer {
  constructor({ apps, restore, saveRestore, log, dry }) {
    this.apps = apps;
    this.restore = restore || {};
    this.saveRestore = saveRestore;
    this.log = log;
    this.dry = dry;
    this.status = { dnd: null, hosts: null, apps: null };
    this.busy = Promise.resolve();
  }

  queue(fn) { this.busy = this.busy.then(fn).catch(e => this.log('enforcer error', e)); return this.busy; }

  persist() { this.saveRestore(this.restore); }

  // full = focus phase (or break without unlock); relaxed = break with breakUnlock
  apply(settings, lvl, phase) {
    return this.queue(async () => {
      const relaxed = phase !== 'focus' && lvl.breakUnlock;
      // DND stays for the whole session
      if (lvl.dnd && !this.restore.dnd) {
        if (this.dry) { this.restore.dnd = { dry: true }; this.status.dnd = true; }
        else { this.restore.dnd = await sys.dndOn(); this.status.dnd = this.restore.dnd.ok !== false; }
        this.persist();
      }
      // hosts: set once per session (one UAC), kept through breaks
      if (lvl.hosts && !this.restore.hosts) {
        const { block } = siteLists(settings);
        const ok = this.dry ? (this.log('dry: hosts', block.length, 'domains'), true) : await sys.writeHosts(block);
        this.restore.hosts = ok;
        this.status.hosts = ok;
        this.persist();
      }
      if (lvl.apps !== 'off' || lvl.onlyBrave) {
        if (relaxed) { this.apps.stop(); this.status.apps = 'paused'; }
        else {
          const rules = appRules(settings, lvl);
          if (lvl.apps === 'off') rules.block = new Set(OTHER_BROWSERS);
          this.apps.start(rules);
          this.status.apps = 'on';
        }
      }
    });
  }

  release() {
    return this.queue(async () => {
      this.apps.stop();
      if (this.restore.dnd) {
        if (!this.restore.dnd.dry) await sys.dndOff(this.restore.dnd);
        delete this.restore.dnd;
      }
      if (this.restore.hosts || (!this.dry && sys.hostsHasBlock())) {
        const ok = this.dry ? true : await sys.writeHosts([]);
        if (ok) delete this.restore.hosts;
      }
      this.status = { dnd: null, hosts: null, apps: null };
      this.persist();
    });
  }

  // Apps that would be closed right now — shown before a session starts.
  async preview(settings, lvl) {
    if (lvl.apps === 'off' && !lvl.onlyBrave) return [];
    const rules = appRules(settings, lvl);
    if (lvl.apps === 'off') rules.block = new Set(OTHER_BROWSERS);
    const list = await this.apps.snapshot();
    const seen = new Map();
    for (const v of this.apps.match(list, rules)) if (!seen.has(v.name)) seen.set(v.name, v.title);
    return [...seen].map(([name, title]) => ({ name, title }));
  }
}

module.exports = { Enforcer, siteLists, appRules };
