// Cross-view features: achievements, morning ritual, first-run wizard, command palette, scheduled-session prompt.
(function () {
  const { h } = DW;

  // ---------------------------------------------------------------- achievements
  // test(ctx) → true when earned; ctx is computed once per check from the data
  const ACH = [
    { id: 'first', title: 'Первая сессия', desc: 'Начало положено', test: c => c.sessions >= 1 },
    { id: 'h10', title: '10 часов фокуса', desc: 'Первые десять часов глубокой работы', test: c => c.hours >= 10 },
    { id: 'h50', title: '50 часов', desc: 'Это уже привычка', test: c => c.hours >= 50 },
    { id: 'h100', title: '100 часов', desc: 'Сотня часов без отвлечений', test: c => c.hours >= 100 },
    { id: 'h500', title: '500 часов', desc: 'Уровень мастерства', test: c => c.hours >= 500 },
    { id: 's7', title: 'Неделя подряд', desc: '7 дней с выполненной нормой', test: c => c.bestStreak >= 7 },
    { id: 's30', title: 'Месяц подряд', desc: '30 дней с выполненной нормой', test: c => c.bestStreak >= 30 },
    { id: 's100', title: '100 дней', desc: 'Сто дней подряд — редкость', test: c => c.bestStreak >= 100 },
    { id: 'deep3', title: 'Три часа в потоке', desc: 'Одна сессия длиной 3 часа', test: c => c.longest >= 180 },
    { id: 'early', title: 'Ранняя птица', desc: 'Фокус до 7 утра', test: c => c.early },
    { id: 'clean', title: 'Ни одной попытки', desc: 'Час фокуса без попыток отвлечься', test: c => c.cleanHour },
    { id: 'monk', title: 'Монах', desc: 'Сессия на уровне «Монах» до конца', test: c => c.monk },
    { id: 'tasks50', title: '50 задач', desc: 'Пятьдесят выполненных задач', test: c => c.tasksDone >= 50 },
    { id: 'routine30', title: 'Рутина', desc: '30 отметок рутины', test: c => c.routineMarks >= 30 },
    { id: 'journal7', title: 'Рефлексия', desc: '7 дней в журнале', test: c => c.journalDays >= 7 },
    { id: 'park10', title: 'Парковщик', desc: '10 мыслей отложено, а не прожито', test: c => c.parked >= 10 },
  ];
  DW.ACHIEVEMENTS = ACH;

  function achContext() {
    const st = DW.state;
    const by = DW.focusByDay();
    let best = 0, cur = 0;
    const days = Object.keys(by).sort();
    if (days.length) for (let d = days[0]; d <= DW.today(); d = DW.addDays(d, 1)) {
      if (DW.metGoal(by, d)) cur++; else if (DW.goalFor(d) > 0 && d !== DW.today()) cur = 0;
      best = Math.max(best, cur);
    }
    const ss = st.sessions;
    const attempts = s => Object.values(s.attempts.sites).concat(Object.values(s.attempts.apps)).reduce((a, b) => a + b, 0);
    return {
      sessions: ss.length,
      hours: ss.reduce((a, s) => a + s.focusMs, 0) / 3600000,
      bestStreak: best,
      longest: Math.max(0, ...ss.map(s => s.focusMs / 60000)),
      early: ss.some(s => new Date(s.start).getHours() < 7 && s.focusMs >= 20 * 60000),
      cleanHour: ss.some(s => s.result === 'done' && s.focusMs >= 60 * 60000 && !attempts(s)),
      monk: ss.some(s => s.level === 4 && s.result === 'done'),
      tasksDone: st.tasks.filter(t => t.done).length,
      routineMarks: Object.values(st.routineLog).reduce((a, l) => a + l.length, 0),
      journalDays: Object.entries(st.journal).filter(([k, e]) => !k.startsWith('week') && (e.mood || e.wins || e.text)).length,
      parked: st.tasks.filter(t => t.parked).length,
    };
  }

  DW.checkAchievements = () => {
    const have = DW.state.achievements || {};
    const c = achContext();
    const fresh = ACH.filter(a => !have[a.id] && a.test(c)).map(({ id, title, desc }) => ({ id, title, desc }));
    if (fresh.length) window.dw.call('achievements:unlock', fresh);
  };

  // ---------------------------------------------------------------- morning ritual
  // Once a day, when Deepwork is first opened: pick up to three main things.
  DW.maybeMorning = () => {
    const st = DW.state;
    const r = st.settings.rituals;
    const today = DW.today();
    if (!r.morning || r.lastMorning === today || st.session || new Date().getHours() < 4 || !st.settings.onboarded) return;
    if (document.querySelector('.modal')) return;
    DW.morning();
  };

  DW.morning = () => {
    const st = DW.state;
    const today = DW.today();
    const finish = () => window.dw.call('settings:set', { rituals: { ...st.settings.rituals, lastMorning: today } });
    const pool = [
      ...st.tasks.filter(t => !t.done && t.date && t.date <= today),
      ...st.tasks.filter(t => !t.done && !t.date).slice(0, 8),
    ];
    const chosen = new Set(st.tasks.filter(t => t.top === today).map(t => t.id));
    DW.modal((m, close) => {
      close.onclose = finish;
      const list = h('div.col', { style: { gap: '4px', maxHeight: '300px', overflow: 'auto' } });
      const paint = () => {
        list.innerHTML = '';
        if (!pool.length) list.append(h('div.empty', 'Задач нет — добавь главную ниже'));
        pool.forEach(t => list.append(h('button.mpick' + (chosen.has(t.id) ? '.on' : ''), {
          onclick: () => { if (chosen.has(t.id)) chosen.delete(t.id); else if (chosen.size < 3) chosen.add(t.id); else DW.toast('Главных — не больше трёх'); paint(); },
        }, h('span.check' + (chosen.has(t.id) ? '.on' : '')), h('span', { style: { flex: 1 } }, t.title),
          h('span.dim', { style: { fontSize: '12px' } }, !t.date ? 'бэклог' : t.date < today ? 'просрочено' : 'сегодня'))));
      };
      paint();
      const add = h('input.input', {
        placeholder: 'Ещё одна главная задача — Enter', onkeydown: async e => {
          if (e.key !== 'Enter' || !add.value.trim()) return;
          const t = await window.dw.call('tasks:save', { title: add.value.trim(), date: today, done: false, prio: 1, est: 0, time: '', goalId: null, notes: '' });
          pool.unshift(t); if (chosen.size < 3) chosen.add(t.id); add.value = ''; paint();
        },
      });
      const routines = DW.routinesFor(today);
      const events = DW.eventsOn ? DW.eventsOn(today) : [];
      const goal = DW.goalFor(today);
      m.classList.add('wide');
      m.append(h('h2', 'Доброе утро'),
        h('p', `${DW.longDate(today)}. Норма — ${goal ? DW.dur(goal) : 'выходной'}. Выбери до трёх главных дел: они будут наверху весь день.`),
        list, add,
        routines.length || events.length ? h('div.hint', [
          routines.length ? `Рутина: ${routines.map(r => r.title).join(', ')}` : null,
          events.length ? `Календарь: ${events.map(e => (e.allDay ? '' : DW.hhmm(e.start) + ' ') + e.title).join(', ')}` : null,
        ].filter(Boolean).join(' · ')) : null,
        h('div.acts',
          h('button.btn.ghost', { onclick: () => close() }, 'Пропустить сегодня'),
          h('button.btn.primary', {
            onclick: async () => {
              for (const t of st.tasks.filter(x => x.top === today && !chosen.has(x.id))) await window.dw.call('tasks:save', { id: t.id, top: null });
              for (const id of chosen) await window.dw.call('tasks:save', { id, top: today, date: today });
              close();
            },
          }, 'Начать день')));
    });
  };

  // ---------------------------------------------------------------- first run
  DW.onboarding = () => {
    let step = 0;
    const isMac = DW.state.platform === 'darwin';
    const st = DW.state.settings;
    const draft = { goal: st.dailyGoalMin, level: st.level };
    const steps = [
      () => [h('h2', 'Добро пожаловать в Deepwork'),
        h('p', 'Режим полного фокуса: таймер, блокировка отвлечений, план и журнал. Настройка займёт минуту.'),
        h('ul.insights', h('li', 'Глушит уведомления и закрывает то, что отвлекает'), h('li', 'Чистит браузер: Shorts, ленты, кликбейт'), h('li', 'Ведёт план, рутины и честную статистику'))],
      () => [h('h2', 'Твоя норма'),
        h('p', 'Сколько минут глубокой работы в день — это «выполненный день». Можно поменять в любой момент.'),
        h('div.row.wrap', { style: { gap: '6px' } }, [60, 90, 120, 180, 240].map(v => h('button.chip' + (draft.goal === v ? '.on' : ''), { onclick: () => { draft.goal = v; paint(); } }, DW.dur(v)))),
        h('div.label', { style: { marginTop: '6px' } }, 'Уровень по умолчанию'),
        h('div.row.wrap', { style: { gap: '6px' } }, [1, 2, 3, 4].map(n => h('button.chip' + (draft.level === n ? '.on' : ''), { onclick: () => { draft.level = n; paint(); } }, DW.levelCfg(n).name)))],
      () => {
        const ext = DW.state.ext || {};
        return [h('h2', 'Расширение для Brave'),
          h('p', 'Без него не будет блокировки сайтов, чистки YouTube и закрытия вкладок.'),
          h('ol.steps', h('li', 'Открой ', h('code', 'brave://extensions'), ' и включи «Режим разработчика»'),
            h('li', '«Загрузить распакованное» → ', h('button.btn.sm', { onclick: () => window.dw.call('open:path', DW.state.extPath) }, 'папка расширения')),
            h('li', 'В «Сведениях» включи «Разрешить в приватном режиме»')),
          h('div.row', h('span.stat-dot.' + (ext.connected ? 'ok' : 'bad')), ext.connected ? 'Подключено' : 'Ждём подключения… (можно сделать позже)')];
      },
      ...(isMac ? [() => [h('h2', '«Не беспокоить» на Mac'),
        h('p', 'Создай в «Командах» две команды с действием «Фокусирование»: Deepwork Focus On (включить «Не беспокоить») и Deepwork Focus Off (выключить). Подробно — в Настройках.')]] : []),
      () => [h('h2', 'Последний штрих'),
        h('div.col', { style: { gap: '12px' } },
          h('div.row', h('button.btn.sm', { onclick: async () => { const r = await window.dw.call('shortcut:create'); DW.toast(r && r.length ? 'Ярлык создан' : 'Не получилось', !(r && r.length)); } }, 'Создать ярлык'),
            h('span.muted', isMac ? 'в «Программах»' : 'на рабочем столе и в «Пуске»')),
          h('div.row', DW.switchEl(!!st.launchAtLogin, v => window.dw.call('settings:set', { launchAtLogin: v })), 'Запускать вместе с ' + DW.os().name),
          h('div.hint', 'Горячие клавиши: Ctrl+Alt+Space — запарковать мысль, Ctrl+Alt+F — начать фокус, Ctrl+K в окне — все команды.'))],
    ];
    let box, closeFn;
    const paint = () => {
      box.innerHTML = '';
      box.append(...steps[step](),
        h('div.row', { style: { marginTop: '8px' } },
          h('div.pips', steps.map((_, i) => h('i' + (i <= step ? '.on' : '')))),
          h('div.spacer'),
          step ? h('button.btn.ghost', { onclick: () => { step--; paint(); } }, 'Назад') : h('button.btn.ghost', { onclick: () => done() }, 'Пропустить'),
          h('button.btn.primary', { onclick: () => step < steps.length - 1 ? (step++, paint()) : done() }, step < steps.length - 1 ? 'Дальше' : 'Готово')));
    };
    const done = async () => {
      await window.dw.call('settings:set', { dailyGoalMin: draft.goal, level: draft.level, onboarded: true });
      closeFn.sticky = false;
      closeFn();
    };
    DW.modal((m, close) => { box = m; closeFn = close; close.sticky = true; m.classList.add('wide'); paint(); });
    // live extension status while the wizard is open
    DW.onboardingRepaint = () => { if (box && document.body.contains(box)) paint(); };
  };

  // ---------------------------------------------------------------- command palette (Ctrl+K)
  function commands() {
    const st = DW.state;
    const s = st.session;
    const list = [
      ['Фокус', 'Перейти', () => DW.go('focus')], ['План', 'Перейти', () => DW.go('plan')], ['Журнал', 'Перейти', () => DW.go('journal')],
      ['Статистика', 'Перейти', () => DW.go('stats')], ['Блокировки', 'Перейти', () => DW.go('blocks')], ['Настройки', 'Перейти', () => DW.go('settings')],
      ['Запарковать мысль', 'Ctrl+Alt+Space', () => window.dw.call('capture:show')],
      ['Утренний план', 'Ритуал', () => DW.morning()],
      ['Итог дня в журнале', 'Журнал', () => { DW.journalDate = DW.today(); DW.go('journal'); }],
      ['Таймер на рабочем столе', st.settings.widget.enabled ? 'выключить' : 'включить', () => window.dw.call('settings:set', { widget: { ...st.settings.widget, enabled: !st.settings.widget.enabled } })],
    ];
    if (!s) {
      st.settings.templates.forEach(t => list.push([`Начать: ${t.name}`, 'Шаблон', () => window.dw.call('session:template', t.id)]));
      [25, 50, 90].forEach(m => list.push([`Фокус ${m} минут`, 'Старт', () => window.dw.call('session:start', { mode: 'custom', custom: m })]));
    } else {
      list.push(['+5 минут', 'Сессия', () => window.dw.call('session:extend', 5)]);
      if (s.canPause) list.push([s.status === 'paused' ? 'Продолжить' : 'Пауза', 'Сессия', () => window.dw.call(s.status === 'paused' ? 'session:resume' : 'session:pause')]);
      list.push(['Дзен-режим', 'Полный экран', () => DW.zen(true)]);
    }
    ['Рабочие наборы', 'Расписание', 'Лимиты сайтов', 'Звуки', 'Telegram', 'Телефон', 'Данные', 'Обновления'].forEach(sec =>
      list.push([`Настройки: ${sec}`, 'Перейти', () => { DW.settingsFocus = 'sec-' + sec; DW.go('settings'); }]));
    return list;
  }

  DW.palette = () => {
    if (document.querySelector('.palette')) return;
    DW.modal((m, close) => {
      m.classList.add('palette');
      let sel = 0, items = [];
      const list = h('div.pal-list');
      const inp = h('input.input.pal-in', { placeholder: 'Команда или раздел…' });
      const paint = () => {
        const q = inp.value.trim().toLowerCase();
        items = commands().filter(([t, k]) => !q || (t + ' ' + k).toLowerCase().includes(q)).slice(0, 12);
        sel = Math.min(sel, Math.max(0, items.length - 1));
        list.innerHTML = '';
        items.forEach(([t, k, f], i) => list.append(h('button.pal-item' + (i === sel ? '.on' : ''), { onmouseenter: () => { sel = i; paint(); }, onclick: () => { close(); f(); } }, h('span', t), h('span.dim', k))));
        if (!items.length) list.append(h('div.empty', 'Ничего не найдено'));
      };
      inp.addEventListener('input', () => { sel = 0; paint(); });
      inp.addEventListener('keydown', e => {
        if (e.key === 'ArrowDown') { sel = Math.min(items.length - 1, sel + 1); paint(); e.preventDefault(); }
        if (e.key === 'ArrowUp') { sel = Math.max(0, sel - 1); paint(); e.preventDefault(); }
        if (e.key === 'Enter' && items[sel]) { close(); items[sel][2](); }
      });
      m.append(inp, list);
      paint();
    });
  };

  document.addEventListener('keydown', e => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); DW.palette(); }
    if (e.key === 'Escape' && document.body.classList.contains('zen')) DW.zen(false);
  });

  // ---------------------------------------------------------------- zen mode
  DW.zen = on => {
    document.body.classList.toggle('zen', on);
    window.dw.call('win:zen', on);
    if (DW.view !== 'focus') DW.go('focus'); else DW.render();
  };

  // ---------------------------------------------------------------- scheduled session prompt
  DW.schedulePrompt = it => {
    DW.modal((m, close) => {
      m.append(h('h2', 'Запланированный фокус'),
        h('p', `${it.name || 'Сессия'} · ${DW.dur(it.minutes)} · ${DW.levelCfg(it.level || DW.state.settings.level).name}`),
        h('div.acts', h('button.btn', { onclick: () => close() }, 'Пропустить'),
          h('button.btn.primary', { onclick: () => { close(); window.dw.call('session:start', { mode: 'custom', custom: it.minutes, level: it.level, presetId: it.presetId, goal: it.name }); } }, 'Начать')));
    });
  };
})();
