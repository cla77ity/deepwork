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
  await updateRules(s);
  await updatePush(s);
  if (effective(s) && !effective(prev)) sweepTabs(s);
  chrome.action.setBadgeText({ text: effective(s) ? '●' : '' });
  chrome.action.setBadgeBackgroundColor({ color: s && s.phase === 'focus' ? '#6d7cff' : '#38c9c0' });
}

async function updateRules(s) {
  const old = await chrome.declarativeNetRequest.getDynamicRules();
  const addRules = [];
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

// already-open tabs on blocked sites get reloaded so the rule catches them
async function sweepTabs(s) {
  const mode = s.sites && s.sites.mode;
  if (!mode || mode === 'off') return;
  const tabs = await chrome.tabs.query({});
  for (const t of tabs) {
    if (!t.url || !/^https?:/.test(t.url)) continue;
    const host = hostOf(t.url);
    const hit = mode === 'whitelist' ? !matches(host, [...s.sites.allow, 'localhost', '127.0.0.1']) : matches(host, s.sites.block);
    if (hit) chrome.tabs.update(t.id, { url: t.url });
  }
}

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
    const { dw: s } = await chrome.storage.local.get('dw');
    // expired while the app was away: drop enforcement locally
    if (s && s.active && Date.now() >= s.expires) applyState({ ...s, active: false });
  }
});

chrome.alarms.create('tick', { periodInMinutes: 0.5 });
chrome.runtime.onStartup.addListener(connect);
chrome.runtime.onInstalled.addListener(connect);
connect();
