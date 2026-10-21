// YouTube cleanup: Shorts, home feed, related videos, end screens, comments, autoplay, bell.
// Toggles classes on <html>; one stylesheet holds all the rules.
(function () {
  const root = document.documentElement;
  const S = 'html.dw-shorts', H = 'html.dw-home', R = 'html.dw-sidebar', E = 'html.dw-endscreen', C = 'html.dw-comments', N = 'html.dw-notif';
  const css = `
${S} ytd-reel-shelf-renderer, ${S} ytd-rich-shelf-renderer[is-shorts], ${S} ytd-rich-section-renderer:has([is-shorts]),
${S} ytd-rich-section-renderer:has(ytm-shorts-lockup-view-model), ${S} grid-shelf-view-model, ${S} ytm-shorts-lockup-view-model,
${S} ytd-guide-entry-renderer:has(a[href^="/shorts"]), ${S} ytd-mini-guide-entry-renderer:has(a[href^="/shorts"]),
${S} ytd-video-renderer:has(a[href^="/shorts/"]), ${S} ytd-rich-item-renderer:has(a[href^="/shorts/"]),
${S} ytd-grid-video-renderer:has(a[href^="/shorts/"]), ${S} yt-tab-shape[tab-title="Shorts"], ${S} ytd-pivot-bar-item-renderer:has([title="Shorts"])
  { display: none !important; }
${H} ytd-browse[page-subtype="home"] ytd-rich-grid-renderer, ${H} ytd-browse[page-subtype="home"] #header,
${H} ytd-browse[page-subtype="home"] ytd-feed-filter-chip-bar-renderer,
${H} ytd-search ytd-shelf-renderer, ${H} ytd-search ytd-horizontal-card-list-renderer, ${H} ytd-search ytd-reel-shelf-renderer
  { display: none !important; }
${H} ytd-browse[page-subtype="home"] #primary::before {
  content: "Deepwork: рекомендации скрыты. Найди то, за чем пришёл — поиск сверху.";
  display: block; margin: 18vh auto 0; max-width: 520px; text-align: center; font: 500 18px/1.5 Roboto, Arial, sans-serif; color: #8b91a3;
}
${R} #secondary #related, ${R} ytd-watch-next-secondary-results-renderer, ${R} #related.ytd-watch-flexy { display: none !important; }
${E} .ytp-ce-element, ${E} .ytp-endscreen-content, ${E} .videowall-endscreen, ${E} .ytp-fullscreen-grid,
${E} .ytp-fullscreen-grid-stills-container, ${E} .ytp-suggestion-set, ${E} .ytp-pause-overlay { display: none !important; }
${C} ytd-comments#comments, ${C} #comments.ytd-watch-flexy { display: none !important; }
${N} ytd-notification-topbar-button-renderer { display: none !important; }
`;
  const style = document.createElement('style');
  style.id = 'deepwork-yt';
  style.textContent = css;
  (document.head || root).appendChild(style);

  const FLAGS = ['shorts', 'home', 'sidebar', 'endscreen', 'comments', 'notif'];
  let cfg = null;

  DWX.on(s => {
    const on = DWX.cleaning(s) && s.youtube;
    cfg = on ? (s.yt || {}) : null;
    for (const f of FLAGS) root.classList.toggle('dw-' + f, !!(cfg && cfg[f]));
    check();
  });

  // /shorts/ID -> normal player (no endless swipe)
  function check() {
    if (!cfg) return;
    if (cfg.shorts) {
      const m = location.pathname.match(/^\/shorts\/([\w-]{6,})/);
      if (m) location.replace('/watch?v=' + m[1]);
    }
    if (cfg.autoplay) {
      const cancel = document.querySelector('.ytp-autonav-endscreen-upnext-cancel-button');
      if (cancel && cancel.offsetParent) cancel.click();
    }
  }
  document.addEventListener('yt-navigate-finish', check);
  setInterval(check, 1000);
})();
