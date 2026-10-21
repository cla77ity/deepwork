// Boot: load state, nav, routing, live updates from main.
(function () {
  const { h } = DW;
  const NAV = [['focus', 'Фокус'], ['plan', 'План'], ['journal', 'Журнал'], ['stats', 'Статистика'], ['blocks', 'Блокировки'], ['settings', 'Настройки']];

  DW.levelCfg = n => {
    const D = DW.state.defaults.levels;
    const base = D[n] || D[2];
    const o = (DW.state.settings.levels || {})[n] || {};
    return { ...base, ...o, exit: { ...base.exit, ...(o.exit || {}) }, n: Number(n) };
  };

  DW.go = view => {
    if (DW.views[DW.view] && DW.views[DW.view].leave) DW.views[DW.view].leave();
    DW.view = view;
    DW.entering = true;
    DW.render();
  };

  DW.render = () => {
    const root = document.getElementById('view');
    const scroll = root.scrollTop;
    const v = DW.views[DW.view];
    if (v.leave) v.leave();
    root.innerHTML = '';
    // entrance animation only on navigation — data refreshes must not make the page jump
    clearTimeout(DW.enterT);
    root.classList.toggle('enter', !!DW.entering);
    if (DW.entering) { DW.entering = false; DW.enterT = setTimeout(() => root.classList.remove('enter'), 900); }
    v.render(root);
    root.scrollTop = scroll;
    renderNav();
    renderPill();
    if (DW.refocus) { const el = document.getElementById(DW.refocus); if (el) el.focus(); DW.refocus = null; }
  };

  function renderNav() {
    const nav = document.getElementById('nav');
    nav.innerHTML = '';
    for (const [id, label] of NAV) nav.append(h('button.nav-item' + (DW.view === id ? '.on' : ''), { onclick: () => DW.go(id) }, DW.svg(DW.icons[id]), label));
    const by = DW.focusByDay();
    const s = DW.state.session;
    let done = by[DW.today()] || 0;
    if (s && s.phase === 'focus') done += ((s.pausedAt || Date.now()) - s.phaseStart) / 60000;
    if (s) done += s.focusMs / 60000;
    const goal = DW.goalFor(DW.today());
    const ext = DW.state.ext || {};
    nav.append(h('div.side-foot',
      h('div.row', h('span.muted', 'Сегодня'), h('div.spacer'), h('b.num', DW.durShort(done) + (goal ? ' / ' + DW.durShort(goal) : ''))),
      h('div.bar', h('i', { style: { width: (goal ? Math.min(100, done / goal * 100) : 100) + '%' } })),
      h('div.muted', { style: { fontSize: '12px' } }, h('span.stat-dot.' + (ext.connected ? 'ok' : 'bad')), ext.connected ? 'Расширение подключено' : 'Расширение не подключено')));
  }

  let pillTimer;
  function renderPill() {
    const pill = document.getElementById('pill');
    clearInterval(pillTimer);
    const s = DW.state.session;
    if (!s) { pill.classList.add('hidden'); return; }
    pill.classList.remove('hidden');
    pill.classList.toggle('brk', s.phase !== 'focus');
    pill.onclick = () => DW.go('focus');
    const paint = () => {
      const now = s.pausedAt || Date.now();
      const label = s.phase === 'focus' ? 'Фокус' : 'Перерыв';
      const t = s.phaseEnd ? DW.clock(s.phaseEnd - now) : DW.clock(now - s.phaseStart);
      pill.innerHTML = '';
      pill.append(h('span.dot'), `${label} · `, h('span.num', t), s.status === 'paused' ? ' · пауза' : '');
    };
    paint();
    pillTimer = setInterval(paint, 1000);
  }

  document.querySelectorAll('[data-win]').forEach(b => b.addEventListener('click', () => window.dw.call('win:' + b.dataset.win)));

  window.dw.on('session', p => {
    // session started or ended: the focus screen changes entirely, so animate it in
    if (!!DW.state.session !== !!p.session || (p.session && DW.state.session && p.session.phase !== DW.state.session.phase)) DW.entering = true;
    Object.assign(DW.state, p);
    // don't rebuild the plan/blocks/settings views on timer events — it would drop what's being typed
    if (DW.view === 'focus') DW.render(); else { renderPill(); renderNav(); }
  });
  window.dw.on('data', p => {
    Object.assign(DW.state, p);
    // autosaving text (journal) must not rebuild the page under the cursor
    const a = document.activeElement;
    if (a && a.tagName === 'TEXTAREA' && a.closest('#view')) { renderNav(); return; }
    DW.render();
  });
  window.dw.on('finished', rec => DW.onFinished(rec));

  window.dw.call('init').then(st => {
    DW.state = st;
    const q = new URLSearchParams(location.search);
    if (q.get('view')) DW.view = q.get('view');
    DW.entering = true;
    DW.render();
  });
})();
