// Focus view: session setup when idle, big ring timer while running, friction exit.
(function () {
  const { h } = DW;
  const draft = { goal: '', taskId: null, mode: null, level: null, presetId: undefined };
  const liveFocusMin = s => DW.liveFocusMin(s);
  const AMBIENT = [['off', 'Тишина'], ['brown', 'Коричневый шум'], ['pink', 'Розовый шум'], ['rain', 'Дождь'], ['waves', 'Прибой'], ['binaural', 'Бинауральный']];
  DW.AMBIENT = AMBIENT;
  let tickTimer = null;

  // card bullets come from the level's actual config, so they stay true after edits in Settings
  function levelPoints(L) {
    const p = [];
    p.push({ warn: 'сайты: предупреждение', block: 'сайты из списка закрыты', whitelist: 'только сайты из белого списка', off: 'сайты не трогаются' }[L.sites]);
    if (L.apps === 'block') p.push('программы из списка закрываются');
    if (L.apps === 'whitelist') p.push('только программы из белого списка');
    if (L.hosts) p.push('блок во всех браузерах');
    else if (L.onlyBrave) p.push('другие браузеры закрываются');
    // the pause / break rule only if there is room: cards stay short
    if (p.length < 3) p.push(L.pause ? 'можно ставить паузу' : !L.breakUnlock ? 'в перерыв блоки не снимаются' : 'в перерыв блоки снимаются');
    p.push(exitText(L.exit));
    return p;
  }
  const waitText = w => w >= 60 ? `${Math.round(w / 60)} мин` : `${w} с`;
  function exitText(e) {
    if (e.type === 'confirm') return e.wait ? `выход через ${waitText(e.wait)}` : 'выйти можно в любой момент';
    if (e.type === 'phrase') return e.wait ? `выход: фраза и ${waitText(e.wait)}` : 'выход: ввести фразу';
    return `аварийный выход: ${waitText(e.wait)}`;
  }
  const pips = n => DW.h('div.pips', [1, 2, 3, 4].map(i => DW.h('i' + (i <= n ? '.on' : ''))));
  DW.pips = pips;

  function render(root) {
    clearInterval(tickTimer);
    const s = DW.state.session;
    root.append(s ? running(s) : setup());
  }

  // ---------------------------------------------------------------- idle
  function setup() {
    const st = DW.state.settings;
    const t = st.timer;
    if (draft.mode == null) draft.mode = t.mode;
    if (draft.level == null) draft.level = st.level;
    if (draft.presetId === undefined || (draft.presetId && !st.presets.some(p => p.id === draft.presetId))) draft.presetId = st.presets.some(p => p.id === st.lastPreset) ? st.lastPreset : null;
    const today = DW.today();
    const todays = DW.state.tasks.filter(x => x.date === today && !x.done);

    const goalIn = h('input.input.goal-input', {
      placeholder: 'Над чем работаешь?', value: draft.goal,
      oninput: e => { draft.goal = e.target.value; draft.taskId = null; paintChips(); },
      onkeydown: e => { if (e.key === 'Enter') start(); },
    });
    const chips = h('div.row.wrap', { style: { gap: '6px', marginTop: '10px' } });
    function paintChips() {
      chips.innerHTML = '';
      todays.slice(0, 8).forEach(tk => chips.append(h('button.chip' + (draft.taskId === tk.id ? '.on' : ''), {
        onclick: () => { draft.goal = tk.title; draft.taskId = tk.id; goalIn.value = tk.title; paintChips(); },
      }, tk.title)));
      if (!todays.length) chips.append(h('span.hint', 'Здесь появятся задачи на сегодня из «Плана»'));
    }
    paintChips();

    const params = h('div.params');
    const summary = h('div.muted');
    const num = (key, label, min, max) => h('div.param', h('span.label', label),
      h('input.input.num-in.num', {
        type: 'number', min, max, value: t[key],
        onchange: e => { const v = Math.min(max, Math.max(min, Math.round(+e.target.value || min))); e.target.value = v; t[key] = v; saveTimer(); paintSummary(); },
      }));
    function paintParams() {
      params.innerHTML = '';
      if (draft.mode === 'pomodoro') params.append(num('focus', 'Фокус, мин', 5, 180), num('short', 'Перерыв', 1, 60), num('long', 'Длинный', 1, 90), num('rounds', 'Раундов', 1, 12));
      else if (draft.mode === 'custom') {
        params.append(num('custom', 'Длительность, мин', 5, 480),
          h('div.row', { style: { gap: '6px', paddingBottom: '6px' } }, [25, 50, 90, 120, 180].map(m => h('button.chip' + (t.custom === m ? '.on' : ''), {
            onclick: () => { t.custom = m; saveTimer(); paintParams(); paintSummary(); },
          }, DW.durShort(m)))));
      } else params.append(h('div.muted', { style: { maxWidth: '500px', fontSize: '13px' } }, 'Без таймера: работаешь, пока идёт. Перерыв — 1/5 отработанного времени. После 25 минут сессия засчитывается как завершённая.'));
    }
    function paintSummary() {
      let min = 0;
      if (draft.mode === 'pomodoro') {
        min = t.focus * t.rounds;
        for (let r = 1; r < t.rounds; r++) min += r % (t.longEvery || 4) === 0 ? t.long : t.short;
      } else if (draft.mode === 'custom') min = t.custom;
      summary.textContent = min ? `${DW.dur(min)} · до ${DW.hhmm(Date.now() + min * 60000)}` : 'Без ограничения по времени';
    }
    let saveT;
    function saveTimer() { clearTimeout(saveT); saveT = setTimeout(() => window.dw.call('settings:set', { timer: { ...t } }), 400); }

    const modeSeg = h('div.seg', [['pomodoro', 'Помодоро'], ['custom', 'Таймер'], ['flow', 'Поток']].map(([k, l]) =>
      h('button' + (draft.mode === k ? '.on' : ''), { onclick: e => { draft.mode = k; t.mode = k; saveTimer(); [...e.target.parentNode.children].forEach(b => b.classList.toggle('on', b === e.target)); paintParams(); paintSummary(); } }, l)));

    const levels = h('div.levels', [1, 2, 3, 4].map(n => {
      const L = DW.levelCfg(n);
      return h('button.lvl' + (draft.level === n ? '.on' : ''), {
        style: { '--c': `var(--l${n})` },
        onclick: e => { draft.level = n; levels.querySelectorAll('.lvl').forEach(b => b.classList.toggle('on', b === e.currentTarget)); },
      }, pips(n), h('span.t', L.name), h('ul', levelPoints(L).map(p => h('li', p))));
    }));

    paintParams(); paintSummary();

    const templates = st.templates;
    const tplRow = templates.length ? h('div', h('div.lbl', 'Быстрый старт'), h('div.row.wrap', { style: { gap: '6px' } },
      templates.map(tp => h('button.chip.tpl', {
        title: `${tp.mode === 'pomodoro' ? 'помодоро' : DW.dur(tp.minutes || 0)} · ${DW.levelCfg(tp.level || st.level).name}`,
        onclick: () => DW.call('session:template', tp.id, draft.goal.trim() ? { goal: draft.goal.trim(), taskId: draft.taskId } : {}),
      }, DW.svg(DW.icons.play, ''), tp.name)))) : null;

    const left = h('div.card.setup',
      tplRow,
      h('div', h('div.lbl', 'Цель сессии'), goalIn, chips),
      h('div', h('div.lbl', 'Режим'), h('div.row.wrap', { style: { gap: '18px', alignItems: 'flex-end' } }, modeSeg, params)),
      h('div', h('div.lbl', 'Уровень'), levels),
      presetRow(),
      ambientRow(),
      h('div.start-row', h('button.btn.primary.big', { onclick: start }, DW.svg(DW.icons.play, ''), 'Начать фокус'), summary,
        h('div.spacer'), h('a.link', { style: { fontSize: '12.5px' }, title: 'Текущий режим, уровень и набор — в один клик', onclick: saveTemplate }, 'Сохранить как шаблон')));

    return h('div',
      h('div.view-head', h('h1', greeting()), h('span.sub', DW.longDate(DW.today()))),
      h('div.focus-grid.stagger', left, rightColumn(null)));
  }

  function greeting() {
    const hr = new Date().getHours();
    return hr < 5 ? 'Доброй ночи' : hr < 12 ? 'Доброе утро' : hr < 18 ? 'Добрый день' : 'Добрый вечер';
  }

  async function start() {
    const lvl = draft.level;
    const preview = await window.dw.call('session:preview', lvl, draft.presetId);
    if (preview && preview.length) {
      const ok = await DW.confirm('Будут закрыты программы', `${preview.map(p => p.name).join(', ')}. Сохрани работу в них, если нужно.`, 'Начать');
      if (!ok) return;
    }
    const L = DW.levelCfg(lvl);
    if (L.hosts) DW.toast(DW.os().admin + ' — это для блокировки сайтов во всех браузерах');
    const r = await DW.call('session:start', { mode: draft.mode, level: lvl, goal: draft.goal.trim(), taskId: draft.taskId, presetId: draft.presetId });
    if (r && r.ok) { draft.goal = ''; draft.taskId = null; }
  }

  function saveTemplate() {
    const t = DW.state.settings.timer;
    DW.modal((m, close) => {
      const name = h('input.input', { placeholder: 'Например: Код 90', value: draft.goal || '' });
      const save = async () => {
        if (!name.value.trim()) return name.focus();
        const tp = { id: Math.random().toString(36).slice(2, 10), name: name.value.trim(), mode: draft.mode, level: draft.level, presetId: draft.presetId || null,
          minutes: draft.mode === 'custom' ? t.custom : null, focus: t.focus, short: t.short, long: t.long, rounds: t.rounds };
        await DW.call('settings:set', { templates: [...DW.state.settings.templates, tp] });
        close();
        DW.toast('Шаблон сохранён — он появится в «Быстром старте», в трее и на телефоне');
      };
      name.addEventListener('keydown', e => e.key === 'Enter' && save());
      m.append(h('h2', 'Новый шаблон'), h('p', 'Сохранит режим, длительность, уровень и рабочий набор.'), name,
        h('div.acts', h('button.btn', { onclick: () => close() }, 'Отмена'), h('button.btn.primary', { onclick: save }, 'Сохранить')));
    });
  }

  // background sound during focus (generated by Deepwork, no files)
  function ambientRow() {
    const a = DW.state.settings.ambient;
    const row = h('div.row.wrap', { style: { gap: '6px' } }, AMBIENT.map(([k, l]) => h('button.chip' + (a.kind === k ? '.on' : ''), {
      onclick: () => { window.dw.call('settings:set', { ambient: { ...a, kind: k } }); if (k !== 'off') window.dw.call('ambient:preview', k, a.volume); },
    }, l)));
    return h('div', h('div.lbl', 'Звук в фокусе'), row);
  }

  // ---------------------------------------------------------------- right column
  // which work preset opens with the session
  function presetRow() {
    const presets = DW.state.settings.presets;
    const row = h('div.row.wrap', { style: { gap: '6px' } });
    const paint = () => {
      row.innerHTML = '';
      row.append(h('button.chip' + (!draft.presetId ? '.on' : ''), { onclick: () => { draft.presetId = null; paint(); } }, 'Ничего не открывать'));
      presets.forEach(p => row.append(h('button.chip' + (draft.presetId === p.id ? '.on' : ''), {
        title: [...p.apps.map(a => a.name), ...p.urls].join(', ') || 'пустой набор',
        onclick: () => { draft.presetId = p.id; paint(); },
      }, p.name)));
      row.append(h('a.link', { style: { fontSize: '12.5px', marginLeft: '6px' }, onclick: () => { DW.settingsFocus = 'presets'; DW.go('settings'); } }, presets.length ? 'Настроить наборы' : 'Создать рабочий набор'));
    };
    paint();
    return h('div', h('div.lbl', 'Открыть при старте'), row);
  }

  function editNorm() {
    const st = DW.state.settings;
    const dow = DW.dowOf(DW.today());
    const byDow = [...(st.goalByDow || [null, null, null, null, null, null, null])];
    DW.modal((m, close) => {
      const common = h('input.input.num-in', { type: 'number', min: 15, max: 960, step: 15, value: st.dailyGoalMin });
      const today = h('input.input.num-in', { type: 'number', min: 0, max: 960, step: 15, value: byDow[dow] == null ? '' : byDow[dow], placeholder: '—' });
      const save = async () => {
        byDow[dow] = today.value === '' ? null : Math.max(0, Math.min(960, +today.value));
        await DW.call('settings:set', { dailyGoalMin: Math.max(15, Math.min(960, +common.value || 120)), goalByDow: byDow });
        close();
      };
      m.append(h('h2', 'Дневная норма'),
        h('p', 'Сколько минут фокуса в день считается выполненной нормой. Серия дней растёт, только когда норма выполнена.'),
        h('div.form', h('span.label', 'Обычно, мин'), common, h('span.label', DW.DOW_FULL[(dow + 1) % 7] + ', мин'), today),
        h('div.hint', 'Пусто — как обычно, 0 — выходной (серия не прерывается). Другие дни недели — в «Настройках».'),
        h('div.acts', h('button.btn', { onclick: () => close() }, 'Отмена'), h('button.btn.primary', { onclick: save }, 'Сохранить')));
    });
  }

  function rightColumn(s) {
    const st = DW.state;
    const today = DW.today();
    const by = DW.focusByDay();
    const live = s ? liveFocusMin(s) : 0;
    const done = (by[today] || 0) + live;
    const goal = DW.goalFor(today);
    const pct = goal ? Math.min(1, done / goal) : 1;
    const R = 30, C = 2 * Math.PI * R;
    const ring = DW.svg(`<circle cx="36" cy="36" r="${R}" fill="none" stroke="rgba(255,255,255,.07)" stroke-width="7"/>
      <circle class="prog" cx="36" cy="36" r="${R}" fill="none" stroke="#e8ecff" stroke-width="7" stroke-linecap="round" stroke-dasharray="${C}" stroke-dashoffset="${C * (1 - pct)}" transform="rotate(-90 36 36)"/>`);
    ring.setAttribute('viewBox', '0 0 72 72');
    ring.setAttribute('style', 'width:72px;height:72px;flex:none');
    const streak = DW.streak();

    const todayCard = h('div.card',
      h('h3', 'Сегодня'),
      h('div.today-ring', ring, h('div',
        h('div', { style: { font: '600 22px var(--font)', letterSpacing: '-.02em' } }, h('span.num', DW.dur(done)),
          h('a.link', { style: { fontSize: '14px', fontWeight: 400, marginLeft: '6px', color: 'var(--muted)' }, title: 'Изменить норму', onclick: editNorm }, goal ? 'из ' + DW.dur(goal) : 'выходной')),
        h('div.muted', { style: { fontSize: '12.5px' } }, !goal ? 'Сегодня без нормы' : done >= goal ? 'Норма на сегодня выполнена' : streak ? `Серия ${DW.count(streak, 'день', 'дня', 'дней')} — не прерывай` : 'Выполни норму, чтобы начать серию дней'))));

    const tasks = st.tasks.filter(t => t.date === today).sort((a, b) => a.done - b.done || (a.time || '99').localeCompare(b.time || '99') || a.prio - b.prio);
    const routines = DW.routinesFor(today);
    const routineRows = routines.map(r => {
      const on = DW.routineDone(today, r.id);
      const ic = DW.svg(DW.icons.repeat, '');
      ic.setAttribute('style', 'width:13px;height:13px;stroke:currentColor;fill:none;stroke-width:1.8');
      return h('div.mini-task' + (on ? '.done' : ''),
        h('button.check' + (on ? '.on' : ''), { onclick: () => window.dw.call('routines:toggle', today, r.id) }),
        h('span.tt', r.title),
        h('span.dim', { title: 'Рутина', style: { display: 'grid' } }, ic),
        r.time ? h('span.dim.num', { style: { fontSize: '12px' } }, r.time) : null);
    });
    const top = tasks.filter(t => t.top === today);
    const rest = tasks.filter(t => t.top !== today);
    tasks.length = 0; tasks.push(...top, ...rest);
    const planCard = h('div.card', h('div.row', h('h3', { style: { margin: 0 } }, top.length ? 'Главное и план' : 'План на сегодня'), h('div.spacer'),
      h('button.btn.ghost.sm', { onclick: () => DW.go('plan') }, 'Открыть план')),
      h('div', { style: { marginTop: '8px' } }, tasks.length ? tasks.map(t => h('div.mini-task' + (t.done ? '.done' : ''),
        h('button.check' + (t.done ? '.on' : ''), { onclick: () => window.dw.call('tasks:save', { id: t.id, done: !t.done, doneAt: !t.done ? Date.now() : null }) }),
        h('span.tt', t.title),
        t.time ? h('span.dim.num', { style: { fontSize: '12px' } }, t.time) : null,
        !s && !t.done ? DW.iconBtn('play', 'Фокус на этой задаче', () => { draft.goal = t.title; draft.taskId = t.id; DW.render(); }) : null,
      )) : (routines.length ? null : h('div.empty', 'На сегодня ничего не запланировано')), routineRows,
      !top.length && !s ? h('a.link', { style: { fontSize: '12.5px', display: 'inline-block', marginTop: '8px' }, onclick: () => DW.morning() }, 'Выбрать главное на сегодня') : null));
    // star marks the day's main tasks
    planCard.querySelectorAll('.mini-task').forEach((el, i) => { if (i < top.length) el.classList.add('top'); });

    return h('div.col', { style: { gap: '16px' } }, todayCard, protectionCard(s), planCard);
  }

  function protectionCard(s) {
    const st = DW.state;
    const ext = st.ext || {};
    const en = st.enforce || {};
    const L = DW.levelCfg(s ? s.level : (draft.level || st.settings.level));
    const dot = c => h('span.stat-dot.' + c);
    const rows = [];
    rows.push(h('div.prot', dot(!ext.connected ? 'bad' : ext.incognito ? 'ok' : 'warn'), 'Расширение Brave', h('span.v', ext.connected ? (ext.incognito ? 'подключено' : 'не в приватных окнах') : h('a.link', { onclick: () => DW.go('settings') }, 'установить'))));
    if (s) {
      const dndOff = DW.state.platform === 'darwin' ? h('a.link', { onclick: () => { DW.settingsFocus = 'mac-focus'; DW.go('settings'); } }, 'нужны ярлыки') : 'частично';
      if (L.dnd) rows.push(h('div.prot', dot(en.dnd ? 'ok' : en.dnd === false ? 'warn' : ''), '«Не беспокоить»', h('span.v', en.dnd ? 'включено' : en.dnd === false ? dndOff : '…')));
      if (L.hosts) rows.push(h('div.prot', dot(en.hosts ? 'ok' : en.hosts === false ? 'bad' : ''), 'Все браузеры (hosts)', h('span.v', en.hosts ? 'включено' : en.hosts === false ? 'нет прав админа' : '…')));
      if (L.apps !== 'off' || L.onlyBrave) rows.push(h('div.prot', dot(en.apps === 'on' ? 'ok' : 'warn'), 'Контроль программ', h('span.v', en.apps === 'on' ? (L.apps === 'whitelist' ? 'белый список' : 'следит') : 'пауза')));
      const sites = Object.entries(s.attempts.sites), apps = Object.entries(s.attempts.apps);
      const total = [...sites, ...apps].reduce((a, [, n]) => a + n, 0);
      rows.push(h('div.prot', dot(total ? 'warn' : 'ok'), 'Попыток отвлечься', h('span.v.num', String(total))));
      if (s.idleMs >= 60000) rows.push(h('div.prot', dot('warn'), 'Простой не засчитан', h('span.v.num', DW.dur(s.idleMs / 60000))));
      if (s.parked) rows.push(h('div.prot', dot('ok'), 'Мыслей на парковке', h('span.v.num', String(s.parked))));
      [...sites, ...apps].sort((a, b) => b[1] - a[1]).slice(0, 4).forEach(([k, n]) => rows.push(h('div.prot.sub', k, h('span.v.num', '×' + n))));
    } else {
      rows.push(h('div.prot', dot(''), '«Не беспокоить»', h('span.v', L.dnd ? 'включится' : 'нет')));
      rows.push(h('div.prot', dot(''), 'Сайты', h('span.v', { block: 'блок', warn: 'предупреждение', whitelist: 'белый список', off: 'нет' }[L.sites])));
      rows.push(h('div.prot', dot(''), 'Программы', h('span.v', { block: 'закрывать', whitelist: 'белый список', off: L.onlyBrave ? 'только браузеры' : 'нет' }[L.apps])));
    }
    return h('div.card', h('h3', s ? 'Защита' : 'Что включится'), rows);
  }

  // ---------------------------------------------------------------- running

  function running(s) {
    const L = DW.levelCfg(s.level);
    const isBreak = s.phase !== 'focus';
    const R = 165, C = 2 * Math.PI * R;
    const svg = DW.svg(`<circle class="track" cx="180" cy="180" r="${R}" fill="none" stroke-width="10"/>
      <circle class="prog" cx="180" cy="180" r="${R}" fill="none" stroke-width="10" stroke-dasharray="${C}" stroke-dashoffset="0"/>`);
    svg.setAttribute('viewBox', '0 0 360 360');
    const prog = svg.querySelector('.prog');
    const timeEl = h('div.time.num', '');
    const phaseLbl = { focus: 'Фокус', short: 'Перерыв', long: 'Длинный перерыв' }[s.phase];
    const rnd = s.mode === 'pomodoro' ? `раунд ${s.round} из ${s.rounds}` : s.mode === 'flow' ? 'поток' : 'таймер';
    const ring = h('div.ring' + (isBreak ? '.brk' : ''), svg, h('div.center', h('div.phase', phaseLbl), timeEl, h('div.rnd', rnd + ' · ' + L.name.toLowerCase())));

    const next = h('div.muted', { style: { fontSize: '13px' } });
    function tick() {
      const now = s.pausedAt || Date.now();
      if (s.phaseEnd) {
        const left = s.phaseEnd - now, total = s.phaseEnd - s.phaseStart;
        timeEl.textContent = DW.clock(left);
        prog.style.strokeDashoffset = String(C * (1 - Math.max(0, left) / total));
        document.title = `${DW.clock(left)} · ${phaseLbl} — Deepwork`;
      } else {
        timeEl.textContent = DW.clock(now - s.phaseStart);
        prog.style.strokeDashoffset = String(C * (1 - ((now - s.phaseStart) % 3600000) / 3600000));
        document.title = `${DW.clock(now - s.phaseStart)} · Поток — Deepwork`;
      }
      if (s.phaseEnd && !isBreak) {
        const last = s.mode === 'custom' || s.round >= s.rounds;
        const brk = s.round % s.longEvery === 0 ? s.durations.long : s.durations.short;
        next.textContent = last ? `Финиш в ${DW.hhmm(s.phaseEnd)}` : `Дальше перерыв ${brk} мин в ${DW.hhmm(s.phaseEnd)}`;
      } else if (isBreak) next.textContent = `Фокус продолжится в ${DW.hhmm(s.phaseEnd)}`;
    }
    tick();
    tickTimer = setInterval(tick, 1000);

    const ctrls = h('div.controls');
    if (s.status === 'paused') ctrls.append(h('button.btn.primary', { onclick: () => DW.call('session:resume') }, 'Продолжить'));
    else if (s.canPause) ctrls.append(h('button.btn', { onclick: () => DW.call('session:pause') }, 'Пауза'));
    if (!isBreak && s.phaseEnd) ctrls.append(h('button.btn', { onclick: () => DW.call('session:extend', 5) }, '+5 мин'));
    if (isBreak) ctrls.append(h('button.btn', { onclick: () => DW.call('session:skipBreak') }, 'Пропустить перерыв'));
    if (s.mode === 'flow' && !isBreak) ctrls.append(h('button.btn', { onclick: () => DW.call('session:takeBreak') }, 'Перерыв'));
    ctrls.append(h('button.btn.ghost', { onclick: () => exitFlow(s) }, 'Завершить'));
    const zen = document.body.classList.contains('zen');
    const a = DW.state.settings.ambient;
    const tools = h('div.row.ring-tools',
      h('button.btn.ghost.sm', { title: 'Запарковать мысль (Ctrl+Alt+Space)', onclick: () => window.dw.call('capture:show') }, 'Мысль на парковку'),
      h('select.select.input.sm', { title: 'Звук', onchange: e => window.dw.call('settings:set', { ambient: { ...a, kind: e.target.value } }) },
        AMBIENT.map(([k, l]) => h('option', { value: k, selected: a.kind === k }, l))),
      h('button.btn.ghost.sm', { onclick: () => DW.zen(!zen) }, zen ? 'Выйти из дзена' : 'Дзен'));

    const center = h('div.card.timer-wrap',
      ring,
      s.goal ? h('div.goal-now', s.goal) : h('div.goal-now.dim', 'Цель не задана'),
      s.status === 'paused' ? h('div.paused-tag', 'Пауза') : next,
      ctrls, tools);
    // zen: nothing but the ring
    if (zen) return h('div.zen-wrap', center);
    return h('div',
      h('div.view-head', h('h1', isBreak ? 'Перерыв' : 'В фокусе'), h('span.sub', `начато в ${DW.hhmm(s.startedAt)} · ${DW.dur(liveFocusMin(s))} фокуса`)),
      h('div.running.stagger', center, rightColumn(s)));
  }

  // ---------------------------------------------------------------- friction exit
  function exitFlow(s) {
    const L = DW.levelCfg(s.level);
    const phrase = DW.state.defaults.phrase;
    const flowFree = s.mode === 'flow' && liveFocusMin(s) >= 25;
    if (flowFree) {
      return DW.confirm('Завершить сессию?', `${DW.dur(liveFocusMin(s))} фокуса — сессия засчитается как завершённая.`, 'Завершить').then(ok => ok && DW.call('session:confirmStop'));
    }
    const type = L.exit.type;
    DW.modal(async (m, close) => {
      close.onclose = () => window.dw.call('session:cancelStop');
      const until = await window.dw.call('session:requestStop');
      const needPhrase = type !== 'confirm';
      const title = type === 'emergency' ? 'Аварийный выход' : 'Выйти из фокуса?';
      const text = type === 'emergency'
        ? `Выход откроется через ${waitText(L.exit.wait)}. Если желание пройдёт — просто вернись к работе.`
        : 'Сессия запишется как прерванная. Уже отработанные минуты сохранятся.';
      const count = h('div.big-count');
      const inp = needPhrase ? h('input.input', { placeholder: phrase, oninput: upd, style: { width: '100%' } }) : null;
      const go = h('button.btn.danger', { onclick: async () => { const r = await DW.call('session:confirmStop'); if (r && r.ok) { close.onclose = null; close(); } } }, 'Завершить');
      function upd() {
        const left = until - Date.now();
        const phraseOk = !needPhrase || inp.value.trim().toLowerCase() === phrase;
        count.textContent = left > 0 ? DW.clock(left) : '';
        count.style.display = left > 0 ? '' : 'none';
        go.disabled = left > 0 || !phraseOk;
      }
      const iv = setInterval(() => { if (!document.body.contains(count)) return clearInterval(iv); upd(); }, 250);
      m.append(h('h2', title), h('p', text), count,
        needPhrase ? h('div.col', { style: { gap: '6px' } }, h('span.label', `Введи: «${phrase}»`), inp) : null,
        h('div.acts', h('button.btn.primary', { onclick: () => close() }, 'Остаться в фокусе'), go));
      upd();
      if (inp) inp.focus();
    });
  }

  // after a session ends: offer to tick off its task
  DW.onFinished = rec => {
    const t = rec.taskId && DW.state.tasks.find(x => x.id === rec.taskId);
    const min = Math.round(rec.focusMs / 60000);
    DW.modal((m, close) => {
      const note = h('textarea.input', { placeholder: 'Как прошло? Что мешало? Запишется в журнал', style: { fontFamily: 'var(--font)', fontSize: '13px', minHeight: '64px' } });
      const q = DW.quality(rec);
      const extra = [
        q ? `Качество фокуса ${q.pct}%` : null,
        rec.idleMs >= 60000 ? `простой ${DW.dur(rec.idleMs / 60000)} не засчитан` : null,
      ].filter(Boolean).join(' · ');
      m.append(h('h2', rec.result === 'done' ? 'Сессия завершена' : 'Сессия прервана'),
        h('p', `${DW.dur(min)} фокуса${rec.goal ? ' · ' + rec.goal : ''}`),
        extra ? h('div.hint', extra) : null,
        rec.parked ? h('div.row', h('span.muted', `На парковке ${DW.count(rec.parked, 'мысль', 'мысли', 'мыслей')}`),
          h('a.link', { onclick: () => { close(); DW.planTab = 'backlog'; DW.go('plan'); } }, 'Разобрать')) : null,
        note);
      // the note goes to the journal whichever button closes the dialog
      const finish = taskDone => {
        if (note.value.trim()) window.dw.call('journal:note', DW.ymd(rec.start), { text: note.value.trim(), sessionId: rec.id, goal: rec.goal, min });
        if (taskDone) window.dw.call('tasks:save', { id: t.id, done: true, doneAt: Date.now() });
        close();
      };
      const acts = h('div.acts');
      if (t && !t.done) {
        acts.append(h('button.btn', { onclick: () => finish(false) }, 'Ещё не готово'),
          h('button.btn.primary', { onclick: () => finish(true) }, 'Задача выполнена'));
      } else acts.append(h('button.btn.primary', { onclick: () => finish(false) }, 'Готово'));
      m.append(acts);
    });
  };

  DW.focusDraft = draft;
  DW.views.focus = { render, title: 'Фокус', leave: () => { clearInterval(tickTimer); document.title = 'Deepwork'; } };
})();
