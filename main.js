const { app, BrowserWindow, Tray, Menu, ipcMain, nativeImage, screen, shell, dialog } = require('electron');
const path = require('path');
const fs = require('fs');

const { Store } = require('./core/store');
const { Session } = require('./core/session');
const { Enforcer, siteLists } = require('./core/enforcer');
const { AppWatcher } = require('./core/apps');
const { Bridge } = require('./core/bridge');
const D = require('./core/defaults');
const sys = require('./core/sys');
const MAC = process.platform === 'darwin';

// ---- CLI flags: --dry (log instead of acting), --profile=<dir>, --shot=<png> --view=<id> --wait=<s> --js=<file> --extras, --hidden, --port=<n>
const arg = name => {
  const a = process.argv.find(x => x === `--${name}` || x.startsWith(`--${name}=`));
  return a == null ? null : (a.includes('=') ? a.slice(a.indexOf('=') + 1) : true);
};
const DRY = !!arg('dry') || !!arg('shot');
const SHOT = arg('shot');
app.setName('Deepwork');
// Russian locale: 24-hour time inputs, Russian date pickers
app.commandLine.appendSwitch('lang', 'ru');
if (arg('profile')) app.setPath('userData', path.resolve(String(arg('profile'))));

if (!SHOT && !app.requestSingleInstanceLock()) { app.quit(); }

const log = (...a) => console.log('[deepwork]', ...a);
const userDir = app.getPath('userData');

const data = new Store(path.join(userDir, 'data.json'), {
  v: 1, settings: D.defaultSettings(), tasks: [], goals: [], sessions: [], routines: [], routineLog: {}, journal: {},
});
const stateStore = new Store(path.join(userDir, 'state.json'), { session: null, restore: {} });
// data written by an older version may miss new keys
{
  const def = D.defaultSettings();
  const cur = data.data.settings = { ...def, ...data.data.settings };
  for (const k of ['youtube', 'notify', 'widget', 'tabs']) cur[k] = { ...def[k], ...cur[k] };
  for (const k of ['routines', 'routineLog', 'journal']) if (!data.data[k]) data.data[k] = k === 'routines' ? [] : {};
}

const session = new Session();
const apps = new AppWatcher({ dry: DRY, log });
const enforcer = new Enforcer({
  apps, dry: DRY, log,
  restore: stateStore.data.restore,
  saveRestore: r => { stateStore.data.restore = r; stateStore.saveNow(); },
});
let extStatus = { connected: false, incognito: false };
// --port: only for tests next to a running copy (the extension expects the default)
const bridge = new Bridge(extState, Number(arg('port')) || undefined);

let win = null, tray = null, notice = null, widget = null, quitting = false;

// ---- helpers ---------------------------------------------------------------
const S = () => data.data.settings;
const lvlOf = s => D.levelConfig(S(), s ? s.level : S().level);
const presetOf = id => S().presets.find(p => p.id === id) || null;
const hostOf = u => { try { return new URL(normUrl(u)).hostname.replace(/^www\./, ''); } catch { return ''; } };
const normUrl = u => /^[a-z]+:\/\//i.test(u) ? u : 'https://' + u;
// process names the preset launches (known for .exe on Windows and for .app bundles on macOS)
const presetAllow = p => p ? p.apps.map(a => a.proc || (/\.exe$/i.test(a.path || '') ? path.basename(a.path).slice(0, -4).toLowerCase() : null)).filter(Boolean) : [];

function extState() {
  const s = session.state;
  const settings = S();
  const lvl = lvlOf(s);
  const lists = siteLists(settings);
  const base = {
    yt: settings.youtube, youtube: lvl.youtube, clickbait: lvl.clickbait, feeds: lvl.feeds,
    alwaysClean: settings.alwaysClean,
    tabs: settings.tabs,
  };
  if (!s) return { ...base, active: false };
  const relaxed = s.phase !== 'focus' && lvl.breakUnlock;
  const preset = presetOf(s.presetId);
  return {
    ...base,
    active: true,
    sessionId: s.id,
    enforce: !relaxed,
    phase: s.phase,
    goal: s.goal,
    level: lvl.n, levelName: lvl.name,
    phaseStart: s.phaseStart, phaseEnd: s.phaseEnd,
    expires: s.status === 'running' && s.phaseEnd ? s.phaseEnd + 60000 : Date.now() + 4 * 3600000,
    sites: { mode: lvl.sites, block: lists.block, allow: lists.allow },
    keep: preset ? preset.urls.map(hostOf).filter(Boolean) : [],
    pushBlock: lvl.pushBlock,
  };
}

