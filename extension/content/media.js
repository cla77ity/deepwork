// "Watching a video" signal: while a video plays in a visible tab, the user is present even without
// mouse or keyboard — the app uses this to not count that time as idle.
(function () {
  if (window.__dwMedia) return;
  window.__dwMedia = true;
  setInterval(() => {
    if (document.visibilityState !== 'visible') return;
    const playing = [...document.querySelectorAll('video')].some(v => !v.paused && !v.ended && v.readyState > 2 && v.offsetWidth > 160);
    if (playing) { try { chrome.runtime.sendMessage({ type: 'watching' }); } catch { } }
  }, 15000);
})();
