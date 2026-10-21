const { app, BrowserWindow, Tray, Menu, ipcMain, nativeImage, screen, shell } = require('electron');
const path = require('path');
const fs = require('fs');

const { Store } = require('./core/store');
const { Session } = require('./core/session');
const { Enforcer, siteLists } = require('./core/enforcer');
const { AppWatcher } = require('./core/apps');
const { Bridge } = require('./core/bridge');
const D = require('./core/defaults');

// ---- CLI flags: --dry (log instead of acting), --profile=<dir>, --shot=<png> --view=<id> --wait=<s> --js=<file>, --hidden
const arg = name => {
  const a = process.argv.find(x => x === `--${name}` || x.startsWith(`--${name}=`));
  return a == null ? null : (a.includes('=') ? a.slice(a.indexOf('=') + 1) : true);
};
const DRY = !!arg('dry') || !!arg('shot');
const SHOT = arg('shot');
app.setName('Deepwork');
if (arg('profile')) app.setPath('userData', path.resolve(String(arg('profile'))));

if (!SHOT && !app.requestSingleInstanceLock()) { app.quit(); }

const log = (...a) => console.log('[deepwork]', ...a);
const userDir = app.getPath('userData');

const data = new Store(path.join(userDir, 'data.json'), { v: 1, settings: D.defaultSettings(), tasks: [], goals: [], sessions: [] });
const stateStore = new Store(path.join(userDir, 'state.json'), { session: null, restore: {} });
// settings written by an older version may miss new keys
data.data.settings = { ...D.defaultSettings(), ...data.data.settings };
data.data.settings.youtube = { ...D.defaultSettings().youtube, ...data.data.settings.youtube };

const session = new Session();
const apps = new AppWatcher({ dry: DRY, log });
const enforcer = new Enforcer({
  apps, dry: DRY, log,
  restore: stateStore.data.restore,
  saveRestore: r => { stateStore.data.restore = r; stateStore.saveNow(); },
});
let extStatus = { connected: false, incognito: false };
const bridge = new Bridge(extState);

let win = null, tray = null, notice = null, quitting = false;

// ---- helpers ---------------------------------------------------------------
const S = () => data.data.settings;
const lvlOf = s => D.levelConfig(S(), s ? s.level : S().level);

function extState() {
  const s = session.state;
  const settings = S();
  const lvl = lvlOf(s);
  const lists = siteLists(settings);
  const base = {
    yt: settings.youtube, youtube: lvl.youtube, clickbait: lvl.clickbait, feeds: lvl.feeds,
    alwaysClean: settings.alwaysClean,
  };
  if (!s) return { ...base, active: false };
  const relaxed = s.phase !== 'focus' && lvl.breakUnlock;
  return {
    ...base,
    active: true,
    enforce: !relaxed,
    phase: s.phase,
    goal: s.goal,
    level: lvl.n, levelName: lvl.name,
    phaseStart: s.phaseStart, phaseEnd: s.phaseEnd,
    expires: s.status === 'running' && s.phaseEnd ? s.phaseEnd + 60000 : Date.now() + 4 * 3600000,
    sites: { mode: lvl.sites, block: lists.block, allow: lists.allow },
    pushBlock: lvl.pushBlock,
  };
}

function snapshot() {
  return {
    settings: S(), tasks: data.data.tasks, goals: data.data.goals, sessions: data.data.sessions,
    session: session.state, levels: [1, 2, 3, 4].map(n => D.levelConfig(S(), n)),
    defaults: { levels: D.LEVELS, fields: D.LEVEL_FIELDS, exitTypes: D.EXIT_TYPES, phrase: D.EXIT_PHRASE },
    ext: extStatus, enforce: enforcer.status, dry: DRY,
    extPath: path.join(__dirname, 'extension'), userDir,
  };
}

function send(ch, payload) { if (win && !win.isDestroyed()) win.webContents.send(ch, payload); }
function pushData() { send('data', { tasks: data.data.tasks, goals: data.data.goals, sessions: data.data.sessions, settings: S() }); }
function pushSession() { send('session', { session: session.state, enforce: enforcer.status, ext: extStatus }); }