const dataPayload = () => ({
  tasks: data.data.tasks, goals: data.data.goals, sessions: data.data.sessions, settings: S(),
  routines: data.data.routines, routineLog: data.data.routineLog, journal: data.data.journal,
});

function snapshot() {
  return {
    ...dataPayload(),
    session: session.state, levels: [1, 2, 3, 4].map(n => D.levelConfig(S(), n)),
    defaults: { levels: D.LEVELS, fields: D.LEVEL_FIELDS, exitTypes: D.EXIT_TYPES, phrase: D.EXIT_PHRASE },
    ext: extStatus, enforce: enforcer.status, dry: DRY, platform: process.platform,
    shortcuts: MAC ? [sys.SHORTCUT_ON, sys.SHORTCUT_OFF] : null,
    // packaged builds ship the extension next to the app (extraResources), unpacked so Brave can load it
    extPath: app.isPackaged ? path.join(process.resourcesPath, 'extension') : path.join(__dirname, 'extension'), userDir,
  };
}

function send(ch, payload) {
  for (const w of [win, widget]) if (w && !w.isDestroyed()) w.webContents.send(ch, payload);
}
function pushData() { send('data', dataPayload()); }
function pushSession() { send('session', { session: session.state, enforce: enforcer.status, ext: extStatus }); }

// ---- icons: ring drawn into a BGRA bitmap, progress arc for the tray ----------
function ringIcon(size, frac, active) {
  const buf = Buffer.alloc(size * size * 4);
  const c = size / 2, rO = size * 0.47, rI = size * 0.31;
  const on = active ? [255, 236, 232] : [205, 200, 196]; // BGR of #e8ecff / dimmer when idle
  const off = [70, 66, 64];
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

// macOS menu bar wants a template image (black + alpha, recolored by the system)
function trayIcon(frac, active) {
  if (!MAC) return ringIcon(32, frac, active);
  const size = 36, buf = Buffer.alloc(size * size * 4);
  const c = size / 2, rO = size * 0.42, rI = size * 0.28;
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const dx = x + 0.5 - c, dy = y + 0.5 - c, d = Math.hypot(dx, dy);
    const a = Math.min(1, Math.max(0, rO - d + 0.5)) * Math.min(1, Math.max(0, d - rI + 0.5));
    if (a <= 0) continue;
    const ang = ((Math.atan2(dx, -dy) + 2 * Math.PI) % (2 * Math.PI)) / (2 * Math.PI);
    buf[(y * size + x) * 4 + 3] = Math.round(a * (ang <= frac ? 255 : 70));
  }
  const img = nativeImage.createFromBitmap(buf, { width: size, height: size, scaleFactor: 2 });
  img.setTemplateImage(true);
  return img;
}

