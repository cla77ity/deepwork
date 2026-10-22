// Deepwork extension service worker: keeps a WebSocket to the desktop app, turns its state
// into declarativeNetRequest rules, push-notification blocking, and storage for content scripts.
const PORT = 47321;
const BLOCK_PAGE = chrome.runtime.getURL('blocked.html');
const ALLOW_BASE = 1000;

let ws = null;
let connecting = false;

// enforcement is on while the app says so, and never past `expires` (app crashed / closed mid-session)
const effective = s => !!(s && s.active && s.enforce && Date.now() < s.expires);
const hostOf = u => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return ''; } };
const matches = (host, list) => list.some(d => host === d || host.endsWith('.' + d));
const ymd = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

async function connect() {
  if (connecting || (ws && ws.readyState <= 1)) return;
  connecting = true;
  try {
    // probe first: a refused WebSocket spams the extension error list, a caught fetch doesn't
    await fetch(`http://127.0.0.1:${PORT}/`, { cache: 'no-store' });
  } catch {
    connecting = false;
    return setConn(false);
  }
  ws = new WebSocket(`ws://127.0.0.1:${PORT}`);
  ws.onopen = async () => {
    connecting = false;
    const incognito = await chrome.extension.isAllowedIncognitoAccess();
    ws.send(JSON.stringify({ type: 'hello', version: chrome.runtime.getManifest().version, incognito }));
    setConn(true);
  };
  ws.onmessage = e => {
    let m;
    try { m = JSON.parse(e.data); } catch { return; }
    if (m.type === 'state') applyState(m.state);
  };
  ws.onclose = () => { ws = null; connecting = false; setConn(false); };
  ws.onerror = () => { };
}

function setConn(on) { chrome.storage.local.set({ conn: on }); }

function send(msg) { if (ws && ws.readyState === 1) ws.send(JSON.stringify(msg)); }

async function applyState(s) {
  const { dw: prev } = await chrome.storage.local.get('dw');
  await chrome.storage.local.set({ dw: s });
  await checkLimits();
  await updateRules(s);
  await updatePush(s);
  if (effective(s) && !effective(prev)) sweepTabs(s);
  // session over (not just a break): give back the tabs closed at its start
  if (prev && prev.active && !(s && s.active)) restoreTabs();
  chrome.action.setBadgeText({ text: effective(s) ? '●' : '' });
  chrome.action.setBadgeBackgroundColor({ color: s && s.phase === 'focus' ? '#e8ecff' : '#8d9099' });
  if (chrome.action.setBadgeTextColor) chrome.action.setBadgeTextColor({ color: '#07080c' });
}

async function updateRules(s) {
  const old = await chrome.declarativeNetRequest.getDynamicRules();
  const addRules = [];
  // daily limits: domains whose time today is used up — blocked in or out of a session
  const { limitHit = [] } = await chrome.storage.local.get('limitHit');
  if (limitHit.length) addRules.push({
    id: 2, priority: 1,
    action: { type: 'redirect', redirect: { regexSubstitution: `${BLOCK_PAGE}?m=limit#\\0` } },
    condition: { regexFilter: '^https?://.*', requestDomains: limitHit, resourceTypes: ['main_frame'] },
  });
  const mode = s && s.sites && s.sites.mode;
  if (effective(s) && mode && mode !== 'off') {
    const action = { type: 'redirect', redirect: { regexSubstitution: `${BLOCK_PAGE}?m=${mode}#\\0` } };
    const condition = { regexFilter: '^https?://.*', resourceTypes: ['main_frame'] };
    if (mode === 'whitelist') condition.excludedRequestDomains = [...s.sites.allow, 'localhost', '127.0.0.1'];
    else condition.requestDomains = s.sites.block;
    if (mode === 'whitelist' || s.sites.block.length) addRules.push({ id: 1, priority: 1, action, condition });
  }
  await chrome.declarativeNetRequest.updateDynamicRules({ removeRuleIds: old.map(r => r.id), addRules });
  if (!effective(s)) {
    const sess = await chrome.declarativeNetRequest.getSessionRules();
    if (sess.length) await chrome.declarativeNetRequest.updateSessionRules({ removeRuleIds: sess.map(r => r.id) });
  }
}

