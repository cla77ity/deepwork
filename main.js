const { app, BrowserWindow, Tray, Menu, ipcMain, nativeImage, screen, shell, dialog, powerMonitor, globalShortcut, net } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { execFile } = require('child_process');

const { Store } = require('./core/store');
const { DataHome, parse: parseData } = require('./core/datahome');
const { Session } = require('./core/session');
const { Enforcer, siteLists } = require('./core/enforcer');
const { AppWatcher } = require('./core/apps');
const { Bridge } = require('./core/bridge');
const { Guard } = require('./core/watchdog');
const scheduler = require('./core/scheduler');
const calendar = require('./core/calendar');
const { TelegramBot } = require('./core/telegram');
const { PhoneServer } = require('./core/phone');
const updates = require('./core/updates');
const SUM = require('./core/summary');
const D = require('./core/defaults');
const sys = require('./core/sys');
const MAC = process.platform === 'darwin';

// ---- CLI flags: --dry (log instead of acting), --profile=<dir>, --shot=<png> --view=<id> --wait=<s> --js=<file> --extras,
// --hidden, --port=<n>, --make-shortcut (create desktop/menu shortcuts and exit), --revived (set by the watchdog)
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

const MAKE_SHORTCUT = !!arg('make-shortcut');
if (!SHOT && !MAKE_SHORTCUT && !app.requestSingleInstanceLock()) { app.quit(); }
if (process.platform === 'win32') app.setAppUserModelId('com.deepwork.app');

const log = (...a) => console.log('[deepwork]', ...a);
const userDir = app.getPath('userData');
const uid = () => Math.random().toString(36).slice(2, 10);
const pin = n => String(Math.floor(Math.random() * 10 ** n)).padStart(n, '0');

// ---- data -------------------------------------------------------------------------
// data.json may live in a synced folder (OneDrive/iCloud); state.json is always local to this machine
const home = new DataHome(userDir);
const DATA_DEFAULTS = { v: 1, settings: D.defaultSettings(), tasks: [], goals: [], sessions: [], routines: [], routineLog: {}, journal: {}, usage: {}, achievements: {} };
const data = new Store(home.file(), DATA_DEFAULTS);
const stateStore = new Store(path.join(userDir, 'state.json'), { session: null, restore: {}, guard: false, fired: [], calendar: null, window: null });

// data written by an older version may miss new keys
function migrate() {
  const def = D.defaultSettings();
  const d = data.data;
  const cur = d.settings = { ...def, ...d.settings };
  for (const k of ['youtube', 'notify', 'widget', 'tabs', 'idle', 'ambient', 'rituals', 'telegram', 'phone', 'calendar', 'updates']) cur[k] = { ...def[k], ...cur[k] };
  for (const k of ['routines', 'routineLog', 'journal', 'usage', 'achievements']) if (!d[k]) d[k] = k === 'routines' ? [] : {};
  // people upgrading from a version without onboarding don't need it
  if (!cur.onboarded && (d.sessions.length || d.tasks.length)) cur.onboarded = true;
}
migrate();

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
const guard = new Guard({ stateFile: stateStore.file, exe: process.execPath, args: app.isPackaged ? [] : [__dirname], log });

let win = null, tray = null, notice = null, widget = null, capture = null, soundWin = null, breakWin = null, quitting = false;
const status = { hotkeys: [], telegram: null, phone: null, update: null, calendar: null };

// ---- helpers ---------------------------------------------------------------
const S = () => data.data.settings;
const lvlOf = s => D.levelConfig(S(), s ? s.level : S().level);
const presetOf = id => S().presets.find(p => p.id === id) || null;
const hostOf = u => { try { return new URL(normUrl(u)).hostname.replace(/^www\./, ''); } catch { return ''; } };
const normUrl = u => /^[a-z]+:\/\//i.test(u) ? u : 'https://' + u;
// process names the preset launches (known for .exe on Windows and for .app bundles on macOS)
const presetAllow = p => p ? p.apps.map(a => a.proc || (/\.exe$/i.test(a.path || '') ? path.basename(a.path).slice(0, -4).toLowerCase() : null)).filter(Boolean) : [];
const enforcedNow = s => !!s && s.status === 'running' && (s.phase === 'focus' || !lvlOf(s).breakUnlock);

function extState() {
  const s = session.state;
  const settings = S();
  const lvl = lvlOf(s);
  const lists = siteLists(settings);
  const base = {
    yt: settings.youtube, youtube: lvl.youtube, clickbait: lvl.clickbait, feeds: lvl.feeds,
    alwaysClean: settings.alwaysClean,
    tabs: settings.tabs,
    // daily limits apply all the time, in or out of a session
    limits: settings.limits.filter(l => l.domain && l.minutes > 0),
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
  usage: data.data.usage, achievements: data.data.achievements,
  calendar: stateStore.data.calendar,
});

function snapshot() {
  return {
    ...dataPayload(),
    session: session.state, levels: [1, 2, 3, 4].map(n => D.levelConfig(S(), n)),
    defaults: { levels: D.LEVELS, fields: D.LEVEL_FIELDS, exitTypes: D.EXIT_TYPES, phrase: D.EXIT_PHRASE, safe: D.APP_SAFE, browsers: D.OTHER_BROWSERS },
    ext: extStatus, enforce: enforcer.status, dry: DRY, platform: process.platform,
    shortcuts: MAC ? [sys.SHORTCUT_ON, sys.SHORTCUT_OFF] : null,
    // packaged builds ship the extension next to the app (extraResources), unpacked so Brave can load it
    extPath: app.isPackaged ? path.join(process.resourcesPath, 'extension') : path.join(__dirname, 'extension'), userDir,
    dataDir: home.dir(), status, version: app.getVersion(), packaged: app.isPackaged,
  };
}

