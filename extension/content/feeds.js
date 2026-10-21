// Hides endless feeds on social sites during focus. Messages and direct links stay usable.
(function () {
  const host = location.hostname.replace(/^www\.|^m\./, '');
  const SITES = {
    'vk.com': { feed: /^\/(feed|clips|discover|video)?\/?$/, inbox: '/im' },
    'instagram.com': { feed: /^\/(explore|reels)?\/?$/, inbox: '/direct/inbox/' },
    'x.com': { feed: /^\/(home|explore|i\/trending)?\/?$/, inbox: '/messages' },
    'twitter.com': { feed: /^\/(home|explore)?\/?$/, inbox: '/messages' },
    'reddit.com': { feed: /^\/(r\/(popular|all)|best|hot|new|top)?\/?$/, inbox: null },
    'facebook.com': { feed: /^\/(watch|reel|reels)?\/?$/, inbox: '/messages' },
    'tiktok.com': { feed: /^\/(foryou|explore|following)?\/?$/, inbox: '/messages' },
    'threads.net': { feed: /^\/?$/, inbox: null },
  };
  const site = SITES[host];
  if (!site) return;

  let on = false, shade = null;

  function build() {
    shade = document.createElement('div');
    shade.id = 'deepwork-feed';
    shade.attachShadow({ mode: 'open' }).innerHTML = `
      <style>
        :host { all: initial; position: fixed; inset: 0; z-index: 2147483647; background: #0a0c11; display: grid; place-items: center; font-family: "Segoe UI", system-ui, sans-serif; color: #e9ebf2; }
        .b { text-align: center; max-width: 460px; padding: 24px; }
        .r { width: 46px; height: 46px; border-radius: 50%; border: 6px solid #6d7cff; box-shadow: 0 0 28px rgba(109,124,255,.6); margin: 0 auto 22px; }
        h1 { font: 600 24px "Segoe UI", sans-serif; margin: 0 0 8px; }
        p { color: #8b91a3; margin: 0 0 18px; line-height: 1.5; font-size: 15px; }
        a { color: #fff; background: #6d7cff; padding: 10px 18px; border-radius: 10px; text-decoration: none; font-weight: 600; font-size: 14px; }
      </style>
      <div class="b"><div class="r"></div><h1>Лента скрыта</h1><p id="g"></p>${site.inbox ? `<a href="${site.inbox}">Открыть сообщения</a>` : ''}</div>`;
  }

  function update() {
    const show = on && site.feed.test(location.pathname);
    if (show) {
      if (!shade) build();
      const s = DWX.state;
      shade.shadowRoot.getElementById('g').textContent = s && s.goal ? `Ты в фокусе: «${s.goal}». Бесконечная лента подождёт.` : 'Ты в фокусе. Бесконечная лента подождёт.';
      if (!shade.isConnected) document.documentElement.appendChild(shade);
      document.querySelectorAll('video, audio').forEach(v => { try { v.pause(); } catch { } });
    } else if (shade && shade.isConnected) shade.remove();
  }

  DWX.on(s => { on = DWX.enforced(s) && !!s.feeds; update(); });
  // SPA navigation: poll the URL
  let last = location.href;
  setInterval(() => { if (location.href !== last || on) { last = location.href; update(); } }, 700);
})();