async function updatePush(s) {
  try {
    if (effective(s) && s.pushBlock) await chrome.contentSettings.notifications.set({ primaryPattern: '<all_urls>', setting: 'block' });
    else await chrome.contentSettings.notifications.clear({});
  } catch { /* contentSettings may be unavailable in some builds */ }
}

// At the start of focus: close distracting tabs (remembered for later) or, with tabs.mode 'off',
// reload them so the block rule catches them.
async function sweepTabs(s) {
  const siteMode = s.sites && s.sites.mode;
  const tabMode = (s.tabs && s.tabs.mode) || 'blocked';
  const keep = [...(s.sites ? s.sites.allow : []), ...(s.keep || []), 'localhost', '127.0.0.1'];
  const blocked = host => siteMode === 'whitelist' ? !matches(host, keep) : siteMode && siteMode !== 'off' && matches(host, s.sites.block);
  const tabs = await chrome.tabs.query({});
  const close = [];
  for (const t of tabs) {
    if (!t.url || !/^https?:/.test(t.url)) continue;
    const host = hostOf(t.url);
    const hit = blocked(host);
    if (tabMode === 'keep' ? (!matches(host, keep) && (!t.pinned || hit)) : tabMode === 'blocked' ? hit : false) close.push(t);
    else if (hit) chrome.tabs.update(t.id, { url: t.url });
  }
  if (!close.length) return;
  // a window must not lose its last tab (that would close the window, maybe the whole browser)
  const left = new Map();
  for (const t of tabs) left.set(t.windowId, (left.get(t.windowId) || 0) + 1);
  for (const t of close) left.set(t.windowId, left.get(t.windowId) - 1);
  for (const [wid, n] of left) if (n <= 0) await chrome.tabs.create({ windowId: wid, url: 'chrome://newtab' });
  const { closedTabs = [] } = await chrome.storage.local.get('closedTabs');
  await chrome.storage.local.set({ closedTabs: [...closedTabs, ...close.map(t => t.url)].slice(-60) });
  await chrome.tabs.remove(close.map(t => t.id));
}

async function restoreTabs() {
  const { closedTabs = [], dw } = await chrome.storage.local.get(['closedTabs', 'dw']);
  await chrome.storage.local.set({ closedTabs: [] });
  const restore = !dw || !dw.tabs || dw.tabs.restore !== false;
  if (restore && closedTabs.length) chrome.windows.create({ url: [...new Set(closedTabs)], focused: false });
}

// ---- time per site + daily limits -------------------------------------------------------------
// The active tab of the focused window is "being looked at" unless the computer is idle.
// Seconds per host are summed per day in storage and reported to the app.
async function lookingAt() {
  try {
    if ((await chrome.idle.queryState(60)) !== 'active') return null;
    const w = await chrome.windows.getLastFocused({ populate: true });
    if (!w || !w.focused) return null;
    const t = (w.tabs || []).find(x => x.active);
    return t && /^https?:/.test(t.url || '') ? hostOf(t.url) : null;
  } catch { return null; }
}

let tracking = Promise.resolve();
function track() {
  tracking = tracking.then(async () => {
    const now = Date.now();
    const { cur } = await chrome.storage.session.get('cur');
    const day = ymd(new Date());
    const st = await chrome.storage.local.get('usage');
    const usage = st.usage && st.usage.date === day ? st.usage : { date: day, domains: {} };
    if (cur && cur.domain) {
      const sec = Math.min(90, (now - cur.since) / 1000); // gaps longer than the tick are not counted
      if (sec > 0) usage.domains[cur.domain] = (usage.domains[cur.domain] || 0) + sec;
    }
    const next = await lookingAt();
    await chrome.storage.session.set({ cur: next ? { domain: next, since: now } : null });
    await chrome.storage.local.set({ usage });
    send({ type: 'usage', date: usage.date, domains: Object.fromEntries(Object.entries(usage.domains).map(([d, v]) => [d, Math.round(v)])) });
    await checkLimits(usage);
  }).catch(() => { });
  return tracking;
}