function send(ch, payload) {
  for (const w of [win, widget]) if (w && !w.isDestroyed()) w.webContents.send(ch, payload);
}
function pushData() { send('data', dataPayload()); }
function pushSession() { send('session', { session: session.state, enforce: enforcer.status, ext: extStatus }); }
function pushStatus() { send('status', status); }

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
  const templates = S().templates.slice(0, 5);
  return Menu.buildFromTemplate([
    { label: 'Открыть Deepwork', click: showWin },
    s ? { label: 'Сессия идёт', enabled: false } : { label: `Быстрый фокус на ${S().timer.focus} мин`, click: () => quickStart() },
    ...(!s && templates.length ? [{ label: 'Шаблоны', submenu: templates.map(t => ({ label: t.name, click: () => { startTemplate(t); showWin(); } })) }] : []),
    { label: 'Запарковать мысль…', click: () => showCapture() },
    { label: 'Таймер на рабочем столе', type: 'checkbox', checked: S().widget.enabled, click: m => setWidget({ enabled: m.checked }) },
    { type: 'separator' },
    { label: 'Выход', click: tryQuit },
  ]);
}

function showWin() {
  if (!win) return createWindow();
  if (win.isMinimized()) win.restore();
  win.show(); win.focus();
  send('shown', null);
}

function navigate(view) { showWin(); send('navigate', { view }); }