const fmt = ms => { const t = Math.max(0, Math.round(ms / 1000)); return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`; };
const PHASE = { focus: 'Фокус', short: 'Перерыв', long: 'Длинный перерыв' };

function updateTray() {
  if (!tray) return;
  const s = session.state;
  if (!s) { tray.setImage(trayIcon(1, false)); tray.setToolTip('Deepwork — не в фокусе'); if (MAC) tray.setTitle(''); return; }
  const now = s.pausedAt || Date.now();
  if (s.phaseEnd) {
    const total = s.phaseEnd - s.phaseStart;
    tray.setImage(trayIcon(Math.max(0, (s.phaseEnd - now) / total), s.phase === 'focus'));
    tray.setToolTip(`Deepwork — ${PHASE[s.phase]} ${fmt(s.phaseEnd - now)}${s.status === 'paused' ? ' (пауза)' : ''}`);
    // the menu bar can show text next to the icon: minutes left
    if (MAC) tray.setTitle(' ' + Math.ceil(Math.max(0, s.phaseEnd - now) / 60000) + 'м', { fontType: 'monospacedDigit' });
  } else {
    tray.setImage(trayIcon(1, true));
    tray.setToolTip(`Deepwork — поток ${fmt(now - s.phaseStart)}`);
    if (MAC) tray.setTitle(' ' + Math.floor((now - s.phaseStart) / 60000) + 'м', { fontType: 'monospacedDigit' });
  }
}

function trayMenu() {
  const s = session.state;
  return Menu.buildFromTemplate([
    { label: 'Открыть Deepwork', click: showWin },
    s ? { label: 'Сессия идёт', enabled: false } : { label: `Быстрый фокус на ${S().timer.focus} мин`, click: () => quickStart() },
    { label: 'Таймер на рабочем столе', type: 'checkbox', checked: S().widget.enabled, click: m => setWidget({ enabled: m.checked }) },
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
function showNotice(title, body, kind = 'info', ms = 5200) {
  if (SHOT) return;
  if (!notice || notice.isDestroyed()) {
    notice = new BrowserWindow({
      width: 380, height: 104, frame: false, transparent: true, resizable: false, skipTaskbar: true,
      alwaysOnTop: true, focusable: false, show: false,
      webPreferences: { preload: path.join(__dirname, 'preload.js') },
    });
    notice.setAlwaysOnTop(true, 'screen-saver');
    notice.loadFile(path.join(__dirname, 'renderer', 'notice.html'));
    notice.webContents.once('did-finish-load', () => showNotice(title, body, kind, ms));
    return;
  }
  const wa = screen.getPrimaryDisplay().workArea;
  // where each OS shows its own notifications: top right on macOS, bottom right on Windows
  notice.setPosition(wa.x + wa.width - 396, MAC ? wa.y + 10 : wa.y + wa.height - 120);
  notice.webContents.send('notice', { title, body, kind, sound: S().sound, ms });
  notice.showInactive();
  clearTimeout(showNotice.t);
  showNotice.t = setTimeout(() => notice && !notice.isDestroyed() && notice.hide(), ms + 400);
}

// ---- desktop timer widget ----------------------------------------------------------
function widgetWanted() {
  const w = S().widget;
  return !SHOT && w.enabled && (w.always || !!session.state);
}

function syncWidget() {
  if (!widgetWanted()) { if (widget && !widget.isDestroyed()) widget.hide(); return; }
  if (!widget || widget.isDestroyed()) {
    const w = S().widget;
    const wa = screen.getPrimaryDisplay().workArea;
    widget = new BrowserWindow({
      width: 264, height: 78, frame: false, transparent: true, resizable: false, skipTaskbar: true,
      alwaysOnTop: true, maximizable: false, minimizable: false, show: false, hasShadow: false,
      x: w.x != null ? w.x : wa.x + wa.width - 290, y: w.y != null ? w.y : wa.y + 24,
      webPreferences: { preload: path.join(__dirname, 'preload.js') },
    });
    widget.setAlwaysOnTop(true, 'floating');
    widget.loadFile(path.join(__dirname, 'renderer', 'widget.html'));
    widget.webContents.once('did-finish-load', () => { pushSession(); widget.showInactive(); });
    let t;
    widget.on('moved', () => {
      clearTimeout(t);
      t = setTimeout(() => { const [x, y] = widget.getPosition(); S().widget.x = x; S().widget.y = y; data.save(); }, 400);
    });
    widget.on('closed', () => { widget = null; });
    return;
  }
  if (!widget.isVisible()) widget.showInactive();
}

function setWidget(patch) {
  Object.assign(S().widget, patch);
  data.saveNow();
  syncWidget();
  pushData();
  if (tray) tray.setContextMenu(trayMenu());
}

// ---- work presets: open apps and a browser window with the work tabs ----------------
function launchPreset(p) {
  if (!p) return;
  for (const a of p.apps) {
    if (!a.path) continue;
    if (DRY) { log('dry: open app', a.path); continue; }
    shell.openPath(a.path).then(err => err && log('open app failed', a.path, err));
  }
  const urls = p.urls.map(normUrl);
  if (!urls.length) return;
  if (DRY) return log('dry: open tabs', urls.join(' '));
  if (!sys.openBrave(urls)) urls.forEach(u => shell.openExternal(u));
}

// ---- session wiring ------------------------------------------------------------
let lastPhase = null;
let soonFor = null;
session.on('change', (s, why) => {
  stateStore.data.session = s;
  stateStore.saveNow();
  const n = S().notify;
  if (s) {
    if (why === 'start' || why === 'restore' || why === 'phase') enforcer.apply(S(), lvlOf(s), s.phase, presetAllow(presetOf(s.presetId))).then(pushSession);
    if (why === 'phase' && lastPhase && lastPhase !== s.phase) {
      if (s.phase === 'focus') { if (n.breakEnd) showNotice('Перерыв окончен', s.goal ? `Возвращайся: ${s.goal}` : 'Возвращайся к работе', 'focus'); }
      else if (n.breakStart) showNotice(PHASE[s.phase] + ' · ' + Math.round((s.phaseEnd - s.phaseStart) / 60000) + ' мин', 'Встань, разомнись, посмотри вдаль', 'break', 8000);
    }
    lastPhase = s.phase;
  } else {
    lastPhase = null;
    enforcer.release().then(pushSession);
  }
  if (why !== 'attempt') bridge.broadcast();
  updateTray();
  if (tray) tray.setContextMenu(trayMenu());
  syncWidget();
  pushSession();
});

// a minute before a break ends
setInterval(() => {
  const s = session.state;
  if (!s || s.status !== 'running' || s.phase === 'focus' || !s.phaseEnd || !S().notify.breakSoon) return;
  const left = s.phaseEnd - Date.now();
  if (left <= 60000 && left > 0 && soonFor !== s.phaseStart) {
    soonFor = s.phaseStart;
    showNotice('Через минуту — снова фокус', 'Заканчивай перерыв', 'soon');
  }
}, 1000);

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
  if (S().notify.sessionEnd) showNotice(rec.result === 'done' ? 'Сессия завершена' : 'Сессия прервана', `${min} мин фокуса${rec.goal ? ' · ' + rec.goal : ''}`, rec.result === 'done' ? 'done' : 'warn', 9000);
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
  const preset = presetOf(opts.presetId);
  S().lastPreset = preset ? preset.id : null;
  data.save();
  session.start({
    mode: t.mode, level, goal: (opts.goal || '').slice(0, 200), taskId: opts.taskId || null, presetId: preset && preset.id,
    focus: +t.focus, short: +t.short, long: +t.long, rounds: +t.rounds, longEvery: +t.longEvery, custom: +t.custom,
    exitWait: lvl.exit.wait, canPause: lvl.pause,
  });
  launchPreset(preset);
  return { ok: true };
}

function quickStart() { startSession({ mode: 'custom', custom: S().timer.focus, presetId: S().lastPreset }); showWin(); }

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
const LOCKED = 'Настройки заблокированы до конца сессии';
// settings that can't weaken protection, so they stay editable mid-session
const HARMLESS = new Set(['sound', 'timer', 'notify', 'widget', 'dailyGoalMin', 'goalByDow', 'presets', 'lastPreset']);

ipcMain.handle('init', () => snapshot());
ipcMain.handle('session:start', (_, o) => startSession(o || {}));
ipcMain.handle('session:preview', (_, level, presetId) => enforcer.preview(S(), D.levelConfig(S(), level), presetAllow(presetOf(presetId))));
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
  const harmless = Object.keys(patch || {}).every(k => HARMLESS.has(k));
  if (s && lvlOf(s).lockSettings && !harmless) return { ok: false, error: LOCKED };
  const cur = S();
  for (const k of Object.keys(patch || {})) cur[k] = patch[k];
  if ('launchAtLogin' in patch) setLogin(!!patch.launchAtLogin);
  data.saveNow();
  if ('widget' in patch) syncWidget();
  bridge.broadcast();
  pushData();
  return { ok: true };
});
ipcMain.handle('settings:reset', (_, key) => {
  const s = session.state;
  if (s && lvlOf(s).lockSettings) return { ok: false, error: LOCKED };
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
const removeFrom = (key, id) => { data.data[key] = data.data[key].filter(x => x.id !== id); data.saveNow(); pushData(); return true; };

ipcMain.handle('tasks:save', (_, t) => upsert(data.data.tasks, t));
ipcMain.handle('tasks:delete', (_, id) => removeFrom('tasks', id));
ipcMain.handle('goals:save', (_, g) => upsert(data.data.goals, g));
ipcMain.handle('goals:delete', (_, id) => {
  data.data.tasks.forEach(t => { if (t.goalId === id) t.goalId = null; });
  return removeFrom('goals', id);
});
ipcMain.handle('routines:save', (_, r) => upsert(data.data.routines, r));
ipcMain.handle('routines:delete', (_, id) => removeFrom('routines', id));
ipcMain.handle('routines:toggle', (_, date, id) => {
  const log = data.data.routineLog;
  const day = new Set(log[date] || []);
  day.has(id) ? day.delete(id) : day.add(id);
  log[date] = [...day];
  data.saveNow(); pushData();
  return true;
});
ipcMain.handle('journal:save', (_, date, patch) => {
  data.data.journal[date] = { ...(data.data.journal[date] || {}), ...patch, updatedAt: Date.now() };
  data.saveNow(); pushData();
  return true;
});
ipcMain.handle('journal:note', (_, date, note) => {
  const day = data.data.journal[date] = data.data.journal[date] || {};
  day.notes = [...(day.notes || []), { at: Date.now(), ...note }];
  data.saveNow(); pushData();
  return true;
});

ipcMain.handle('presets:pickApp', async () => {
  const r = await dialog.showOpenDialog(win, {
    title: 'Выбери программу', properties: ['openFile'], defaultPath: MAC ? '/Applications' : undefined,
    filters: sys.APP_FILTERS,
  });
  if (r.canceled || !r.filePaths[0]) return null;
  return sys.appInfo(r.filePaths[0]);
});
ipcMain.handle('presets:launch', (_, id) => { launchPreset(presetOf(id)); return true; });

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
ipcMain.handle('win:show', () => showWin());
ipcMain.handle('widget:hide', () => setWidget({ enabled: false }));

function setLogin(on) {
  if (DRY) return;
  if (MAC) return app.setLoginItemSettings({ openAtLogin: on, openAsHidden: true });
  const args = app.isPackaged ? ['--hidden'] : [path.resolve(__dirname), '--hidden'];
  app.setLoginItemSettings({ openAtLogin: on, path: process.execPath, args });
}

// ---- windows -------------------------------------------------------------------
function createWindow(hidden) {
  win = new BrowserWindow({
    width: 1280, height: 820, minWidth: 980, minHeight: 640,
    // macOS keeps its traffic lights over our own title bar; Windows gets custom buttons
    ...(MAC ? { titleBarStyle: 'hiddenInset', trafficLightPosition: { x: 18, y: 15 } } : { frame: false }),
    backgroundColor: '#050505', show: false, title: 'Deepwork',
    icon: ringIcon(256, 1, true),
    // shot mode renders offscreen: a hidden window stops repainting after the first frame
    webPreferences: { preload: path.join(__dirname, 'preload.js'), offscreen: !!SHOT },
  });
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'), { query: SHOT ? { view: String(arg('view') || 'focus') } : {} });
  win.once('ready-to-show', () => { if (!hidden && !SHOT) win.show(); });
  win.on('close', e => { if (!quitting && !SHOT) { e.preventDefault(); win.hide(); } });
  win.on('closed', () => { win = null; });
  if (SHOT) shotMode();
}

async function shotMode() {
  const wait = Number(arg('wait') || 2) * 1000;
  win.webContents.on('console-message', e => { if (e.level === 'error' || e.level === 'warning') log('renderer', e.level, e.message); });
  await new Promise(r => win.webContents.once('did-finish-load', r));
  const js = arg('js');
  if (js) await win.webContents.executeJavaScript(fs.readFileSync(String(js), 'utf8')).catch(e => log('js error', e.message));
  await new Promise(r => setTimeout(r, wait));
  const img = await win.webContents.capturePage();
  fs.writeFileSync(String(SHOT), img.toPNG());
  log('shot saved', SHOT);
  if (arg('extras')) await shotExtras();
  quitting = true;
  app.exit(0);
}

async function shotExtras() {
  const grab = async (w, suffix) => {
    await new Promise(r => setTimeout(r, 1500));
    fs.writeFileSync(String(SHOT).replace(/\.png$/, suffix), (await w.webContents.capturePage()).toPNG());
  };
  const w = new BrowserWindow({ width: 264, height: 78, frame: false, transparent: true, show: false, webPreferences: { preload: path.join(__dirname, 'preload.js') } });
  widget = w;
  await w.loadFile(path.join(__dirname, 'renderer', 'widget.html'));
  pushSession();
  await grab(w, '_widget.png');
  const n = new BrowserWindow({ width: 380, height: 104, frame: false, transparent: true, show: false, webPreferences: { preload: path.join(__dirname, 'preload.js') } });
  await n.loadFile(path.join(__dirname, 'renderer', 'notice.html'));
  n.webContents.send('notice', { title: 'Перерыв · 5 мин', body: 'Встань, разомнись, посмотри вдаль', kind: 'break', sound: false, ms: 9000 });
  await grab(n, '_notice.png');
}

app.on('second-instance', showWin);
// macOS: clicking the Dock icon brings the window back
app.on('activate', showWin);

app.whenReady().then(() => {
  if (!SHOT) {
    bridge.start();
    tray = new Tray(trayIcon(1, false));
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
  syncWidget();
});

app.on('before-quit', e => {
  if (SHOT || app.cleanedUp) return;
  e.preventDefault();
  // Cmd+Q / Dock "Quit" must not bypass a locked session (the tray route checks it in tryQuit)
  const s = session.state;
  if (!quitting && s && lvlOf(s).lockSettings) {
    showWin();
    showNotice('Нельзя выйти', 'Сначала заверши сессию в окне Deepwork', 'warn');
    return;
  }
  quitting = true;
  // session state is kept on disk, so a quit mid-session resumes on next launch;
  // the system effects are undone now
  enforcer.release().finally(() => { app.cleanedUp = true; bridge.stop(); app.quit(); });
});

app.on('window-all-closed', () => { /* stay in tray */ });