async function checkLimits(usage) {
  const st = await chrome.storage.local.get(['dw', 'usage', 'limitHit']);
  usage = usage || st.usage;
  const limits = (st.dw && st.dw.limits) || [];
  const day = ymd(new Date());
  const spent = d => usage && usage.date === day ? Object.entries(usage.domains).filter(([h]) => matches(h, [d])).reduce((a, [, v]) => a + v, 0) : 0;
  const hit = limits.filter(l => spent(l.domain) >= l.minutes * 60).map(l => l.domain).sort();
  const before = st.limitHit || [];
  if (hit.join() === before.join()) return;
  await chrome.storage.local.set({ limitHit: hit, limitInfo: Object.fromEntries(limits.map(l => [l.domain, l.minutes])) });
  await updateRules(st.dw);
  // the tab that just ran out gets the limit page right away
  const fresh = hit.filter(d => !before.includes(d));
  if (fresh.length) for (const t of await chrome.tabs.query({})) if (t.url && matches(hostOf(t.url), fresh)) chrome.tabs.update(t.id, { url: t.url });
}

chrome.tabs.onActivated.addListener(() => track());
chrome.tabs.onUpdated.addListener((id, info) => { if (info.url || info.status === 'complete') track(); });
chrome.windows.onFocusChanged.addListener(() => track());
chrome.idle.onStateChanged.addListener(() => track());

// "open anyway" from the blocked page — only in warn mode, for a few minutes
async function allowFor(domain, minutes) {
  const { dw: s } = await chrome.storage.local.get('dw');
  if (!effective(s) || s.sites.mode !== 'warn') return false;
  const rules = await chrome.declarativeNetRequest.getSessionRules();
  const id = ALLOW_BASE + rules.length + 1;
  await chrome.declarativeNetRequest.updateSessionRules({
    addRules: [{ id, priority: 2, action: { type: 'allow' }, condition: { requestDomains: [domain], resourceTypes: ['main_frame'] } }],
  });
  chrome.alarms.create('allow-' + id, { when: Date.now() + minutes * 60000 });
  return true;
}

chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  if (msg.type === 'attempt') send({ type: 'attempt', domain: String(msg.domain || '') });
  if (msg.type === 'allow') { allowFor(msg.domain, msg.minutes || 5).then(reply); return true; }
  if (msg.type === 'connect') connect();
});

chrome.alarms.onAlarm.addListener(async a => {
  if (a.name.startsWith('allow-')) {
    const id = +a.name.slice(6);
    await chrome.declarativeNetRequest.updateSessionRules({ removeRuleIds: [id] });
    return;
  }
  if (a.name === 'tick') {
    connect();
    track();
    const { dw: s } = await chrome.storage.local.get('dw');
    // expired while the app was away: drop enforcement locally
    if (s && s.active && Date.now() >= s.expires) applyState({ ...s, active: false });
  }
});

chrome.alarms.create('tick', { periodInMinutes: 0.5 });
// alarms can't fire more often than every 30 s; browsing activity reconnects sooner
let lastTry = 0;
const nudge = () => { if (Date.now() - lastTry > 3000) { lastTry = Date.now(); connect(); } };
chrome.tabs.onActivated.addListener(nudge);
chrome.tabs.onUpdated.addListener((id, info) => { if (info.status === 'loading') nudge(); });
chrome.runtime.onStartup.addListener(connect);
chrome.runtime.onInstalled.addListener(connect);
connect();