// ---- notice: small always-on-top card, since Windows toasts are muted during focus
function showNotice(title, body, kind = 'info', ms = 5200) {
  if (SHOT || MAKE_SHORTCUT) return;
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

// ---- thought parking: a small input on top of everything ------------------------------
function showCapture() {
  if (SHOT) return;
  if (!capture || capture.isDestroyed()) {
    capture = new BrowserWindow({
      width: 560, height: 92, frame: false, transparent: true, resizable: false, skipTaskbar: true, alwaysOnTop: true, show: false,
      webPreferences: { preload: path.join(__dirname, 'preload.js') },
    });
    capture.setAlwaysOnTop(true, 'screen-saver');
    capture.loadFile(path.join(__dirname, 'renderer', 'capture.html'));
    capture.on('blur', () => capture && !capture.isDestroyed() && capture.hide());
    capture.webContents.once('did-finish-load', () => showCapture());
    return;
  }
  const wa = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea;
  capture.setPosition(Math.round(wa.x + (wa.width - 560) / 2), Math.round(wa.y + wa.height * 0.22));
  capture.webContents.send('capture', { goal: session.state ? session.state.goal : '' });
  capture.show(); capture.focus();
}

function park(text, source = 'app') {
  const t = String(text || '').trim().slice(0, 300);
  if (!t) return null;
  const s = session.state;
  const task = { id: uid(), createdAt: Date.now(), title: t, date: null, done: false, prio: 2, est: 0, time: '', goalId: null,
    notes: s && s.goal ? `Запарковано во время фокуса: ${s.goal}` : '', parked: true, source };
  data.data.tasks.push(task);
  data.saveNow();
  pushData();
  if (s) session.park();
  return task;
}

// ---- ambient sound: a hidden window with Web Audio generators --------------------------
function syncAmbient(preview) {
  const a = S().ambient;
  const s = session.state;
  const playing = !!preview || (a.kind !== 'off' && !!s && s.status === 'running' && (s.phase === 'focus' || a.breaks));
  if (!playing && !soundWin) return;
  if (!soundWin || soundWin.isDestroyed()) {
    soundWin = new BrowserWindow({ show: false, webPreferences: { preload: path.join(__dirname, 'preload.js'), backgroundThrottling: false } });
    soundWin.loadFile(path.join(__dirname, 'renderer', 'sound.html'));
    soundWin.webContents.once('did-finish-load', () => syncAmbient(preview));
    soundWin.on('closed', () => { soundWin = null; });
    return;
  }
  soundWin.webContents.send('ambient', preview ? { ...preview, playing: true, preview: true } : { kind: a.kind, volume: a.volume, playing });
}

// ---- full-screen break -----------------------------------------------------------------
function syncBreakScreen() {
  const s = session.state;
  const want = !SHOT && S().breakScreen !== 'off' && !!s && s.phase !== 'focus' && s.status === 'running';
  if (!want) { if (breakWin && !breakWin.isDestroyed()) breakWin.close(); breakWin = null; return; }
  if (breakWin && !breakWin.isDestroyed()) { breakWin.webContents.send('break', { session: s, mode: S().breakScreen }); return; }
  const d = screen.getPrimaryDisplay().bounds;
  breakWin = new BrowserWindow({
    x: d.x, y: d.y, width: d.width, height: d.height, frame: false, skipTaskbar: true, alwaysOnTop: true, fullscreen: true,
    backgroundColor: '#050505', show: false, webPreferences: { preload: path.join(__dirname, 'preload.js') },
  });
  breakWin.setAlwaysOnTop(true, 'screen-saver');
  breakWin.loadFile(path.join(__dirname, 'renderer', 'break.html'));
  breakWin.webContents.once('did-finish-load', () => { breakWin.webContents.send('break', { session: s, mode: S().breakScreen }); breakWin.show(); });
  breakWin.on('closed', () => { breakWin = null; });
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
let stopForeground = null;

function syncGuard(s) {
  const on = !DRY && !!s && lvlOf(s).guard;
  if (stateStore.data.guard !== on) { stateStore.data.guard = on; stateStore.saveNow(); }
  guard.set(on);
}

// which app is in front, while focusing (for "focus quality")
function syncForeground(s) {
  const want = !SHOT && !!s && s.phase === 'focus' && s.status === 'running';
  if (want && !stopForeground) stopForeground = sys.watchForeground(name => session.track('apps', name || 'другое', 3), 3000);
  if (!want && stopForeground) { stopForeground(); stopForeground = null; }
}

session.on('change', (s, why) => {
  stateStore.data.session = s;
  stateStore.saveNow();
  const n = S().notify;
  if (s) {
    if (why === 'start' || why === 'restore' || why === 'phase') enforcer.apply(S(), lvlOf(s), s.phase, presetAllow(presetOf(s.presetId))).then(pushSession);
    if (why === 'phase' && lastPhase && lastPhase !== s.phase) {
      flushIdle(s.phaseStart);
      if (s.phase === 'focus') { if (n.breakEnd) showNotice('Перерыв окончен', s.goal ? `Возвращайся: ${s.goal}` : 'Возвращайся к работе', 'focus'); }
      else if (n.breakStart) showNotice(PHASE[s.phase] + ' · ' + Math.round((s.phaseEnd - s.phaseStart) / 60000) + ' мин', 'Встань, разомнись, посмотри вдаль', 'break', 8000);
    }
    lastPhase = s.phase;
  } else {
    lastPhase = null;
    enforcer.release().then(pushSession);
  }
  if (why === 'idle' || why === 'park' || why === 'attempt') return pushSession();
  bridge.broadcast();
  updateTray();
  if (tray) tray.setContextMenu(trayMenu());
  syncWidget();
  syncGuard(s);
  syncForeground(s);
  syncAmbient();
  syncBreakScreen();
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
  flushIdle(rec.end);
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
  if (S().telegram.notify) bot.send(`${rec.result === 'done' ? '✓ Сессия завершена' : '× Сессия прервана'}: ${SUM.dur(min)}${rec.goal ? ' · ' + rec.goal : ''}`);
});

apps.on('closed', name => {
  session.attempt('apps', name);
  showNotice('Закрыто: ' + name, 'Ты в фокусе. Вернись к задаче.', 'block');
});

bridge.on('attempt', domain => session.attempt('sites', domain));
let extEverConnected = false, extLostAt = null;
bridge.on('status', st => {
  extStatus = st;
  if (st.connected) { extEverConnected = true; extLostAt = null; }
  pushSession();
});
bridge.on('error', e => log('bridge error', e.message));

// browser time per domain, reported by the extension as cumulative seconds for the day
let lastUsage = { date: null, domains: {} };
bridge.on('usage', u => {
  const day = data.data.usage[u.date] = data.data.usage[u.date] || {};
  const prev = lastUsage.date === u.date ? lastUsage.domains : {};
  for (const [d, sec] of Object.entries(u.domains)) {
    const v = Math.max(0, Math.round(+sec || 0));
    if (lastUsage.date === u.date) session.track('sites', d, Math.max(0, v - (prev[d] || 0)));
    day[d] = Math.max(day[d] || 0, v);
  }
  lastUsage = { date: u.date, domains: { ...u.domains } };
  data.save();
});

// ---- idle: time away from the computer doesn't count as focus ---------------------------
let idleSince = null;
function flushIdle(until = Date.now()) {
  if (!idleSince) return;
  session.addIdle(Math.max(0, until - idleSince));
  idleSince = null;
}
setInterval(() => {
  const s = session.state;
  const cfg = S().idle;
  if (!s || s.phase !== 'focus' || s.status !== 'running' || !cfg.enabled || SHOT) { if (!s) idleSince = null; return; }
  const idleSec = powerMonitor.getSystemIdleTime();
  if (!idleSince && idleSec >= cfg.minutes * 60) {
    idleSince = Date.now() - idleSec * 1000;
    showNotice('Ты отошёл?', 'Пока тебя нет, время фокуса не идёт', 'soon', 7000);
  } else if (idleSince && idleSec < 5) {
    const away = Math.round((Date.now() - idleSince) / 60000);
    flushIdle();
    showNotice('С возвращением', `${away} мин простоя не засчитаны в фокус`, 'focus');
  }
}, 5000);

// ---- guard: Brave without the extension during a guarded session gets closed ----------------
setInterval(async () => {
  const s = session.state;
  if (DRY || !s || !enforcedNow(s) || !lvlOf(s).guard || !extEverConnected || extStatus.connected) { if (extStatus.connected) extLostAt = null; return; }
  if (!extLostAt) { extLostAt = Date.now(); return; }
  if (Date.now() - extLostAt < 20000) return;
  extLostAt = Date.now();
  const list = await sys.listProcesses();
  const brave = list.filter(([n]) => /^brave( browser)?$/i.test(n));
  brave.forEach(([, pid]) => { try { process.kill(pid); } catch { } });
  if (brave.length) showNotice('Brave закрыт', 'Расширение Deepwork выключено. Включи его, чтобы пользоваться Brave в фокусе.', 'block', 9000);
}, 5000);

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
  if (S().telegram.notify) bot.send(`▶ Фокус начат${opts.goal ? ': ' + opts.goal : ''} · ${lvl.name}`);
  return { ok: true };
}

// template: { name, mode, minutes (custom/flow) | focus/short/long/rounds (pomodoro), level, presetId, goal }
function startTemplate(tp, extra = {}) {
  return startSession({
    mode: tp.mode || 'custom', custom: tp.minutes || S().timer.custom, focus: tp.focus || S().timer.focus,
    short: tp.short || S().timer.short, long: tp.long || S().timer.long, rounds: tp.rounds || S().timer.rounds,
    level: tp.level, presetId: tp.presetId, goal: extra.goal || tp.goal || tp.name, ...extra,
  });
}

function quickStart() {
  const tp = S().templates[0];
  if (tp) startTemplate(tp); else startSession({ mode: 'custom', custom: S().timer.focus, presetId: S().lastPreset });
  showWin();
}

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

// ---- schedule & rituals ------------------------------------------------------------
setInterval(() => {
  if (SHOT || MAKE_SHORTCUT) return;
  const now = new Date();
  const today = scheduler.ymd(now);
  const fired = new Set((stateStore.data.fired || []).filter(k => k.includes(today)));
  for (const ev of scheduler.due(S().schedule, now, fired)) {
    fired.add(ev.key);
    const it = ev.item;
    if (ev.type === 'warn') {
      showNotice('Через 2 минуты — фокус', `${it.name || 'Запланированная сессия'} · ${it.minutes} мин`, 'soon', 9000);
    } else if (session.state) {
      showNotice('Запланированный фокус пропущен', 'Уже идёт другая сессия', 'info');
    } else if (it.auto || it.contract) {
      startTemplate({ mode: 'custom', minutes: it.minutes, level: it.level, presetId: it.presetId, name: it.name });
      showWin();
    } else {
      showWin();
      send('schedule:prompt', it);
    }
  }
  stateStore.data.fired = [...fired];
  stateStore.save();

  const r = S().rituals;
  if (r.evening && scheduler.dailyDue(r.eveningTime, now, r.lastEvening)) {
    r.lastEvening = today;
    data.save();
    showNotice('Время подвести итог дня', 'Журнал уже собрал цифры — допиши пару строк', 'info', 9000);
    if (!session.state) navigate('journal');
    if (S().telegram.daily) bot.send(tgToday());
  }
}, 20000);

// ---- calendar (ICS) ---------------------------------------------------------------------
async function refreshCalendar() {
  const url = (S().calendar.ics || '').trim().replace(/^webcal:\/\//i, 'https://');
  if (!url) { if (stateStore.data.calendar) { stateStore.data.calendar = null; stateStore.save(); pushData(); } return; }
  try {
    const r = await net.fetch(url);
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const events = calendar.expand(calendar.parseEvents(await r.text()), new Date(Date.now() - 14 * 86400000), new Date(Date.now() + 90 * 86400000));
    stateStore.data.calendar = { fetchedAt: Date.now(), events };
    status.calendar = { ok: true, count: events.length, at: Date.now() };
  } catch (e) {
    status.calendar = { ok: false, error: e.message };
  }
  stateStore.save();
  pushData(); pushStatus();
}
setInterval(refreshCalendar, 30 * 60000);

// ---- Telegram ------------------------------------------------------------------------------
function tgToday() {
  const d = data.data;
  const today = SUM.ymd(Date.now());
  const by = SUM.focusByDay(d.sessions);
  // finished sessions + the running one
  const focus = (by[today] || 0) + (session.state ? session.focusSoFar() / 60000 : 0);
  const goal = SUM.goalFor(S(), today);
  const tasks = d.tasks.filter(t => t.date === today);
  const rs = SUM.routinesFor(d.routines, today);
  const rDone = rs.filter(r => (d.routineLog[today] || []).includes(r.id)).length;
  return [
    `Сегодня: ${SUM.dur(focus)}${goal ? ' из ' + SUM.dur(goal) : ' (выходной)'}${goal && focus >= goal ? ' ✓' : ''}`,
    `Серия: ${SUM.streak(S(), d.sessions, today)} дн.`,
    `Задачи: ${tasks.filter(t => t.done).length} из ${tasks.length}`,
    rs.length ? `Рутина: ${rDone} из ${rs.length}` : null,
  ].filter(Boolean).join('\n');
}

const bot = new TelegramBot({
  fetch: (u, o) => net.fetch(u, o), log,
  config: () => S().telegram,
  savePair: chatId => { S().telegram.chatId = chatId; data.saveNow(); pushData(); status.telegram = { ...bot.status, paired: true }; pushStatus(); },
  handlers: {
    status() {
      const s = session.state;
      if (!s) return 'Не в фокусе. /focus 50 — начать.';
      const left = s.phaseEnd ? fmt(s.phaseEnd - (s.pausedAt || Date.now())) : fmt(Date.now() - s.phaseStart);
      return `${PHASE[s.phase]}${s.status === 'paused' ? ' (пауза)' : ''} · ${left}${s.phaseEnd ? ' осталось' : ''}\n${s.goal || 'без цели'} · ${lvlOf(s).name}`;
    },
    today: () => tgToday(),
    plan() {
      const today = SUM.ymd(Date.now());
      const tasks = data.data.tasks.filter(t => t.date === today);
      const rs = SUM.routinesFor(data.data.routines, today);
      const log2 = data.data.routineLog[today] || [];
      const lines = [...tasks.map(t => `${t.done ? '✓' : '○'} ${t.time ? t.time + ' ' : ''}${t.title}`), ...rs.map(r => `${log2.includes(r.id) ? '✓' : '○'} ↻ ${r.title}`)];
      return lines.length ? lines.join('\n') : 'На сегодня ничего не запланировано';
    },
    focus(min) {
      const r = min ? startSession({ mode: 'custom', custom: Math.min(480, Math.max(5, min)), presetId: S().lastPreset }) : (S().templates[0] ? startTemplate(S().templates[0]) : startSession({ mode: 'custom', custom: S().timer.focus }));
      return r.ok ? '▶ Фокус начат' : r.error;
    },
    park(text) { return park(text, 'telegram') ? 'Запарковано в бэклог' : 'Пусто'; },
    add(text) {
      const t = { id: uid(), createdAt: Date.now(), title: text.slice(0, 300), date: SUM.ymd(Date.now()), done: false, prio: 2, est: 0, time: '', goalId: null, notes: '' };
      data.data.tasks.push(t); data.saveNow(); pushData();
      return 'Добавлено на сегодня';
    },
  },
});

async function syncTelegram() {
  const c = S().telegram;
  if (c.enabled && !c.pairCode) { c.pairCode = pin(6); data.saveNow(); pushData(); }
  if (!c.enabled || !c.token) { bot.stop(); status.telegram = null; return pushStatus(); }
  await bot.restart();
  status.telegram = { ...bot.status, paired: !!c.chatId };
  pushStatus();
}

// ---- phone companion -------------------------------------------------------------------
let phone = null;
function phoneState() {
  const d = data.data;
  const today = SUM.ymd(Date.now());
  const by = SUM.focusByDay(d.sessions);
  const s = session.state;
  return {
    now: Date.now(), session: s && { ...s, usage: undefined, attempts: undefined, focusSoFar: session.focusSoFar(), levelName: lvlOf(s).name },
    today, focus: (by[today] || 0) + (s ? session.focusSoFar() / 60000 : 0), goal: SUM.goalFor(S(), today), streak: SUM.streak(S(), d.sessions, today),
    tasks: d.tasks.filter(t => t.date === today).map(t => ({ id: t.id, title: t.title, done: t.done, time: t.time })),
    routines: SUM.routinesFor(d.routines, today).map(r => ({ id: r.id, title: r.title, time: r.time, done: (d.routineLog[today] || []).includes(r.id) })),
    journal: d.journal[today] || {}, templates: S().templates.map(t => ({ id: t.id, name: t.name })),
  };
}
function phoneAct(name, b) {
  const d = data.data;
  const today = SUM.ymd(Date.now());
  switch (name) {
    case 'start': {
      const tp = S().templates.find(t => t.id === b.templateId);
      const r = tp ? startTemplate(tp) : startSession({ mode: 'custom', custom: Math.min(480, Math.max(5, +b.minutes || S().timer.focus)), presetId: S().lastPreset });
      if (!r.ok) throw new Error(r.error);
      return true;
    }
    case 'pause': return session.pause();
    case 'resume': return session.resume();
    case 'skipBreak': return session.skipBreak();
    case 'task': { const t = d.tasks.find(x => x.id === b.id); if (!t) throw new Error('Нет такой задачи'); t.done = !t.done; t.doneAt = t.done ? Date.now() : null; break; }
    case 'routine': { const set = new Set(d.routineLog[today] || []); set.has(b.id) ? set.delete(b.id) : set.add(b.id); d.routineLog[today] = [...set]; break; }
    case 'park': if (!park(b.text, 'phone')) throw new Error('Пусто'); return true;
    case 'add': d.tasks.push({ id: uid(), createdAt: Date.now(), title: String(b.title || '').slice(0, 300), date: today, done: false, prio: 2, est: 0, time: '', goalId: null, notes: '' }); break;
    case 'journal': {
      const allowed = ['mood', 'energy', 'wins', 'blockers', 'tomorrow', 'text'];
      const patch = Object.fromEntries(Object.entries(b.patch || {}).filter(([k]) => allowed.includes(k)));
      d.journal[today] = { ...(d.journal[today] || {}), ...patch, updatedAt: Date.now() };
      break;
    }
    default: throw new Error('Неизвестное действие');
  }
  data.saveNow(); pushData();
  return true;
}
function syncPhone() {
  const c = S().phone;
  if (c.enabled && !c.pin) { c.pin = pin(4); data.saveNow(); pushData(); }
  if (phone && (!c.enabled || phone.port !== c.port || phone.pin !== c.pin)) { phone.stop(); phone = null; }
  if (c.enabled && !phone && !SHOT) {
    phone = new PhoneServer({ port: c.port, pin: c.pin, root: path.join(__dirname, 'renderer'), getState: phoneState, act: phoneAct, log });
    phone.start();
  }
  setTimeout(() => { status.phone = phone ? { urls: phone.urls(), pin: c.pin, error: phone.error } : null; pushStatus(); }, 400);
}

// ---- updates ---------------------------------------------------------------------------
async function checkUpdates() {
  status.update = { checking: true };
  pushStatus();
  status.update = await updates.check({ dir: __dirname, packaged: app.isPackaged, version: app.getVersion(), fetch: (u, o) => net.fetch(u, o) });
  status.update.at = Date.now();
  pushStatus();
  return status.update;
}

// ---- hotkeys ---------------------------------------------------------------------------
const HOTKEYS = [
  ['Control+Alt+Space', 'Запарковать мысль', () => showCapture()],
  ['Control+Alt+F', 'Начать фокус (первый шаблон)', () => { if (!session.state) quickStart(); else showWin(); }],
  ['Control+Alt+P', 'Пауза / продолжить', () => { const s = session.state; if (!s) return; if (s.status === 'paused') session.resume(); else if (!session.pause()) showNotice('Пауза недоступна', 'На этом уровне пауз нет', 'warn'); }],
  ['Control+Alt+=', '+5 минут к фокусу', () => { if (session.extend(5)) showNotice('+5 минут', 'Фокус продлён', 'focus'); }],
  ['Control+Alt+D', 'Показать / скрыть Deepwork', () => { if (win && win.isVisible() && win.isFocused()) win.hide(); else showWin(); }],
];
function syncHotkeys() {
  globalShortcut.unregisterAll();
  if (SHOT || MAKE_SHORTCUT || !S().hotkeys) { status.hotkeys = []; return pushStatus(); }
  status.hotkeys = HOTKEYS.map(([accel, label, fn]) => {
    let ok = false;
    try { ok = globalShortcut.register(accel, fn); } catch { }
    return { accel: MAC ? accel.replace('Control', '⌃').replace('Alt', '⌥').replace(/\+/g, '') : accel.replace('Control', 'Ctrl'), label, ok };
  });
  pushStatus();
}

// ---- IPC -----------------------------------------------------------------------
const LOCKED = 'Настройки заблокированы до конца сессии';
// settings that can't weaken protection, so they stay editable mid-session
const HARMLESS = new Set(['sound', 'timer', 'notify', 'widget', 'dailyGoalMin', 'goalByDow', 'presets', 'lastPreset', 'ambient', 'templates',
  'rituals', 'idle', 'hotkeys', 'telegram', 'phone', 'calendar', 'updates', 'lang', 'onboarded', 'schedule', 'breakScreen']);

ipcMain.handle('init', () => snapshot());
ipcMain.handle('session:start', (_, o) => startSession(o || {}));
ipcMain.handle('session:template', (_, id, extra) => { const tp = S().templates.find(t => t.id === id); return tp ? startTemplate(tp, extra || {}) : { ok: false, error: 'Нет шаблона' }; });
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
  const keys = Object.keys(patch || {});
  const harmless = keys.every(k => HARMLESS.has(k));
  // limits may be tightened mid-session, never loosened
  const limitsOk = keys.length === 1 && keys[0] === 'limits' && (patch.limits || []).length >= S().limits.length;
  if (s && lvlOf(s).lockSettings && !harmless && !limitsOk) return { ok: false, error: LOCKED };
  const cur = S();
  for (const k of keys) cur[k] = patch[k];
  if ('launchAtLogin' in patch) setLogin(!!patch.launchAtLogin);
  data.saveNow();
  if ('widget' in patch) syncWidget();
  if ('ambient' in patch || 'breakScreen' in patch) { syncAmbient(); syncBreakScreen(); }
  if ('hotkeys' in patch) syncHotkeys();
  if ('telegram' in patch) syncTelegram();
  if ('phone' in patch) syncPhone();
  if ('calendar' in patch) refreshCalendar();
  if ('templates' in patch && tray) tray.setContextMenu(trayMenu());
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
  const log2 = data.data.routineLog;
  const day = new Set(log2[date] || []);
  day.has(id) ? day.delete(id) : day.add(id);
  log2[date] = [...day];
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
ipcMain.handle('achievements:unlock', (_, list) => {
  const fresh = (list || []).filter(a => a && a.id && !data.data.achievements[a.id]);
  fresh.forEach(a => { data.data.achievements[a.id] = Date.now(); });
  if (fresh.length) {
    data.saveNow(); pushData();
    // the first run after an update unlocks many at once — don't flood
    if (fresh.length <= 2) fresh.forEach(a => showNotice('Достижение: ' + a.title, a.desc || '', 'done', 7000));
  }
  return fresh.length;
});

ipcMain.handle('park:add', (_, text) => !!park(text));
ipcMain.handle('capture:show', () => showCapture());
ipcMain.handle('capture:hide', () => capture && !capture.isDestroyed() && capture.hide());
ipcMain.handle('ambient:preview', (_, kind, volume) => { syncAmbient({ kind, volume }); setTimeout(() => syncAmbient(), 6000); return true; });
ipcMain.handle('break:close', () => { if (breakWin && !breakWin.isDestroyed()) breakWin.close(); return true; });
ipcMain.handle('win:zen', (_, on) => { if (win) win.setFullScreen(!!on); return true; });

ipcMain.handle('presets:pickApp', async () => {
  const r = await dialog.showOpenDialog(win, {
    title: 'Выбери программу', properties: ['openFile'], defaultPath: MAC ? '/Applications' : undefined,
    filters: sys.APP_FILTERS,
  });
  if (r.canceled || !r.filePaths[0]) return null;
  return sys.appInfo(r.filePaths[0]);
});
ipcMain.handle('presets:launch', (_, id) => { launchPreset(presetOf(id)); return true; });

// data: export / import / backups / folder
ipcMain.handle('data:export', async () => {
  const r = await dialog.showSaveDialog(win, { title: 'Экспорт данных', defaultPath: path.join(app.getPath('documents'), `deepwork-${SUM.ymd(Date.now())}.json`), filters: [{ name: 'JSON', extensions: ['json'] }] });
  if (r.canceled || !r.filePath) return null;
  fs.writeFileSync(r.filePath, JSON.stringify(data.data, null, 1));
  return r.filePath;
});
function replaceData(d) {
  home.backup();
  data.data = { ...DATA_DEFAULTS, ...d };
  migrate();
  data.saveNow();
  pushData(); bridge.broadcast();
}
ipcMain.handle('data:import', async () => {
  if (session.state) return { ok: false, error: 'Сначала заверши сессию' };
  const r = await dialog.showOpenDialog(win, { title: 'Импорт данных', properties: ['openFile'], filters: [{ name: 'JSON', extensions: ['json'] }] });
  if (r.canceled || !r.filePaths[0]) return null;
  try { replaceData(parseData(fs.readFileSync(r.filePaths[0], 'utf8'))); return { ok: true }; }
  catch (e) { return { ok: false, error: e.message }; }
});
ipcMain.handle('data:backups', () => home.backups());
ipcMain.handle('data:restore', (_, name) => {
  if (session.state) return { ok: false, error: 'Сначала заверши сессию' };
  try { replaceData(home.readBackup(name)); return { ok: true }; } catch (e) { return { ok: false, error: e.message }; }
});
// move data.json to another folder (e.g. OneDrive) — or start using the data already there
ipcMain.handle('data:pickDir', async () => {
  const r = await dialog.showOpenDialog(win, { title: 'Папка для данных Deepwork', properties: ['openDirectory', 'createDirectory'] });
  if (r.canceled || !r.filePaths[0]) return null;
  const dir = r.filePaths[0];
  return { dir, hasData: fs.existsSync(path.join(dir, 'data.json')) };
});
ipcMain.handle('data:setDir', (_, dir, mode) => {
  if (session.state) return { ok: false, error: 'Сначала заверши сессию' };
  const target = dir ? path.join(dir, 'data.json') : path.join(userDir, 'data.json');
  if (mode === 'move' || !fs.existsSync(target)) { fs.mkdirSync(path.dirname(target), { recursive: true }); fs.writeFileSync(target, JSON.stringify(data.data, null, 1)); }
  else { try { parseData(fs.readFileSync(target, 'utf8')); } catch (e) { return { ok: false, error: e.message }; } }
  home.setDir(dir);
  quitting = true;
  app.relaunch();
  app.quit();
  return { ok: true };
});

ipcMain.handle('telegram:status', () => status.telegram);
ipcMain.handle('telegram:test', () => bot.send('Deepwork на связи ✓').then(() => true));
ipcMain.handle('telegram:unpair', () => { S().telegram.chatId = null; S().telegram.pairCode = pin(6); data.saveNow(); pushData(); syncTelegram(); return true; });
ipcMain.handle('phone:refresh', () => { S().phone.pin = pin(4); data.saveNow(); syncPhone(); pushData(); return true; });
ipcMain.handle('calendar:refresh', () => refreshCalendar());
ipcMain.handle('update:check', () => checkUpdates());
ipcMain.handle('update:apply', async () => {
  if (session.state) return { ok: false, error: 'Сначала заверши сессию' };
  if (app.isPackaged) { if (status.update && status.update.url) shell.openExternal(status.update.url); return { ok: true, opened: true }; }
  const r = await updates.applyGit(__dirname);
  if (r.ok) { quitting = true; app.relaunch(); app.quit(); }
  return r;
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
ipcMain.handle('win:show', () => showWin());
ipcMain.handle('widget:hide', () => setWidget({ enabled: false }));
ipcMain.handle('shortcut:create', () => makeShortcuts());

// ---- launch shortcuts ------------------------------------------------------------
// Windows: Desktop + Start menu .lnk to Electron with this folder (or to the packaged exe).
// macOS: a tiny ~/Applications/Deepwork.app made with osacompile, so it shows in Launchpad and Spotlight.
async function makeShortcuts() {
  const dir = __dirname;
  if (process.platform === 'win32') {
    const opts = {
      target: process.execPath, args: app.isPackaged ? '' : `"${dir}"`, cwd: dir,
      // packaged: build/ is inside app.asar, which Explorer can't read — use the exe's own icon
      icon: app.isPackaged ? process.execPath : path.join(dir, 'build', 'icon.ico'), iconIndex: 0,
      description: 'Deepwork — режим полного фокуса', appUserModelId: 'com.deepwork.app',
    };
    const places = [
      path.join(app.getPath('desktop'), 'Deepwork.lnk'),
      path.join(app.getPath('appData'), 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Deepwork.lnk'),
    ];
    return places.filter(p => shell.writeShortcutLink(p, 'create', opts));
  }
  if (process.platform === 'darwin') {
    const target = path.join(os.homedir(), 'Applications', 'Deepwork.app');
    fs.mkdirSync(path.dirname(target), { recursive: true });
    const q = s => '"' + s.replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"';
    const cmd = app.isPackaged ? `open -a ${q(process.execPath)}` : `cd ${q(dir)} && nohup ./node_modules/.bin/electron . > /dev/null 2>&1 &`;
    const run = (c, a) => new Promise(res => execFile(c, a, err => res(!err)));
    if (!await run('osacompile', ['-o', target, '-e', `do shell script ${q(cmd)}`])) return [];
    // our ring as the bundle icon (sips converts the PNG to .icns)
    await run('sips', ['-s', 'format', 'icns', path.join(dir, 'build', 'icon.png'), '--out', path.join(target, 'Contents', 'Resources', 'applet.icns')]);
    await run('touch', [target]);
    return [target];
  }
  return [];
}

function setLogin(on) {
  if (DRY) return;
  if (MAC) return app.setLoginItemSettings({ openAtLogin: on, openAsHidden: true });
  const args = app.isPackaged ? ['--hidden'] : [path.resolve(__dirname), '--hidden'];
  app.setLoginItemSettings({ openAtLogin: on, path: process.execPath, args });
}

// ---- windows -------------------------------------------------------------------
// last size/position, if it still fits on a connected display
function savedBounds() {
  const b = stateStore.data.window;
  if (!b || SHOT) return null;
  const visible = screen.getAllDisplays().some(d => b.x >= d.workArea.x - 50 && b.y >= d.workArea.y - 50 && b.x + 200 <= d.workArea.x + d.workArea.width && b.y + 100 <= d.workArea.y + d.workArea.height);
  return visible ? b : null;
}

function createWindow(hidden) {
  const b = savedBounds();
  win = new BrowserWindow({
    width: b ? b.width : 1280, height: b ? b.height : 820, x: b ? b.x : undefined, y: b ? b.y : undefined, minWidth: 980, minHeight: 640,
    // macOS keeps its traffic lights over our own title bar; Windows gets custom buttons
    ...(MAC ? { titleBarStyle: 'hiddenInset', trafficLightPosition: { x: 18, y: 15 } } : { frame: false }),
    backgroundColor: '#050505', show: false, title: 'Deepwork',
    icon: ringIcon(256, 1, true),
    // shot mode renders offscreen: a hidden window stops repainting after the first frame
    webPreferences: { preload: path.join(__dirname, 'preload.js'), offscreen: !!SHOT },
  });
  if (b && b.maximized) win.maximize();
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'), { query: SHOT ? { view: String(arg('view') || 'focus') } : {} });
  win.once('ready-to-show', () => { if (!hidden && !SHOT) { win.show(); send('shown', null); } });
  let t;
  const remember = () => {
    clearTimeout(t);
    t = setTimeout(() => {
      if (!win || win.isDestroyed() || win.isFullScreen()) return;
      stateStore.data.window = { ...win.getNormalBounds(), maximized: win.isMaximized() };
      stateStore.save();
    }, 500);
  };
  win.on('resize', remember);
  win.on('move', remember);
  win.on('close', e => { if (!quitting && !SHOT) { e.preventDefault(); win.hide(); } });
  win.on('closed', () => { win = null; });
  win.on('leave-full-screen', () => send('zen', false));
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

// dev: --extras also renders the small windows offscreen
async function shotExtras() {
  const page = async (file, w, h, suffix, msg) => {
    const bw = new BrowserWindow({ width: w, height: h, frame: false, transparent: file !== 'break.html', show: false, webPreferences: { preload: path.join(__dirname, 'preload.js'), offscreen: true } });
    await bw.loadFile(path.join(__dirname, 'renderer', file));
    if (msg) bw.webContents.send(msg[0], msg[1]);
    if (file === 'widget.html') { widget = bw; pushSession(); }
    await new Promise(r => setTimeout(r, 1500));
    fs.writeFileSync(String(SHOT).replace(/\.png$/, suffix), (await bw.webContents.capturePage()).toPNG());
  };
  await page('widget.html', 264, 78, '_widget.png');
  await page('notice.html', 380, 104, '_notice.png', ['notice', { title: 'Перерыв · 5 мин', body: 'Встань, разомнись, посмотри вдаль', kind: 'break', sound: false, ms: 9000 }]);
  await page('capture.html', 560, 92, '_capture.png', ['capture', { goal: 'Расширение для Brave' }]);
  const s = session.state || { phase: 'short', phaseStart: Date.now() - 60000, phaseEnd: Date.now() + 240000, status: 'running', goal: 'Расширение для Brave' };
  await page('break.html', 1280, 800, '_break.png', ['break', { session: { ...s, phase: 'short', phaseStart: Date.now() - 60000, phaseEnd: Date.now() + 240000 }, mode: 'soft' }]);
}

app.on('second-instance', showWin);
// macOS: clicking the Dock icon brings the window back
app.on('activate', showWin);

app.whenReady().then(async () => {
  if (MAKE_SHORTCUT) {
    const made = await makeShortcuts();
    console.log(made.length ? 'Ярлыки созданы:\n' + made.join('\n') : 'Не удалось создать ярлык');
    return app.exit(made.length ? 0 : 1);
  }
  if (!SHOT) {
    bridge.start();
    tray = new Tray(trayIcon(1, false));
    tray.on('click', showWin);
    tray.setContextMenu(trayMenu());
    setInterval(updateTray, 5000);
    try { home.backup(); } catch (e) { log('backup failed', e.message); }
    // data.json changed by another device through a synced folder → reload
    setInterval(() => {
      if (!data.changedOnDisk()) return;
      if (data.load()) { migrate(); pushData(); bridge.broadcast(); log('data reloaded from disk'); }
    }, 4000);
  }
  // crash recovery: resume a running session or undo leftovers of the last one
  const saved = stateStore.data.session;
  if (saved) session.restore(saved);
  else if (enforcer.restore.dnd || enforcer.restore.hosts) enforcer.release();
  createWindow(!!arg('hidden'));
  updateTray();
  syncWidget();
  if (arg('revived') && session.state) showNotice('Deepwork перезапущен', 'Сессия продолжается — закрыть её можно только из приложения', 'warn', 9000);
  if (!SHOT) {
    syncHotkeys();
    syncTelegram();
    syncPhone();
    refreshCalendar();
    if (S().updates.check) { setTimeout(checkUpdates, 30000); setInterval(() => S().updates.check && checkUpdates(), 6 * 3600000); }
  }
});

app.on('before-quit', e => {
  if (SHOT || MAKE_SHORTCUT || app.cleanedUp) return;
  e.preventDefault();
  // Cmd+Q / Dock "Quit" must not bypass a locked session (the tray route checks it in tryQuit)
  const s = session.state;
  if (!quitting && s && lvlOf(s).lockSettings) {
    showWin();
    showNotice('Нельзя выйти', 'Сначала заверши сессию в окне Deepwork', 'warn');
    return;
  }
  quitting = true;
  // a deliberate quit: the watchdog must not bring us back
  guard.set(false);
  stateStore.data.guard = false;
  stateStore.saveNow();
  globalShortcut.unregisterAll();
  bot.stop();
  if (phone) phone.stop();
  // session state is kept on disk, so a quit mid-session resumes on next launch;
  // the system effects are undone now
  enforcer.release().finally(() => { app.cleanedUp = true; bridge.stop(); app.quit(); });
});

app.on('window-all-closed', () => { /* stay in tray */ });
