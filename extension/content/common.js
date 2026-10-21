// Shared by content scripts: current Deepwork state from extension storage.
(function () {
  if (window.DWX) return;
  const subs = [];
  const DWX = window.DWX = {
    state: null,
    // blocking-level features (feeds) — only during an enforced focus phase
    enforced: s => !!(s && s.active && s.enforce && Date.now() < s.expires),
    // cleanup features (YouTube, clickbait) — during focus, or always if the user wants
    cleaning: s => DWX.enforced(s) || !!(s && s.alwaysClean),
    on(cb) { subs.push(cb); if (DWX.loaded) cb(DWX.state); },
  };
  const fire = () => subs.forEach(cb => { try { cb(DWX.state); } catch (e) { console.warn('[deepwork]', e); } });
  chrome.storage.local.get('dw', r => { DWX.state = r.dw || null; DWX.loaded = true; fire(); });
  chrome.storage.onChanged.addListener(ch => { if (ch.dw) { DWX.state = ch.dw.newValue || null; fire(); } });
  // re-check expiry once a minute, the session may have ended while the app was closed
  setInterval(fire, 60000);
})();
