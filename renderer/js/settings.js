// Settings view: extension, work presets, browser behaviour, levels, timer & norms,
// notifications, desktop widget, YouTube cleanup, general.
(function () {
  const { h } = DW;

  const set = patch => DW.call('settings:set', patch);
  const uid = () => Math.random().toString(36).slice(2, 10);

  function section(title, desc, ...body) {
    return h('div.section', h('h2', title), desc ? h('p', desc) : null, ...body);
  }

  // ---------------------------------------------------------------- extension
  function extensionCard(ext) {
    const steps = h('ol.steps',
      h('li', 'Открой в Brave ', h('code', 'brave://extensions')),
      h('li', 'Включи ', h('b', 'Режим разработчика'), ' (справа сверху)'),
      h('li', h('b', 'Загрузить распакованное'), ' → папка ', h('code', DW.state.extPath), ' ',
        h('button.btn.sm', { onclick: () => window.dw.call('open:path', DW.state.extPath) }, 'Открыть папку')),
      h('li', 'В карточке Deepwork → ', h('b', 'Сведения'), ' → ', h('b', 'Разрешить в приватном режиме')));
    const status = h('div.row', h('span.stat-dot.' + (!ext.connected ? 'bad' : ext.incognito ? 'ok' : 'warn')),
      ext.connected ? `Подключено${ext.version ? ' · версия ' + ext.version : ''}` : 'Не подключено — Deepwork должен быть запущен',
      ext.connected && !ext.incognito ? h('span.chip.warn', 'в приватных окнах выключено — это лазейка') : null);
    if (!ext.connected || !ext.incognito) return h('div.card.col', { style: { gap: '14px' } }, status, steps);
    let open = false;
    const card = h('div.card.col', { style: { gap: '14px' } });
    const paint = () => {
      card.innerHTML = '';
      card.append(h('div.row', status, h('div.spacer'), h('button.btn.ghost.sm', { onclick: () => { open = !open; paint(); } }, open ? 'Скрыть' : 'Как переустановить')));
      if (open) card.append(steps);
    };
    paint();
    return card;
  }

  // ---------------------------------------------------------------- presets
  function presetsSection() {
    const presets = JSON.parse(JSON.stringify(DW.state.settings.presets));
    const save = () => set({ presets });
    const list = h('div.col', { style: { gap: '12px' } });
    const card = p => {
      const items = h('div.items');
      const paintItems = () => {
        items.innerHTML = '';
        p.apps.forEach((a, i) => items.append(h('span.chip', { title: a.path }, a.name,
          h('span.x', { onclick: () => { p.apps.splice(i, 1); save(); } }, '×'))));
        items.append(h('button.chip', {
          onclick: async () => {
            const a = await window.dw.call('presets:pickApp');
            if (a) { p.apps.push(a); save(); }
          },
        }, '+ программа'));
      };
      paintItems();
      const name = h('input.input', { value: p.name, placeholder: 'Название набора', style: { fontWeight: 600, flex: 1 }, onchange: e => { p.name = e.target.value.trim() || 'Набор'; save(); } });
      const urls = h('textarea.input', { placeholder: 'Сайты, по одному в строке: github.com', style: { minHeight: '70px' } }, p.urls.join('\n'));
      urls.addEventListener('change', () => { p.urls = urls.value.split(/\s+/).map(u => u.trim()).filter(Boolean); save(); });
      return h('div.preset',
        h('div.row', name,
          h('button.btn.sm', { title: 'Открыть программы и вкладки прямо сейчас', onclick: () => window.dw.call('presets:launch', p.id) }, 'Открыть сейчас'),
          DW.iconBtn('x', 'Удалить набор', async () => {
            if (await DW.confirm(`Удалить набор «${p.name}»?`, null, 'Удалить', true)) { presets.splice(presets.indexOf(p), 1); save(); }
          })),
        h('div.label', 'Программы'), items,
        h('div.label', 'Вкладки — откроются новым окном Brave'), urls);
    };
    presets.forEach(p => list.append(card(p)));
    const add = h('button.btn', { onclick: () => { presets.push({ id: uid(), name: 'Новый набор', apps: [], urls: [] }); save(); } }, DW.svg(DW.icons.plus), 'Новый набор');
    return h('div.section#presets', h('div.row', h('div.h2', 'Рабочие наборы'), h('div.spacer'), add),
      h('p', { style: { marginTop: '4px' } }, 'Программы и сайты, которые открываются при старте сессии. Набор выбирается на экране «Фокус». Программы из набора никогда не закрываются блокировкой.'),
      presets.length ? list : h('div.card.empty', 'Наборов нет. Например, «Код»: VS Code + github.com, claude.ai'));
  }

  // ---------------------------------------------------------------- levels
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
      return h('div.row', { style: { gap: '6px' } },
        h('select.select.input', { disabled: locked, onchange: e => put(n, 'exit', { ...L.exit, type: e.target.value }) },
          D.exitTypes.map(([v, l]) => h('option', { value: v, selected: L.exit.type === v }, l))),
        h('input.input.num-in', { type: 'number', min: 0, max: 1800, step: 15, value: L.exit.wait, title: 'ожидание перед выходом, секунд', disabled: locked,
          onchange: e => put(n, 'exit', { ...L.exit, wait: Math.max(0, Math.min(1800, +e.target.value || 0)) }) }), h('span.dim', 'с'));
    };
    return h('table.lv',
      h('tr', h('th', ''), [1, 2, 3, 4].map(n => h('th', DW.levelCfg(n).name, DW.pips(n)))),
      D.fields.map(f => h('tr', h('td', f.label), [1, 2, 3, 4].map(n => h('td', cell(n, f))))));
  }

  // ---------------------------------------------------------------- render
  function render(root) {
    const st = DW.state.settings;
    const locked = DW.locked();
    const t = { ...st.timer };
    const ext = DW.state.ext || {};

    root.append(h('div.view-head', h('h1', 'Настройки')));
    if (locked) root.append(h('div.banner', 'Идёт сессия: то, что ослабляет защиту, заблокировано до её конца. Наборы, таймер, норма и уведомления меняются как обычно.'));
    if (DW.state.dry) root.append(h('div.banner.info', 'Тестовый режим: блокировки только пишутся в лог, система не меняется.'));

    const extSection = section('Расширение для Brave', 'Блокирует сайты, закрывает лишние вкладки, чистит YouTube, кликбейт и ленты. Без него сайты закрываются только через hosts.', extensionCard(ext));
    if (!ext.connected) root.append(extSection);

    root.append(presetsSection());

    const tabsMode = st.tabs.mode;
    root.append(section('Вкладки при старте фокуса', null,
      h('div.card.col', { style: { gap: '14px' } },
        h('div.seg', [['blocked', 'Закрыть отвлекающие'], ['keep', 'Оставить только рабочие'], ['off', 'Не трогать']].map(([k, l]) =>
          h('button' + (tabsMode === k ? '.on' : ''), { disabled: locked, onclick: () => set({ tabs: { ...st.tabs, mode: k } }) }, l))),
        h('div.muted', { style: { fontSize: '13px' } }, {
          blocked: 'Закрываются вкладки с заблокированными сайтами.',
          keep: 'Закрывается всё, кроме сайтов из белого списка и из выбранного рабочего набора. Закреплённые вкладки остаются.',
          off: 'Вкладки остаются открытыми, но заблокированные сайты в них сменятся страницей блокировки.',
        }[tabsMode]),
        h('div.row', DW.switchEl(st.tabs.restore, v => set({ tabs: { ...st.tabs, restore: v } }), locked), 'Вернуть закрытые вкладки после сессии'))));

    root.append(section('Уровни фокуса', null,
      h('div.row', { style: { marginTop: '-8px', marginBottom: '12px' } }, h('span.muted', { style: { fontSize: '13px' } }, 'Что делает каждый уровень.'),
        locked ? null : h('a.link', { style: { fontSize: '13px' }, onclick: () => DW.call('settings:reset', 'levels') }, 'Сбросить к стандартным')),
      h('div.card', { style: { padding: '6px 8px', overflowX: 'auto' } }, levelTable(locked))));

    // ---- timer & norms
    const num = (key, label, min, max, obj = t, after) => h('div.param', h('span.label', label), h('input.input.num-in', {
      type: 'number', min, max, value: obj[key],
      onchange: e => { obj[key] = Math.min(max, Math.max(min, +e.target.value || min)); after ? after() : set({ timer: t }); },
    }));
    const goalObj = { dailyGoalMin: st.dailyGoalMin };
    const byDow = [...(st.goalByDow || [null, null, null, null, null, null, null])];
    const norms = h('div.norms', DW.DOW.map((d, i) => h('div.param', h('span.label', d), h('input.input.num-in', {
      type: 'number', min: 0, max: 960, step: 15, value: byDow[i] == null ? '' : byDow[i], placeholder: String(st.dailyGoalMin),
      onchange: e => { byDow[i] = e.target.value === '' ? null : Math.max(0, Math.min(960, +e.target.value)); set({ goalByDow: byDow }); },
    }))));
    root.append(section('Таймер и дневная норма', null,
      h('div.card.col', { style: { gap: '18px' } },
        h('div.params',
          num('focus', 'Фокус, мин', 5, 180), num('short', 'Перерыв', 1, 60), num('long', 'Длинный перерыв', 1, 90),
          num('longEvery', 'Раундов до длинного', 2, 12), num('rounds', 'Раундов в сессии', 1, 12), num('custom', 'Обычный таймер, мин', 5, 480),
          h('div.param', h('span.label', 'Уровень по умолчанию'), h('select.select.input', { disabled: locked, onchange: e => set({ level: +e.target.value }) },
            [1, 2, 3, 4].map(n => h('option', { value: n, selected: st.level === n }, `${n} · ${DW.levelCfg(n).name}`))))),
        h('div.params', num('dailyGoalMin', 'Норма в день, мин', 15, 960, goalObj, () => set({ dailyGoalMin: goalObj.dailyGoalMin }))),
        h('div', h('div.label', { style: { marginBottom: '8px' } }, 'Норма по дням недели, мин — пусто значит обычная, 0 — выходной'), norms))));

    // ---- notifications & widget
    const n = { ...st.notify };
    const nRow = (k, label) => h('div.row', DW.switchEl(n[k], v => { n[k] = v; set({ notify: n }); }), label);
    root.append(section('Уведомления', 'Свои окошки в углу экрана. Работают при включённом «Не беспокоить» Windows.',
      h('div.card', h('div.set-grid',
        nRow('breakStart', 'Начало перерыва'), nRow('breakSoon', 'За минуту до конца перерыва'),
        nRow('breakEnd', 'Конец перерыва'), nRow('sessionEnd', 'Конец сессии'),
        h('div.row', DW.switchEl(!!st.sound, v => set({ sound: v })), 'Звук')))));

    const w = { ...st.widget };
    root.append(section('Таймер на рабочем столе', 'Маленькое окно поверх всех окон. Перетаскивается мышкой, позиция запоминается.',
      h('div.card', h('div.set-grid',
        h('div.row', DW.switchEl(w.enabled, v => set({ widget: { ...w, enabled: v } })), 'Показывать во время сессии'),
        h('div.row', DW.switchEl(w.always, v => set({ widget: { ...w, always: v } }), !w.enabled), 'Показывать и вне сессии')))));

    // ---- youtube
    const yt = { ...st.youtube };
    const ytRow = (k, label) => h('div.row', DW.switchEl(yt[k], v => { yt[k] = v; set({ youtube: yt }); }, locked), label);
    root.append(section('Чистка YouTube', 'Работает на уровнях, где включена «Чистка YouTube». Поиск и подписки остаются.',
      h('div.card', h('div.set-grid',
        ytRow('shorts', 'Убрать Shorts'), ytRow('home', 'Пустая главная'), ytRow('sidebar', 'Без похожих видео'),
        ytRow('endscreen', 'Без заставок в конце'), ytRow('comments', 'Скрыть комментарии'), ytRow('autoplay', 'Без автозапуска следующего'),
        ytRow('notif', 'Скрыть колокольчик')))));

    // ---- general
    const gen = (k, label, sub) => h('div.row', { style: { alignItems: 'flex-start' } }, DW.switchEl(!!st[k], v => set({ [k]: v }), locked),
      h('div', h('div', label), sub ? h('div.dim', { style: { fontSize: '12.5px' } }, sub) : null));
    root.append(section('Общие', null,
      h('div.card.col', { style: { gap: '14px' } },
        gen('alwaysClean', 'Чистить YouTube и кликбейт всегда', 'даже вне сессии, без блокировки сайтов'),
        gen('launchAtLogin', 'Запускать вместе с Windows', 'сразу в трей, без окна'),
        h('div.row', h('span.muted', 'Данные'), h('code', DW.state.userDir), h('button.btn.sm', { onclick: () => window.dw.call('open:path', DW.state.userDir) }, 'Открыть')))));

    if (ext.connected) root.append(extSection);

    if (DW.settingsFocus) {
      const el = root.querySelector('#' + DW.settingsFocus);
      DW.settingsFocus = null;
      if (el) setTimeout(() => el.scrollIntoView({ behavior: 'smooth', block: 'start' }), 60);
    }
  }

  DW.views.settings = { render, title: 'Настройки' };
})();