// ---- icons: ring drawn into a BGRA bitmap, progress arc for the tray ----------
function ringIcon(size, frac, active) {
  const buf = Buffer.alloc(size * size * 4);
  const c = size / 2, rO = size * 0.47, rI = size * 0.31;
  const on = active ? [255, 124, 109] : [255, 170, 160]; // BGR of #6d7cff / softer
  const off = [110, 92, 86];
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const dx = x + 0.5 - c, dy = y + 0.5 - c, d = Math.hypot(dx, dy);
    const a = Math.min(1, Math.max(0, rO - d + 0.5)) * Math.min(1, Math.max(0, d - rI + 0.5));
    if (a <= 0) continue;
    const ang = ((Math.atan2(dx, -dy) + 2 * Math.PI) % (2 * Math.PI)) / (2 * Math.PI);
    const col = ang <= frac ? on : off;
    const i = (y * size + x) * 4;
    buf[i] = col[0]; buf[i + 1] = col[1]; buf[i + 2] = col[2]; buf[i + 3] = Math.round(a * 255);
  }
  return nativeImage.createFromBitmap(buf, { width: size, height: size });
}

const fmt = ms => { const t = Math.max(0, Math.round(ms / 1000)); return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`; };
const PHASE = { focus: 'Фокус', short: 'Перерыв', long: 'Длинный перерыв' };

function updateTray() {
  if (!tray) return;
  const s = session.state;
  if (!s) { tray.setImage(ringIcon(32, 1, false)); tray.setToolTip('Deepwork — не в фокусе'); return; }
  const now = s.pausedAt || Date.now();
  if (s.phaseEnd) {
    const total = s.phaseEnd - s.phaseStart;
    tray.setImage(ringIcon(32, Math.max(0, (s.phaseEnd - now) / total), s.phase === 'focus'));
    tray.setToolTip(`Deepwork — ${PHASE[s.phase]} ${fmt(s.phaseEnd - now)}${s.status === 'paused' ? ' (пауза)' : ''}`);
  } else {
    tray.setImage(ringIcon(32, 1, true));
    tray.setToolTip(`Deepwork — Flow ${fmt(now - s.phaseStart)}`);
  }
}

function trayMenu() {
  const s = session.state;
  return Menu.buildFromTemplate([
    { label: 'Открыть Deepwork', click: showWin },
    s ? { label: 'Сессия идёт…', enabled: false } : { label: `Быстрый фокус ${S().timer.focus} мин`, click: () => quickStart() },
    { type: 'separator' },
    { label: 'Выход', click: tryQuit },
  ]);
}

function showWin() {
  if (!win) return createWindow();
  if (win.isMinimized()) win.restore();
  win.show(); win.focus();
}

// ---- notice: small always-on-top card, since Windows toasts are muted during focus
function showNotice(title, body, kind = 'info') {
  if (SHOT) return;
  if (!notice || notice.isDestroyed()) {
    notice = new BrowserWindow({
      width: 380, height: 104, frame: false, transparent: true, resizable: false, skipTaskbar: true,
      alwaysOnTop: true, focusable: false, show: false,
      webPreferences: { preload: path.join(__dirname, 'preload.js') },
    });
    notice.setAlwaysOnTop(true, 'screen-saver');
    notice.loadFile(path.join(__dirname, 'renderer', 'notice.html'));
    notice.webContents.once('did-finish-load', () => showNotice(title, body, kind));
    return;
  }
  const wa = screen.getPrimaryDisplay().workArea;
  notice.setPosition(wa.x + wa.width - 396, wa.y + wa.height - 120);
  notice.webContents.send('notice', { title, body, kind, sound: S().sound });
  notice.showInactive();
  clearTimeout(showNotice.t);
  showNotice.t = setTimeout(() => notice && !notice.isDestroyed() && notice.hide(), 5200);
}

// ---- session wiring ------------------------------------------------------------
let lastPhase = null;
session.on('change', (s, why) => {
  stateStore.data.session = s;
  stateStore.saveNow();
  if (s) {
    if (why === 'start' || why === 'restore' || why === 'phase') enforcer.apply(S(), lvlOf(s), s.phase).then(pushSession);
    if (why === 'phase' && lastPhase && lastPhase !== s.phase) {
      if (s.phase === 'focus') showNotice('Снова фокус', s.goal || `Раунд ${s.round}${s.mode === 'pomodoro' ? ' из ' + s.rounds : ''}`, 'focus');
      else showNotice(PHASE[s.phase], `${Math.round((s.phaseEnd - s.phaseStart) / 60000)} мин — встань, разомнись, попей воды`, 'break');
    }
    lastPhase = s.phase;
  } else {
    lastPhase = null;
    enforcer.release().then(pushSession);
  }
  if (why !== 'attempt') bridge.broadcast();
  updateTray();
  if (tray) tray.setContextMenu(trayMenu());
  pushSession();
});

session.on('finish', rec => {
  data.data.sessions.push(rec);
  if (rec.taskId) {
    const t = data.data.tasks.find(x => x.id === rec.taskId);
    if (t) t.focusMs = (t.focusMs || 0) + rec.focusMs;
  }
  data.saveNow();
  pushData();
  send('finished', rec);
  const min = Math.round(rec.focusMs / 60000);
  showNotice(rec.result === 'done' ? 'Сессия завершена' : 'Сессия прервана', `${min} мин фокуса${rec.goal ? ' · ' + rec.goal : ''}`, rec.result === 'done' ? 'done' : 'warn');
});

apps.on('closed', name => {
  session.attempt('apps', name);
  showNotice('Закрыто: ' + name, 'Ты в фокусе. Вернись к задаче.', 'block');
});

bridge.on('attempt', domain => session.attempt('sites', domain));
bridge.on('status', st => { extStatus = st; pushSession(); });
bridge.on('error', e => log('bridge error', e.message));

function startSession(opts) {
  if (session.state) return { ok: false, error: 'Сессия уже идёт' };
  const t = { ...S().timer, ...opts };
  const level = Number(opts.level || S().level);
  const lvl = D.levelConfig(S(), level);
  session.start({
    mode: t.mode, level, goal: (opts.goal || '').slice(0, 200), taskId: opts.taskId || null,
    focus: +t.focus, short: +t.short, long: +t.long, rounds: +t.rounds, longEvery: +t.longEvery, custom: +t.custom,
    exitWait: lvl.exit.wait, canPause: lvl.pause,
  });
  return { ok: true };
}

function quickStart() { startSession({ mode: 'custom', custom: S().timer.focus }); showWin(); }

function tryQuit() {
  const s = session.state;
  if (s && lvlOf(s).lockSettings) {
    showWin();
    showNotice('Нельзя выйти', 'Сначала заверши сессию в окне Deepwork', 'warn');
    return;
  }
  quitting = true;
  app.quit();
}

// ---- IPC -----------------------------------------------------------------------
const uid = () => Math.random().toString(36).slice(2, 10);

ipcMain.handle('init', () => snapshot());
ipcMain.handle('session:start', (_, o) => startSession(o || {}));
ipcMain.handle('session:preview', (_, level) => enforcer.preview(S(), D.levelConfig(S(), level)));
ipcMain.handle('session:pause', () => session.pause());
ipcMain.handle('session:resume', () => session.resume());
ipcMain.handle('session:skipBreak', () => session.skipBreak());
ipcMain.handle('session:takeBreak', () => session.takeBreak());
ipcMain.handle('session:extend', (_, m) => session.extend(Math.min(30, Math.max(1, +m || 5))));
ipcMain.handle('session:requestStop', () => session.requestStop());
ipcMain.handle('session:cancelStop', () => session.cancelStop());
ipcMain.handle('session:confirmStop', () => session.confirmStop());

ipcMain.handle('settings:set', (_, patch) => {
  const s = session.state;
  const harmless = Object.keys(patch || {}).every(k => k === 'sound' || k === 'timer');
  if (s && lvlOf(s).lockSettings && !harmless) return { ok: false, error: 'Настройки заблокированы до конца сессии' };
  const cur = S();
  for (const k of Object.keys(patch || {})) cur[k] = patch[k];
  if ('launchAtLogin' in patch) setLogin(!!patch.launchAtLogin);
  data.saveNow();
  bridge.broadcast();
  pushData();
  return { ok: true };
});
ipcMain.handle('settings:reset', (_, key) => {
  const s = session.state;
  if (s && lvlOf(s).lockSettings) return { ok: false, error: 'Настройки заблокированы до конца сессии' };
  data.data.settings[key] = D.defaultSettings()[key];
  data.saveNow(); bridge.broadcast(); pushData();
  return { ok: true };
});

function upsert(list, item) {
  if (!item.id) { item.id = uid(); item.createdAt = Date.now(); list.push(item); }
  else { const i = list.findIndex(x => x.id === item.id); if (i >= 0) list[i] = { ...list[i], ...item }; else list.push(item); }
  data.saveNow(); pushData();
  return item;
}
ipcMain.handle('tasks:save', (_, t) => upsert(data.data.tasks, t));
ipcMain.handle('tasks:delete', (_, id) => { data.data.tasks = data.data.tasks.filter(t => t.id !== id); data.saveNow(); pushData(); return true; });
ipcMain.handle('goals:save', (_, g) => upsert(data.data.goals, g));
ipcMain.handle('goals:delete', (_, id) => {
  data.data.goals = data.data.goals.filter(g => g.id !== id);
  data.data.tasks.forEach(t => { if (t.goalId === id) t.goalId = null; });
  data.saveNow(); pushData(); return true;
});
ipcMain.handle('apps:running', async () => {
  const list = await apps.snapshot();
  const seen = new Map();
  for (const [n, , w, t] of list) if (w && !seen.has(n.toLowerCase())) seen.set(n.toLowerCase(), t);
  return [...seen].map(([name, title]) => ({ name, title })).sort((a, b) => a.name.localeCompare(b.name));
});
ipcMain.handle('open:path', (_, p) => shell.openPath(p));
ipcMain.handle('open:url', (_, u) => /^https?:\/\//.test(u) && shell.openExternal(u));
ipcMain.handle('win:min', () => win && win.minimize());
ipcMain.handle('win:close', () => win && win.close());

function setLogin(on) {
  if (DRY) return;
  const args = app.isPackaged ? ['--hidden'] : [path.resolve(__dirname), '--hidden'];
  app.setLoginItemSettings({ openAtLogin: on, path: process.execPath, args });
}

// ---- windows -------------------------------------------------------------------
function createWindow(hidden) {
  win = new BrowserWindow({
    width: 1280, height: 820, minWidth: 980, minHeight: 640,
    frame: false, backgroundColor: '#0a0c11', show: false, title: 'Deepwork',
    icon: ringIcon(256, 1, true),
    webPreferences: { preload: path.join(__dirname, 'preload.js') },
  });
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'), { query: SHOT ? { view: String(arg('view') || 'focus') } : {} });
  win.once('ready-to-show', () => { if (!hidden && !SHOT) win.show(); });
  win.on('close', e => { if (!quitting && !SHOT) { e.preventDefault(); win.hide(); } });
  win.on('closed', () => { win = null; });
  if (SHOT) shotMode();
}

async function shotMode() {
  const wait = Number(arg('wait') || 2) * 1000;
  await new Promise(r => win.webContents.once('did-finish-load', r));
  const js = arg('js');
  if (js) await win.webContents.executeJavaScript(fs.readFileSync(String(js), 'utf8')).catch(e => log('js error', e.message));
  await new Promise(r => setTimeout(r, wait));
  const img = await win.webContents.capturePage();
  fs.writeFileSync(String(SHOT), img.toPNG());
  log('shot saved', SHOT);
  quitting = true;
  app.exit(0);
}

app.on('second-instance', showWin);

app.whenReady().then(() => {
  if (!SHOT) {
    bridge.start();
    tray = new Tray(ringIcon(32, 1, false));
    tray.on('click', showWin);
    tray.setContextMenu(trayMenu());
    setInterval(updateTray, 5000);
  }
  // crash recovery: resume a running session or undo leftovers of the last one
  const saved = stateStore.data.session;
  if (saved) session.restore(saved);
  else if (enforcer.restore.dnd || enforcer.restore.hosts) enforcer.release();
  createWindow(!!arg('hidden'));
  updateTray();
});

app.on('before-quit', e => {
  if (SHOT || app.cleanedUp) return;
  e.preventDefault();
  quitting = true;
  // session state is kept on disk, so a quit mid-session resumes on next launch;
  // the system effects are undone now
  enforcer.release().finally(() => { app.cleanedUp = true; bridge.stop(); app.quit(); });
});

app.on('window-all-closed', () => { /* stay in tray */ });
