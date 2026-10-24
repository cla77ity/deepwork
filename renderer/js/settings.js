// Settings view: a section menu on the left, every option on the right.
(function () {
  const { h } = DW;

  const set = patch => DW.call('settings:set', patch);
  const uid = () => Math.random().toString(36).slice(2, 10);
  const clone = o => JSON.parse(JSON.stringify(o));

  // every section carries data-sec=title so the menu and the command palette can scroll to it
  function section(title, desc, ...body) {
    return h('div.section', { 'data-sec': title }, h('h2', title), desc ? h('p', desc) : null, ...body);
  }
  const card = (...kids) => h('div.card.col', { style: { gap: '14px' } }, ...kids);
  const toggle = (on, label, cb, disabled, sub) => h('div.row', { style: { alignItems: 'flex-start' } }, DW.switchEl(!!on, cb, disabled),
    h('div', h('div', label), sub ? h('div.dim', { style: { fontSize: '12.5px' } }, sub) : null));
  const daysPicker = (days, onChange) => {
    const sel = new Set(days);
    const row = h('div.row', { style: { gap: '4px' } });
    const paint = () => {
      row.innerHTML = '';
      DW.DOW.forEach((l, i) => row.append(h('button.chip.day-chip' + (sel.has(i) ? '.on' : ''), { onclick: () => { sel.has(i) ? sel.delete(i) : sel.add(i); paint(); onChange([...sel].sort()); } }, l)));
    };
    paint();
    return row;
  };

  // ---------------------------------------------------------------- extension
  function extensionCard(ext) {
    const steps = h('ol.steps',
      h('li', 'Открой в Brave ', h('code', 'brave://extensions')),
      h('li', 'Включи ', h('b', 'Режим разработчика'), ' (справа сверху)'),
      h('li', h('b', 'Загрузить распакованное'), ' → папка ', h('code', DW.state.extPath), ' ',
        h('button.btn.sm', { onclick: () => window.dw.call('open:path', DW.state.extPath) }, 'Открыть папку')),
      h('li', 'В карточке Deepwork → ', h('b', 'Сведения'), ' → ', h('b', 'Разрешить в приватном режиме')),
      h('li', 'После обновления Deepwork нажми ↻ на карточке расширения'));
    const status = h('div.row', h('span.stat-dot.' + (!ext.connected ? 'bad' : ext.incognito ? 'ok' : 'warn')),
      ext.connected ? `Подключено${ext.version ? ' · версия ' + ext.version : ''}` : 'Не подключено — Deepwork должен быть запущен',
      ext.connected && !ext.incognito ? h('span.chip.warn', 'в приватных окнах выключено — это лазейка') : null);
    if (!ext.connected || !ext.incognito) return card(status, steps);
    let open = false;
    const c = card();
    const paint = () => {
      c.innerHTML = '';
      c.append(h('div.row', status, h('div.spacer'), h('button.btn.ghost.sm', { onclick: () => { open = !open; paint(); } }, open ? 'Скрыть' : 'Как переустановить')));
      if (open) c.append(steps);
    };
    paint();
    return c;
  }

  // ---------------------------------------------------------------- macOS Focus
  // macOS has no API to switch Focus on; Deepwork runs two Shortcuts the user creates once
  function macFocusSection() {
    const [on, off] = DW.state.shortcuts || ['Deepwork Focus On', 'Deepwork Focus Off'];
    const en = DW.state.enforce || {};
    const s = section('«Не беспокоить» на Mac', 'macOS не даёт программам включать фокусирование напрямую. Deepwork запускает две команды из приложения «Команды» — создай их один раз.',
      card(
        en.dnd === false ? h('div.row', h('span.stat-dot.warn'), 'Команды не найдены — «Не беспокоить» не включился') : null,
        h('ol.steps',
          h('li', 'Открой приложение ', h('b', 'Команды'), ' (Shortcuts) → ', h('b', '+'), ' новая команда'),
          h('li', 'Добавь действие ', h('b', 'Фокусирование'), ' (Set Focus) → «Не беспокоить» → ', h('b', 'Включить')),
          h('li', 'Назови команду ', h('code', on)),
          h('li', 'Сделай вторую такую же с ', h('b', 'Выключить'), ' и назови ', h('code', off))),
        h('div.hint', 'Проверить можно в Терминале: shortcuts list')));
    s.id = 'mac-focus';
    return s;
  }

  // ---------------------------------------------------------------- presets
  function presetsSection() {
    const presets = clone(DW.state.settings.presets);
    const save = () => set({ presets });
    const list = h('div.col', { style: { gap: '12px' } });
    const one = p => {
      const items = h('div.items');
      p.apps.forEach((a, i) => items.append(h('span.chip', { title: a.path }, a.name, h('span.x', { onclick: () => { p.apps.splice(i, 1); save(); } }, '×'))));
      items.append(h('button.chip', { onclick: async () => { const a = await window.dw.call('presets:pickApp'); if (a) { p.apps.push(a); save(); } } }, '+ программа'));
      const name = h('input.input', { value: p.name, placeholder: 'Название набора', style: { fontWeight: 600, flex: 1 }, onchange: e => { p.name = e.target.value.trim() || 'Набор'; save(); } });
      const urls = h('textarea.input', { placeholder: 'Сайты, по одному в строке: github.com', style: { minHeight: '70px' } }, p.urls.join('\n'));
      urls.addEventListener('change', () => { p.urls = urls.value.split(/\s+/).map(u => u.trim()).filter(Boolean); save(); });
      return h('div.preset',
        h('div.row', name,
          h('button.btn.sm', { title: 'Открыть программы и вкладки прямо сейчас', onclick: () => window.dw.call('presets:launch', p.id) }, 'Открыть сейчас'),
          DW.iconBtn('x', 'Удалить набор', async () => { if (await DW.confirm(`Удалить набор «${p.name}»?`, null, 'Удалить', true)) { presets.splice(presets.indexOf(p), 1); save(); } })),
        h('div.label', 'Программы'), items,
        h('div.label', 'Вкладки — откроются новым окном Brave'), urls);
    };
    presets.forEach(p => list.append(one(p)));
    const s = h('div.section#presets', { 'data-sec': 'Рабочие наборы' },
      h('div.row', h('div.h2', 'Рабочие наборы'), h('div.spacer'), h('button.btn', { onclick: () => { presets.push({ id: uid(), name: 'Новый набор', apps: [], urls: [] }); save(); } }, DW.svg(DW.icons.plus), 'Новый набор')),
      h('p', { style: { marginTop: '4px' } }, 'Программы и сайты, которые открываются при старте сессии. Программы из набора блокировка не закрывает.'),
      presets.length ? list : h('div.card.empty', 'Наборов нет. Например, «Код»: VS Code + github.com, claude.ai'));
    return s;
  }

  // ---------------------------------------------------------------- templates
  function templatesSection() {
    const tps = clone(DW.state.settings.templates);
    const save = () => set({ templates: tps });
    const presetName = id => (DW.state.settings.presets.find(p => p.id === id) || {}).name;
    return section('Шаблоны сессий', 'Запуск в один клик: на экране «Фокус», в трее, по Ctrl+Alt+F (первый шаблон) и с телефона. Создаются кнопкой «Сохранить как шаблон» на экране «Фокус».',
      tps.length ? h('div.col', { style: { gap: '8px' } }, tps.map((tp, i) => h('div.preset', h('div.row',
        h('input.input', { value: tp.name, style: { fontWeight: 600, flex: 1 }, onchange: e => { tp.name = e.target.value.trim() || tp.name; save(); } }),
        h('span.muted', { style: { fontSize: '12.5px' } }, [tp.mode === 'pomodoro' ? `помодоро ${tp.focus}×${tp.rounds}` : tp.mode === 'flow' ? 'поток' : DW.dur(tp.minutes || 0),
          DW.levelCfg(tp.level || 2).name, presetName(tp.presetId)].filter(Boolean).join(' · ')),
        i > 0 ? DW.iconBtn('left', 'Сделать первым (для Ctrl+Alt+F)', () => { tps.unshift(...tps.splice(i, 1)); save(); }) : h('span.chip', 'первый'),
        DW.iconBtn('x', 'Удалить', () => { tps.splice(i, 1); save(); })))))
        : h('div.card.empty', 'Шаблонов пока нет'));
  }

  // ---------------------------------------------------------------- schedule
  function scheduleSection() {
    const items = clone(DW.state.settings.schedule);
    const save = () => set({ schedule: items });
    const st = DW.state.settings;
    const row = it => h('div.preset',
      h('div.row.wrap', { style: { gap: '10px' } },
        h('input.input', { value: it.name || '', placeholder: 'Название', style: { flex: 1, minWidth: '160px', fontWeight: 600 }, onchange: e => { it.name = e.target.value.trim(); save(); } }),
        h('input.input', { type: 'time', value: it.time, onchange: e => { it.time = e.target.value; save(); } }),
        h('input.input.num-in', { type: 'number', min: 5, max: 480, value: it.minutes, title: 'минут', onchange: e => { it.minutes = Math.max(5, Math.min(480, +e.target.value || 50)); save(); } }), h('span.dim', 'мин'),
        DW.switchEl(it.active !== false, v => { it.active = v; save(); }),
        DW.iconBtn('x', 'Удалить', () => { items.splice(items.indexOf(it), 1); save(); })),
      h('div.row.wrap', { style: { gap: '10px' } },
        daysPicker(it.days || [], d => { it.days = d; save(); }),
        h('select.select.input.sm', { onchange: e => { it.level = +e.target.value; save(); } }, [1, 2, 3, 4].map(n => h('option', { value: n, selected: (it.level || st.level) === n }, DW.levelCfg(n).name))),
        h('select.select.input.sm', { onchange: e => { it.presetId = e.target.value || null; save(); } }, h('option', { value: '' }, 'без набора'), st.presets.map(p => h('option', { value: p.id, selected: it.presetId === p.id }, p.name))),
        h('select.select.input.sm', { onchange: e => { const v = e.target.value; it.auto = v !== 'remind'; it.contract = v === 'contract'; save(); } },
          [['remind', 'спросить'], ['auto', 'запустить сам'], ['contract', 'контракт']].map(([v, l]) => h('option', { value: v, selected: (it.contract ? 'contract' : it.auto ? 'auto' : 'remind') === v }, l)))));
    return section('Расписание', 'Сессии по расписанию: за 2 минуты придёт напоминание. «Спросить» — окно с кнопкой «Начать», «запустить сам» — старт без вопросов, «контракт» — то же, но ты заранее договорился с собой не пропускать.',
      items.length ? h('div.col', { style: { gap: '8px' } }, items.map(row)) : null,
      h('button.btn', { onclick: () => { items.push({ id: uid(), name: 'Глубокая работа', days: [0, 1, 2, 3, 4], time: '10:00', minutes: 90, level: st.level, presetId: st.lastPreset, auto: false, contract: false, active: true }); save(); } }, DW.svg(DW.icons.plus), 'Добавить в расписание'));
  }

  // ---------------------------------------------------------------- limits
  function limitsSection(locked) {
    const items = clone(DW.state.settings.limits);
    const save = () => set({ limits: items });
    const used = (DW.state.usage || {})[DW.today()] || {};
    const spent = d => Object.entries(used).filter(([h2]) => h2 === d || h2.endsWith('.' + d)).reduce((a, [, v]) => a + v, 0) / 60;
    const add = h('input.input', { placeholder: 'youtube.com', style: { width: '200px' } });
    const mins = h('input.input.num-in', { type: 'number', min: 5, max: 600, value: 30 });
    return section('Лимиты сайтов', 'Сколько минут в день можно провести на сайте — всегда, не только в фокусе. Лимит кончился — сайт закрыт до полуночи. Считает расширение Brave. Во время сессии лимиты можно только ужесточать.',
      items.length ? card(...items.map((l, i) => h('div.row',
        h('b', { style: { width: '200px' } }, l.domain),
        h('input.input.num-in', { type: 'number', min: 5, max: 600, value: l.minutes, disabled: locked, onchange: e => { l.minutes = Math.max(5, Math.min(600, +e.target.value || 30)); save(); } }), h('span.dim', 'мин в день'),
        h('div.spacer'),
        h('span.muted.num', { style: { fontSize: '12.5px' } }, `сегодня ${DW.durShort(spent(l.domain))} из ${DW.durShort(l.minutes)}`),
        h('div.lbar', h('i', { style: { width: Math.min(100, spent(l.domain) / l.minutes * 100) + '%' } })),
        locked ? null : DW.iconBtn('x', 'Удалить', () => { items.splice(i, 1); save(); })))) : null,
      h('div.row', add, mins, h('span.dim', 'мин в день'), h('button.btn', {
        onclick: () => {
          const d = add.value.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/.*$/, '');
          if (!d) return add.focus();
          items.push({ domain: d, minutes: Math.max(5, +mins.value || 30) }); save();
        },
      }, 'Добавить лимит')));
  }

  // ---------------------------------------------------------------- levels
  function levelTable(locked) {
    const st = DW.state.settings;
    const D = DW.state.defaults;
    const overrides = clone(st.levels || {});
    const put = (n, key, val) => { overrides[n] = overrides[n] || {}; overrides[n][key] = val; set({ levels: overrides }); };
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

  // ---------------------------------------------------------------- Telegram / phone / calendar / data / updates
  function telegramSection() {
    const c = DW.state.settings.telegram;
    const stt = (DW.state.status || {}).telegram;
    const put = patch => set({ telegram: { ...c, ...patch } });
    const token = h('input.input', { type: 'password', value: c.token, placeholder: '123456:ABC… от @BotFather', style: { flex: 1 }, onchange: e => put({ token: e.target.value.trim() }) });
    return section('Telegram', 'Свой бот: статус и итог дня в Telegram, старт фокуса, задачи и парковка мыслей с телефона откуда угодно. Выйти из фокуса через бота нельзя.',
      card(
        toggle(c.enabled, 'Включить бота', v => put({ enabled: v })),
        c.enabled ? [
          h('ol.steps', h('li', 'Напиши ', h('b', '@BotFather'), ' в Telegram → /newbot → получи токен'), h('li', 'Вставь токен сюда'),
            h('li', 'Открой своего бота и отправь ему код: ', h('code', c.pairCode || '…'))),
          h('div.row', token),
          stt ? h('div.row', h('span.stat-dot.' + (stt.ok ? (stt.paired ? 'ok' : 'warn') : 'bad')),
            stt.ok ? (stt.paired ? `Подключён @${stt.username}` : `Бот @${stt.username} ждёт код`) : 'Ошибка: ' + (stt.error || ''),
            h('div.spacer'),
            stt.ok && stt.paired ? h('button.btn.sm', { onclick: () => window.dw.call('telegram:test') }, 'Проверить') : null,
            stt.ok && stt.paired ? h('button.btn.ghost.sm', { onclick: () => window.dw.call('telegram:unpair') }, 'Отвязать чат') : null) : null,
          h('div.set-grid', toggle(c.notify, 'Сообщать о начале и конце сессий', v => put({ notify: v })), toggle(c.daily, 'Итог дня вечером', v => put({ daily: v }))),
          h('div.hint', 'Команды: /status /today /plan /focus 50 /park мысль /add задача. Обычный текст боту — тоже парковка.'),
        ] : null));
  }

  function phoneSection() {
    const c = DW.state.settings.phone;
    const stt = (DW.state.status || {}).phone;
    return section('Телефон', 'Deepwork на телефоне без App Store: таймер, старт фокуса, задачи, рутина, журнал и парковка. Телефон должен быть в той же Wi-Fi сети, что и компьютер.',
      card(
        toggle(c.enabled, 'Включить доступ с телефона', v => set({ phone: { ...c, enabled: v } }), false, 'Windows может спросить разрешение брандмауэра — разреши для частных сетей'),
        c.enabled && stt ? [
          stt.error ? h('div.row', h('span.stat-dot.bad'), stt.error) : null,
          h('div', h('div.label', 'Открой на телефоне'), h('div.col', { style: { gap: '4px', marginTop: '6px' } }, (stt.urls || []).map(u => h('code.big-code', u)))),
          h('div.row', h('span.muted', 'PIN'), h('code.big-code', stt.pin || c.pin), h('button.btn.ghost.sm', { onclick: () => window.dw.call('phone:refresh') }, 'Новый PIN')),
          h('div.hint', 'iPhone: Safari → «Поделиться» → «На экран «Домой»». Android: Chrome → ⋮ → «Добавить на главный экран».'),
        ] : null));
  }

  function calendarSection() {
    const c = DW.state.settings.calendar;
    const stt = (DW.state.status || {}).calendar;
    const inp = h('input.input', { value: c.ics, placeholder: 'https://calendar.google.com/calendar/ical/…/basic.ics', style: { flex: 1 }, onchange: e => set({ calendar: { ...c, ics: e.target.value.trim() } }) });
    return section('Календарь', 'События из Google Календаря (или любого .ics) в «Плане» и утреннем ритуале. Только чтение.',
      card(h('div.row', inp, c.ics ? h('button.btn.sm', { onclick: () => window.dw.call('calendar:refresh') }, 'Обновить') : null),
        stt ? h('div.row', h('span.stat-dot.' + (stt.ok ? 'ok' : 'bad')), stt.ok ? `${DW.count(stt.count, 'событие', 'события', 'событий')} · обновлено в ${DW.hhmm(stt.at)}` : 'Не удалось загрузить: ' + stt.error) : null,
        h('div.hint', 'Google Календарь → Настройки календаря → «Секретный адрес в формате iCal».')));
  }

  function dataSection() {
    const box = card(
      h('div.row', h('span.muted', 'Папка'), h('code', { style: { overflow: 'hidden', textOverflow: 'ellipsis' } }, DW.state.dataDir), h('button.btn.sm', { onclick: () => window.dw.call('open:path', DW.state.dataDir) }, 'Открыть')),
      h('div.row.wrap',
        h('button.btn.sm', { onclick: moveData }, 'Перенести в другую папку'),
        DW.state.dataDir !== DW.state.userDir ? h('button.btn.ghost.sm', { onclick: () => DW.confirm('Вернуть данные в папку по умолчанию?', 'Текущие данные скопируются туда, Deepwork перезапустится.', 'Вернуть').then(ok => ok && window.dw.call('data:setDir', null, 'move')) }, 'Вернуть по умолчанию') : null,
        h('button.btn.sm', { onclick: async () => { const p = await window.dw.call('data:export'); if (p) DW.toast('Сохранено: ' + p); } }, 'Экспорт'),
        h('button.btn.sm', { onclick: async () => { const r = await DW.call('data:import'); if (r && r.ok) DW.toast('Данные загружены'); } }, 'Импорт')),
      h('div.hint', 'Синхронизация между компьютерами: перенеси данные в папку OneDrive, iCloud или Dropbox и укажи ту же папку на втором компьютере. Не держи Deepwork открытым на двух компьютерах одновременно.'));
    const backups = h('div.col', { style: { gap: '4px' } });
    window.dw.call('data:backups').then(list => {
      backups.append(h('div.label', `Резервные копии — каждый день, хранятся 14 дней`));
      list.slice(0, 6).forEach(b => backups.append(h('div.row', h('span.num', b.name.replace(/^data-|\.json$/g, '')), h('span.dim', Math.round(b.size / 1024) + ' КБ'), h('div.spacer'),
        h('button.btn.ghost.sm', { onclick: () => DW.confirm(`Восстановить копию от ${b.name.slice(5, 15)}?`, 'Текущие данные сначала сохранятся в резервную копию.', 'Восстановить').then(ok => ok && DW.call('data:restore', b.name).then(r => r && r.ok && DW.toast('Восстановлено'))) }, 'Восстановить'))));
      if (!list.length) backups.append(h('div.dim', 'Копий пока нет — первая появится при следующем запуске'));
    });
    box.append(backups);
    return section('Данные', null, box);
  }

  async function moveData() {
    const r = await window.dw.call('data:pickDir');
    if (!r) return;
    if (r.hasData) {
      DW.modal((m, close) => {
        m.append(h('h2', 'В папке уже есть данные Deepwork'), h('p', 'Например, с другого компьютера. Что сделать?'),
          h('div.acts',
            h('button.btn', { onclick: () => close() }, 'Отмена'),
            h('button.btn', { onclick: () => { close(); DW.call('data:setDir', r.dir, 'move'); } }, 'Заменить моими'),
            h('button.btn.primary', { onclick: () => { close(); DW.call('data:setDir', r.dir, 'use'); } }, 'Использовать их')));
      });
    } else if (await DW.confirm('Перенести данные?', `В ${r.dir}. Deepwork перезапустится.`, 'Перенести')) DW.call('data:setDir', r.dir, 'move');
  }

  function updatesSection() {
    const u = (DW.state.status || {}).update;
    const c = DW.state.settings.updates;
    let line;
    if (!u) line = h('span.muted', 'Ещё не проверялось');
    else if (u.checking) line = h('span.muted', 'Проверяю…');
    else if (u.error) line = h('span', h('span.stat-dot.bad'), u.error);
    else if (u.available) line = h('span', h('span.stat-dot.warn'), u.kind === 'git' ? `Доступно обновление: ${DW.count(u.count, 'изменение', 'изменения', 'изменений')}` : `Доступна версия ${u.version}`);
    else line = h('span', h('span.stat-dot.ok'), 'Установлена последняя версия');
    return section('Обновления', `Версия ${DW.state.version}${DW.state.packaged ? '' : ' (из исходников, обновление через git)'}.`,
      card(h('div.row', line, h('div.spacer'),
        h('button.btn.sm', { onclick: () => window.dw.call('update:check') }, 'Проверить'),
        u && u.available ? h('button.btn.primary.sm', {
          onclick: async () => {
            const r = await DW.call('update:apply');
            if (r && r.ok && !r.opened) DW.toast('Обновлено, перезапускаю…');
          },
        }, u.kind === 'git' ? 'Обновить и перезапустить' : 'Скачать') : null),
        u && u.available && u.notes && u.notes.length ? h('ul.insights', u.notes.filter(Boolean).slice(0, 5).map(n => h('li', n))) : null,
        toggle(c.check, 'Проверять автоматически', v => set({ updates: { ...c, check: v } }))));
  }

  // ---------------------------------------------------------------- render
  function render(root) {
    const st = DW.state.settings;
    const locked = DW.locked();
    const t = { ...st.timer };
    const ext = DW.state.ext || {};
    const content = h('div.set-content');
    const add = (...els) => content.append(...els.filter(Boolean));

    if (locked) add(h('div.banner', 'Идёт сессия: то, что ослабляет защиту, заблокировано до её конца. Наборы, таймер, норма, звуки и уведомления меняются как обычно.'));
    if (DW.state.dry) add(h('div.banner.info', 'Тестовый режим: блокировки только пишутся в лог, система не меняется.'));

    const extSection = section('Расширение для Brave', 'Блокирует сайты, закрывает лишние вкладки, чистит YouTube, кликбейт и ленты, считает время на сайтах.', extensionCard(ext));
    if (!ext.connected) add(extSection);
    if (DW.state.platform === 'darwin') add(macFocusSection());
    add(presetsSection(), templatesSection(), scheduleSection(), limitsSection(locked));

    const tabsMode = st.tabs.mode;
    add(section('Вкладки при старте фокуса', null, card(
      h('div.seg', [['blocked', 'Закрыть отвлекающие'], ['keep', 'Оставить только рабочие'], ['off', 'Не трогать']].map(([k, l]) =>
        h('button' + (tabsMode === k ? '.on' : ''), { disabled: locked, onclick: () => set({ tabs: { ...st.tabs, mode: k } }) }, l))),
      h('div.muted', { style: { fontSize: '13px' } }, {
        blocked: 'Закрываются вкладки с заблокированными сайтами.',
        keep: 'Закрывается всё, кроме сайтов из белого списка и из выбранного рабочего набора. Закреплённые вкладки остаются.',
        off: 'Вкладки остаются открытыми, но заблокированные сайты в них сменятся страницей блокировки.',
      }[tabsMode]),
      toggle(st.tabs.restore, 'Вернуть закрытые вкладки после сессии', v => set({ tabs: { ...st.tabs, restore: v } }), locked))));

    add(section('Уровни фокуса', null,
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
    add(section('Таймер и дневная норма', null, card(
      h('div.params',
        num('focus', 'Фокус, мин', 5, 180), num('short', 'Перерыв', 1, 60), num('long', 'Длинный перерыв', 1, 90),
        num('longEvery', 'Раундов до длинного', 2, 12), num('rounds', 'Раундов в сессии', 1, 12), num('custom', 'Обычный таймер, мин', 5, 480),
        h('div.param', h('span.label', 'Уровень по умолчанию'), h('select.select.input', { disabled: locked, onchange: e => set({ level: +e.target.value }) },
          [1, 2, 3, 4].map(n => h('option', { value: n, selected: st.level === n }, `${n} · ${DW.levelCfg(n).name}`))))),
      h('div.params', num('dailyGoalMin', 'Норма в день, мин', 15, 960, goalObj, () => set({ dailyGoalMin: goalObj.dailyGoalMin }))),
      h('div', h('div.label', { style: { marginBottom: '8px' } }, 'Норма по дням недели, мин — пусто значит обычная, 0 — выходной'), norms))));

    const idle = { ...st.idle };
    add(section('Простой', 'Если во время фокуса ни мышь, ни клавиатура не трогались дольше порога — это время не засчитывается. Статистика остаётся честной.', card(
      h('div.row', DW.switchEl(idle.enabled, v => set({ idle: { ...idle, enabled: v } })), 'Не засчитывать простой дольше',
        h('input.input.num-in', { type: 'number', min: 2, max: 60, value: idle.minutes, disabled: !idle.enabled, onchange: e => set({ idle: { ...idle, minutes: Math.max(2, Math.min(60, +e.target.value || 5)) } }) }), h('span.dim', 'мин')))));

    // ---- notifications & break screen
    const n = { ...st.notify };
    const nRow = (k, label) => toggle(n[k], label, v => { n[k] = v; set({ notify: n }); });
    add(section('Уведомления и перерывы', `Свои окошки в углу экрана — работают и при включённом «Не беспокоить» ${DW.os().name}.`, card(
      h('div.set-grid',
        nRow('breakStart', 'Начало перерыва'), nRow('breakSoon', 'За минуту до конца перерыва'),
        nRow('breakEnd', 'Конец перерыва'), nRow('sessionEnd', 'Конец сессии'),
        toggle(st.sound, 'Звук', v => set({ sound: v }))),
      h('div', h('div.label', { style: { marginBottom: '8px' } }, 'Экран перерыва — во весь экран, с дыхательным кругом и подсказками'),
        h('div.seg', [['off', 'Выключен'], ['soft', 'Мягкий'], ['strict', 'Строгий']].map(([k, l]) => h('button' + (st.breakScreen === k ? '.on' : ''), { onclick: () => set({ breakScreen: k }) }, l))),
        h('div.hint', { style: { marginTop: '6px' } }, { off: 'Перерыв только уведомлением.', soft: 'Экран можно закрыть или пропустить перерыв.', strict: 'Перерыв не пропустить, экран закрывается только через минуту — чтобы правда отдохнуть.' }[st.breakScreen])))));

    // ---- sounds
    const a = { ...st.ambient };
    add(section('Звуки', 'Фон для концентрации, генерируется самим Deepwork — без файлов и интернета. Бинауральный ритм работает только в наушниках.', card(
      h('div.row.wrap', { style: { gap: '6px' } }, DW.AMBIENT.map(([k, l]) => h('button.chip' + (a.kind === k ? '.on' : ''), { onclick: () => { set({ ambient: { ...a, kind: k } }); if (k !== 'off') window.dw.call('ambient:preview', k, a.volume); } }, l))),
      DW.volumeSlider(true),
      toggle(a.breaks, 'Играть и в перерывах', v => set({ ambient: { ...a, breaks: v } })))));

    const w = { ...st.widget };
    add(section('Таймер на рабочем столе', 'Маленькое окно поверх всех окон. Перетаскивается мышкой, позиция запоминается.', h('div.card', h('div.set-grid',
      toggle(w.enabled, 'Показывать во время сессии', v => set({ widget: { ...w, enabled: v } })),
      toggle(w.always, 'Показывать и вне сессии', v => set({ widget: { ...w, always: v } }), !w.enabled)))));

    const r = { ...st.rituals };
    add(section('Ритуалы', 'Утром — выбрать главное. Вечером — подвести итог. Без них план быстро превращается в список желаний.', card(
      toggle(r.morning, 'Утренний план при первом открытии за день', v => set({ rituals: { ...r, morning: v } }), false, 'до трёх главных задач, норма, рутина и календарь на день'),
      h('div.row', DW.switchEl(r.evening, v => set({ rituals: { ...r, evening: v } })), 'Вечерний итог в',
        h('input.input', { type: 'time', value: r.eveningTime, disabled: !r.evening, onchange: e => set({ rituals: { ...r, eveningTime: e.target.value } }) }),
        h('span.dim', '— откроется журнал дня')))));

    const hk = (DW.state.status || {}).hotkeys || [];
    add(section('Горячие клавиши', 'Работают в любой программе.', card(
      toggle(st.hotkeys, 'Включить', v => set({ hotkeys: v })),
      st.hotkeys ? h('div.col', { style: { gap: '6px' } }, hk.map(k => h('div.row', h('code', { style: { minWidth: '150px' } }, k.accel), h('span', k.label), k.ok ? null : h('span.chip.warn', 'занято другой программой')))) : null,
      h('div.hint', 'В окне Deepwork: Ctrl+K — все команды.'))));

    add(calendarSection(), telegramSection(), phoneSection());

    // ---- youtube
    const yt = { ...st.youtube };
    const ytRow = (k, label) => toggle(yt[k], label, v => { yt[k] = v; set({ youtube: yt }); }, locked);
    add(section('Чистка YouTube', 'Работает на уровнях, где включена «Чистка YouTube». Поиск и подписки остаются.', h('div.card', h('div.set-grid',
      ytRow('shorts', 'Убрать Shorts'), ytRow('home', 'Пустая главная'), ytRow('sidebar', 'Без похожих видео'),
      ytRow('endscreen', 'Без заставок в конце'), ytRow('comments', 'Скрыть комментарии'), ytRow('autoplay', 'Без автозапуска следующего'),
      ytRow('notif', 'Скрыть колокольчик')))));

    add(dataSection(), updatesSection());

    add(section('Общие', null, card(
      toggle(st.alwaysClean, 'Чистить YouTube и кликбейт всегда', v => set({ alwaysClean: v }), locked, 'даже вне сессии, без блокировки сайтов'),
      toggle(st.launchAtLogin, `Запускать вместе с ${DW.os().name}`, v => set({ launchAtLogin: v }), locked, `сразу в ${DW.os().tray}, без окна`),
      h('div.row', h('span.muted', 'Ярлык'), h('button.btn.sm', {
        onclick: async () => {
          const made = await window.dw.call('shortcut:create');
          DW.toast(made && made.length ? (DW.state.platform === 'darwin' ? 'Deepwork добавлен в Программы — ищи в Launchpad и Spotlight' : 'Ярлык создан на рабочем столе и в меню «Пуск»') : 'Не получилось создать ярлык', !(made && made.length));
        },
      }, DW.state.platform === 'darwin' ? 'Добавить в Программы' : 'Создать на рабочем столе и в «Пуске»')),
      h('div.row', h('span.muted', 'Первый запуск'), h('button.btn.sm', { onclick: () => DW.onboarding() }, 'Показать мастер настройки снова')))));

    if (ext.connected) add(extSection);

    // section menu: built from the sections actually rendered
    const menu = h('nav.set-nav', [...content.querySelectorAll('[data-sec]')].map(sec => h('button', {
      onclick: () => sec.scrollIntoView({ behavior: 'smooth', block: 'start' }),
    }, sec.dataset.sec)));
    root.append(h('div.view-head', h('h1', 'Настройки'), h('span.sub', 'Ctrl+K — быстрый поиск по разделам')), h('div.set-layout', menu, content));

    if (DW.settingsFocus) {
      const key = DW.settingsFocus.replace(/^sec-/, '');
      const el = content.querySelector('#' + CSS.escape(key)) || [...content.querySelectorAll('[data-sec]')].find(x => x.dataset.sec === key);
      DW.settingsFocus = null;
      if (el) setTimeout(() => el.scrollIntoView({ behavior: 'smooth', block: 'start' }), 60);
    }
  }

  DW.views.settings = { render, title: 'Настройки' };
})();
