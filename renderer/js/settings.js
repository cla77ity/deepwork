// Settings view: level editor, timer defaults, YouTube cleanup, general, Brave extension setup.
(function () {
  const { h } = DW;

  const set = patch => DW.call('settings:set', patch);

  function levelTable(locked) {
    const st = DW.state.settings;
    const D = DW.state.defaults;
    const overrides = JSON.parse(JSON.stringify(st.levels || {}));
    const put = (n, key, val) => {
      overrides[n] = overrides[n] || {};
      overrides[n][key] = val;
      set({ levels: overrides });
    };
    const cell = (n, f) => {
      const L = DW.levelCfg(n);
      if (f.kind === 'bool') return DW.switchEl(!!L[f.key], v => put(n, f.key, v), locked);
      if (f.kind === 'select') return h('select.select.input', { disabled: locked, onchange: e => put(n, f.key, e.target.value) },
        f.options.map(([v, l]) => h('option', { value: v, selected: L[f.key] === v }, l)));
      // exit: type + wait seconds
      return h('div.row', { style: { gap: '6px' } },
        h('select.select.input', { disabled: locked, onchange: e => put(n, 'exit', { ...L.exit, type: e.target.value }) },
          D.exitTypes.map(([v, l]) => h('option', { value: v, selected: L.exit.type === v }, l))),
        h('input.input.num-in', { type: 'number', min: 0, max: 1800, step: 15, value: L.exit.wait, title: 'ожидание, сек', disabled: locked,
          onchange: e => put(n, 'exit', { ...L.exit, wait: Math.max(0, Math.min(1800, +e.target.value || 0)) }) }), h('span.dim', 'с'));
    };
    return h('table.lv',
      h('tr', h('th', ''), [1, 2, 3, 4].map(n => h('th', { style: { color: `var(--l${n})` } }, `${n} · ${DW.levelCfg(n).name}`))),
      D.fields.map(f => h('tr', h('td', f.label), [1, 2, 3, 4].map(n => h('td', cell(n, f))))));
  }

  function render(root) {
    const st = DW.state.settings;
    const locked = DW.locked();
    const t = { ...st.timer };
    const ext = DW.state.ext || {};

    root.append(h('div.view-head', h('h1', 'Настройки')));
    if (locked) root.append(h('div.banner', 'Идёт сессия — настройки заблокированы до её конца.'));
    if (DW.state.dry) root.append(h('div.banner.info', 'Тестовый режим (--dry): блокировки только пишутся в лог, система не меняется.'));

    // ---- extension
    root.append(h('div.section', h('h2', 'Расширение для Brave'),
      h('p', 'Оно блокирует сайты, чистит YouTube, прячет кликбейт и ленты. Без него работает только hosts (уровни 3–4).'),
      h('div.card', h('div.row', { style: { marginBottom: '12px' } }, h('span.stat-dot.' + (ext.connected ? 'ok' : 'bad')),
        ext.connected ? `Подключено${ext.version ? ' · v' + ext.version : ''}` : 'Не подключено',
        ext.connected && !ext.incognito ? h('span.chip', { style: { color: 'var(--warn)' } }, 'в приватных окнах выключено — включи, иначе это лазейка') : null),
        h('ol.steps',
          h('li', 'Открой в Brave ', h('code', 'brave://extensions')),
          h('li', 'Включи ', h('b', 'Режим разработчика'), ' (справа сверху)'),
          h('li', h('b', 'Загрузить распакованное'), ' → выбери папку ', h('code', DW.state.extPath), ' ',
            h('button.btn.sm', { onclick: () => window.dw.call('open:path', DW.state.extPath) }, 'Открыть папку')),
          h('li', 'В карточке Deepwork → ', h('b', 'Сведения'), ' → включи ', h('b', 'Разрешить в приватном режиме')),
          h('li', 'Приложение Deepwork должно быть запущено — расширение подключится само')))));

    // ---- levels
    root.append(h('div.section', h('h2', 'Уровни фокуса'),
      h('p', 'Настрой, что делает каждый уровень. ', locked ? null : h('a', { href: '#', style: { color: 'var(--accent)' }, onclick: e => { e.preventDefault(); DW.call('settings:reset', 'levels'); } }, 'Сбросить к стандартным')),
      h('div.card', { style: { padding: '6px 8px', overflowX: 'auto' } }, levelTable(locked))));

    // ---- timer & goal
    const num = (key, label, min, max, obj = t, after) => h('div.param', h('span.label', label), h('input.input.num-in', {
      type: 'number', min, max, value: obj[key], disabled: locked,
      onchange: e => { obj[key] = Math.min(max, Math.max(min, +e.target.value || min)); after ? after() : set({ timer: t }); },
    }));
    const goalObj = { dailyGoalMin: st.dailyGoalMin };
    root.append(h('div.section', h('h2', 'Таймер и норма'),
      h('div.card', h('div.params',
        num('focus', 'Фокус, мин', 5, 180), num('short', 'Перерыв', 1, 60), num('long', 'Длинный', 1, 90),
        num('longEvery', 'Длинный каждые', 2, 12), num('rounds', 'Раундов', 1, 12), num('custom', 'Таймер, мин', 5, 480),
        num('dailyGoalMin', 'Норма в день, мин', 15, 960, goalObj, () => set({ dailyGoalMin: goalObj.dailyGoalMin })),
        h('div.param', h('span.label', 'Уровень по умолчанию'), h('select.select.input', { disabled: locked, onchange: e => set({ level: +e.target.value }) },
          [1, 2, 3, 4].map(n => h('option', { value: n, selected: st.level === n }, `${n} · ${DW.levelCfg(n).name}`))))))));

    // ---- youtube
    const yt = { ...st.youtube };
    const ytRow = (k, label) => h('div.row', DW.switchEl(yt[k], v => { yt[k] = v; set({ youtube: yt }); }, locked), label);
    root.append(h('div.section', h('h2', 'Чистка YouTube'),
      h('p', 'Работает, когда в уровне включена «Чистка YouTube». Поиск остаётся — смотришь только то, за чем пришёл.'),
      h('div.card', h('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(250px,1fr))', gap: '12px' } },
        ytRow('shorts', 'Убрать Shorts'), ytRow('home', 'Пустая главная (без рекомендаций)'), ytRow('sidebar', 'Без похожих видео справа'),
        ytRow('endscreen', 'Без заставок в конце'), ytRow('comments', 'Скрыть комментарии'), ytRow('autoplay', 'Отменять автозапуск следующего'),
        ytRow('notif', 'Скрыть колокольчик уведомлений')))));

    // ---- general
    const gen = (k, label, sub) => h('div.row', { style: { alignItems: 'flex-start' } }, DW.switchEl(!!st[k], v => set({ [k]: v }), locked && k !== 'sound'),
      h('div', h('div', label), sub ? h('div.dim', { style: { fontSize: '12.5px' } }, sub) : null));
    root.append(h('div.section', h('h2', 'Общие'),
      h('div.card.col', { style: { gap: '14px' } },
        gen('sound', 'Звук при смене фазы'),
        gen('alwaysClean', 'Чистить YouTube и кликбейт всегда', 'даже вне сессии фокуса — без блокировки сайтов'),
        gen('launchAtLogin', 'Запускать вместе с Windows', 'в трей, без окна'),
        h('div.row', h('span.muted', 'Данные:'), h('code', DW.state.userDir), h('button.btn.sm', { onclick: () => window.dw.call('open:path', DW.state.userDir) }, 'Открыть')))));
  }

  DW.views.settings = { render, title: 'Настройки' };
})();
