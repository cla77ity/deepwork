// Clickbait detector: scores headlines/links by caps, trigger phrases, "!!!" and bait emoji,
// then blurs or hides them (on YouTube the whole video card).
(function () {
  const TRIGGERS = [
    // ru
    /шок/, /в шоке/, /не повер(ите|ишь)/, /никто не ожидал/, /обалде/, /офиге/, /жесть/, /сенсаци/, /срочно/, /разоблач/,
    /(вся|страшная|горькая) правда/, /взорвал/, /разн[её]с/, /уничтожил/, /вот что (будет|случится|произошло)/, /вот почему/,
    /это изменит/, /(никогда )?не делайте этого/, /слил[иа]?\b/, /скандал/, /позор/, /кошмар/, /топ[\s-]?\d+/,
    /\d+\s+(причин|способ|секрет|факт|вещ|ошиб|лайфхак)/, /секрет[а-я]*\b/, /раскрыл/, /должны это увидеть/, /до сл[её]з/,
    /потрясающ/, /невероятн/, /безумн/, /этого никто не (знал|знает)/, /что (случилось|было) дальше/, /вы просто/, /ахну/,
    // en
    /you won'?t believe/, /shock(ing|ed)/, /insane/, /gone wrong/, /exposed/, /destroy(ed|s)/, /jaw[- ]dropping/, /mind[- ]?blow/,
    /this is why/, /the truth about/, /\bsecret/, /\btop \d+/, /\d+ (reasons|things|ways|secrets|facts|mistakes)/, /too late/,
    /nobody expected/, /what happen(s|ed) next/, /must see/, /\bcrazy\b/, /unbelievable/, /you need to see/, /\bi quit\b/,
    /(not clickbait)/, /changed my life/, /gone viral/,
  ];
  const BAIT_EMOJI = /[\u{1F631}\u{1F92F}\u{1F633}\u{1F480}\u{1F525}\u{2757}\u{203C}\u{274C}\u{26A0}\u{1F62D}\u{1F92C}\u{1F608}\u{1F4B0}\u{1F440}]/gu;
  const ACRONYMS = new Set(['NASA', 'HTML', 'JSON', 'HTTP', 'HTTPS', 'USSR', 'СССР', 'США', 'NATO', 'НАТО', 'COVID', 'IPHONE', 'OPENAI', 'GPT', 'NVIDIA', 'AMD', 'BTC', 'USDT', 'ETF']);

  function score(text) {
    const t = text.trim();
    if (t.length < 14 || t.length > 220) return 0;
    let s = 0;
    const low = t.toLowerCase();
    for (const re of TRIGGERS) if (re.test(low)) s += 1.5;
    const words = t.match(/[A-Za-zА-Яа-яЁё]{4,}/g) || [];
    const caps = words.filter(w => w === w.toUpperCase() && !ACRONYMS.has(w)).length;
    if (caps >= 2) s += 2; else if (caps === 1) s += 1;
    const letters = t.match(/[A-Za-zА-Яа-яЁё]/g) || [];
    const upper = letters.filter(c => c !== c.toLowerCase()).length;
    if (letters.length > 12 && upper / letters.length > 0.6) s += 2;
    if (/[!?]{2,}/.test(t)) s += 1.5; else if (/!\s*$/.test(t)) s += 0.5;
    const em = (t.match(BAIT_EMOJI) || []).length;
    if (em >= 2) s += 1.5; else if (em === 1) s += 1;
    return s;
  }

  const THRESHOLD = 2.5;
  const YT = /(^|\.)youtube\.com$/.test(location.hostname);
  const SEL = YT
    ? '#video-title, a#video-title-link, h3 a.yt-lockup-metadata-view-model__title, .yt-lockup-metadata-view-model__title, yt-formatted-string.ytd-rich-grid-media'
    : 'h1, h2, h3, h4, a';
  const CARD = 'ytd-rich-item-renderer, ytd-video-renderer, ytd-compact-video-renderer, ytd-grid-video-renderer, yt-lockup-view-model, ytd-playlist-renderer, ytd-reel-item-renderer';

  const style = document.createElement('style');
  style.textContent = `
.dw-cb-blur { filter: blur(6px) grayscale(1) !important; opacity: .45 !important; transition: filter .2s, opacity .2s; }
.dw-cb-hide { display: none !important; }`;
  (document.head || document.documentElement).appendChild(style);

  let mode = 'off';
  let pending = false;

  function targetOf(el) {
    if (YT) return el.closest(CARD) || el;
    return el;
  }

  function scan() {
    pending = false;
    if (mode === 'off') return;
    const els = document.querySelectorAll(SEL);
    let n = 0;
    for (const el of els) {
      if (el.dataset.dwcb) continue;
      if (n++ > 400) { schedule(); break; } // spread big pages over several frames
      const text = el.getAttribute('title') || el.textContent || '';
      if (!YT && el.tagName === 'A' && el.children.length > 3) { el.dataset.dwcb = '0'; continue; }
      const bait = score(text) >= THRESHOLD;
      el.dataset.dwcb = bait ? '1' : '0';
      if (bait) {
        const t = targetOf(el);
        // hiding is safe for whole YouTube cards; on other sites removing elements can break layouts
        const cls = mode === 'hide' && YT ? 'dw-cb-hide' : 'dw-cb-blur';
        t.classList.add('dw-cb', cls);
        t.setAttribute('data-dw-title', 'Deepwork: похоже на кликбейт');
      }
    }
  }

  function schedule() {
    if (pending) return;
    pending = true;
    if (window.requestIdleCallback) requestIdleCallback(scan, { timeout: 600 });
    else setTimeout(scan, 200);
  }

  function reset() {
    document.querySelectorAll('.dw-cb').forEach(t => t.classList.remove('dw-cb', 'dw-cb-blur', 'dw-cb-hide'));
    document.querySelectorAll('[data-dwcb]').forEach(el => delete el.dataset.dwcb);
  }

  // YouTube reuses card elements for new videos, so re-score when a title's text changes
  const mo = new MutationObserver(muts => {
    if (mode === 'off') return;
    for (const m of muts) {
      if (m.type === 'characterData' || m.type === 'attributes') {
        const el = (m.target.nodeType === 3 ? m.target.parentElement : m.target);
        const hit = el && el.closest && el.closest('[data-dwcb]');
        if (hit) { delete hit.dataset.dwcb; const t = targetOf(hit); t.classList.remove('dw-cb', 'dw-cb-blur', 'dw-cb-hide'); }
      }
    }
    schedule();
  });

  DWX.on(s => {
    const next = DWX.cleaning(s) ? (s.clickbait || 'off') : 'off';
    if (next === mode) return;
    mode = next;
    reset();
    if (mode === 'off') mo.disconnect();
    else {
      mo.observe(document.documentElement, YT
        ? { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['title'] }
        : { childList: true, subtree: true });
      schedule();
    }
  });

  window.__dwScore = score; // handy for checking a headline from the console
})();
