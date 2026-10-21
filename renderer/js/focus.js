// Focus view: session setup when idle, big ring timer while running, friction exit.
(function () {
  const { h } = DW;
  const draft = { goal: '', taskId: null, mode: null, level: null };
  let tickTimer = null;

  const LEVEL_POINTS = {
    1: ['«Не беспокоить»', 'предупреждение на сайтах', 'чистка YouTube', 'можно пауза'],
    2: ['сайты блокируются', 'игры и мессенджеры закрыты', 'ленты соцсетей скрыты', 'выход — ввести фразу'],
    3: ['блок во всех браузерах', 'другие браузеры закрыты', 'перерывы без разблока', 'выход — фраза + 60 с'],
    4: ['только белый список', 'сайтов и программ', 'никаких пауз', 'аварийный выход 5 мин'],
  };

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
    const today = DW.today();
    const todays = DW.state.tasks.filter(x => x.date === today && !x.done);

    const goalIn = h('input.input.goal-input', {
      placeholder: 'Над чем работаешь? Например: доделать лендинг', value: draft.goal,
      oninput: e => { draft.goal = e.target.value; draft.taskId = null; paintChips(); },
      onkeydown: e => { if (e.key === 'Enter') start(); },
    });
    const chips = h('div.row.wrap', { style: { gap: '6px', marginTop: '10px' } });
    function paintChips() {
      chips.innerHTML = '';
      todays.slice(0, 8).forEach(tk => chips.append(h('button.chip' + (draft.taskId === tk.id ? '.on' : ''), {
        onclick: () => { draft.goal = tk.title; draft.taskId = tk.id; goalIn.value = tk.title; paintChips(); },
      }, tk.title)));
      if (!todays.length) chips.append(h('span.dim', { style: { fontSize: '12.5px' } }, 'На сегодня задач нет — добавь их во вкладке «План»'));
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
      } else params.append(h('div.muted', { style: { maxWidth: '520px' } }, 'Работаешь, пока идёт. Нажмёшь «Перерыв» — отдых будет 1/5 отработанного (5–30 мин). Завершить без штрафа можно после 25 минут фокуса.'));
    }
    function paintSummary() {
      let min = 0;
      if (draft.mode === 'pomodoro') {
        min = t.focus * t.rounds;
        for (let r = 1; r < t.rounds; r++) min += r % (t.longEvery || 4) === 0 ? t.long : t.short;
      } else if (draft.mode === 'custom') min = t.custom;
      summary.textContent = min ? `≈ ${DW.dur(min)} · закончишь в ${DW.hhmm(Date.now() + min * 60000)}` : 'Без ограничения по времени';
    }
    let saveT;
    function saveTimer() { clearTimeout(saveT); saveT = setTimeout(() => window.dw.call('settings:set', { timer: { ...t } }), 400); }

    const modeSeg = h('div.seg', [['pomodoro', 'Помодоро'], ['custom', 'Таймер'], ['flow', 'Flow']].map(([k, l]) =>
      h('button' + (draft.mode === k ? '.on' : ''), { onclick: e => { draft.mode = k; t.mode = k; saveTimer(); [...e.target.parentNode.children].forEach(b => b.classList.toggle('on', b === e.target)); paintParams(); paintSummary(); } }, l)));

    const levels = h('div.levels', [1, 2, 3, 4].map(n => {
      const L = DW.levelCfg(n);
      return h('button.lvl' + (draft.level === n ? '.on' : ''), {
        style: { '--c': `var(--l${n})` },
        onclick: e => { draft.level = n; levels.querySelectorAll('.lvl').forEach(b => b.classList.toggle('on', b === e.currentTarget)); },
      }, h('span.n', 'УРОВЕНЬ ' + n), h('span.t', L.name), h('span.d', L.tag), h('ul', LEVEL_POINTS[n].map(p => h('li', p))));
    }));

    paintParams(); paintSummary();

    const left = h('div.card.setup',
      h('div', h('div.lbl', 'Цель сессии'), goalIn, chips),
      h('div', h('div.lbl', 'Режим'), h('div.row.wrap', { style: { gap: '18px', alignItems: 'flex-end' } }, modeSeg, params)),
      h('div', h('div.lbl', 'Сила фокуса'), levels),
      h('div.start-row', h('button.btn.primary.big', { onclick: start }, DW.svg(DW.icons.play, ''), 'Начать фокус'), summary));
    left.querySelector('.btn.big svg').setAttribute('style', 'width:16px;height:16px;fill:#fff;stroke:none');

    return h('div',
      h('div.view-head', h('h1', greeting()), h('span.sub', DW.longDate(DW.today()))),
      h('div.focus-grid', left, rightColumn(null)));
  }

  function greeting() {
    const hr = new Date().getHours();
    return hr < 5 ? 'Доброй ночи' : hr < 12 ? 'Доброе утро' : hr < 18 ? 'Добрый день' : 'Добрый вечер';
  }

  async function start() {
    const lvl = draft.level;
    const preview = await window.dw.call('session:preview', lvl);
    if (preview && preview.length) {
      const ok = await DW.confirm('Будут закрыты программы', `${preview.map(p => p.name).join(', ')}. Сохрани работу в них, если нужно.`, 'Начать');
      if (!ok) return;
    }
    const L = DW.levelCfg(lvl);
    if (L.hosts) DW.toast('Windows спросит права администратора — это для блокировки сайтов в hosts');
    const r = await DW.call('session:start', { mode: draft.mode, level: lvl, goal: draft.goal.trim(), taskId: draft.taskId });
    if (r && r.ok) { draft.goal = ''; draft.taskId = null; }
  }

  // ---------------------------------------------------------------- right column
  function rightColumn(s) {
    const st = DW.state;
    const today = DW.today();
    const by = DW.focusByDay();
    const live = s ? liveFocusMin(s) : 0;
    const done = (by[today] || 0) + live;
    const goal = st.settings.dailyGoalMin;
    const pct = Math.min(1, done / goal);
    const R = 30, C = 2 * Math.PI * R;
    const ring = DW.svg(`<circle cx="36" cy="36" r="${R}" fill="none" stroke="rgba(255,255,255,.07)" stroke-width="7"/>
      <circle cx="36" cy="36" r="${R}" fill="none" stroke="#6d7cff" stroke-width="7" stroke-linecap="round" stroke-dasharray="${C}" stroke-dashoffset="${C * (1 - pct)}" transform="rotate(-90 36 36)"/>`);
    ring.setAttribute('viewBox', '0 0 72 72');
    ring.setAttribute('style', 'width:72px;height:72px;flex:none');
    const streak = DW.streak();

    const todayCard = h('div.card',
      h('h3', 'Сегодня'),
      h('div.today-ring', ring, h('div',
        h('div', { style: { font: '600 22px var(--font-d)' } }, h('span.num', DW.dur(done)), h('span.dim', { style: { fontSize: '14px', fontWeight: 400 } }, ' / ' + DW.dur(goal))),
        h('div.muted', { style: { fontSize: '12.5px' } }, streak ? `Серия: ${streak} ${DW.plural(streak, 'день', 'дня', 'дней')} подряд` : 'Выполни дневную норму, чтобы начать серию'))));

    const tasks = st.tasks.filter(t => t.date === today).sort((a, b) => a.done - b.done || (a.time || '99').localeCompare(b.time || '99') || a.prio - b.prio);
    const planCard = h('div.card', h('div.row', h('h3', { style: { margin: 0 } }, 'План на сегодня'), h('div.spacer'),
      h('button.btn.ghost.sm', { onclick: () => DW.go('plan') }, 'Календарь →')),
      h('div', { style: { marginTop: '8px' } }, tasks.length ? tasks.map(t => h('div.mini-task' + (t.done ? '.done' : ''),
        h('button.check' + (t.done ? '.on' : ''), { onclick: () => window.dw.call('tasks:save', { id: t.id, done: !t.done, doneAt: !t.done ? Date.now() : null }) }),
        h('span.tt', t.title),
        t.time ? h('span.dim.num', { style: { fontSize: '12px' } }, t.time) : null,
        !s && !t.done ? DW.iconBtn('play', 'Фокус на этой задаче', () => { draft.goal = t.title; draft.taskId = t.id; DW.render(); }) : null,
      )) : h('div.empty', 'Пусто. Запланируй день во вкладке «План»')));

    return h('div.col', { style: { gap: '16px' } }, todayCard, protectionCard(s), planCard);
  }

  function protectionCard(s) {
    const st = DW.state;
    const ext = st.ext || {};
    const en = st.enforce || {};
    const L = DW.levelCfg(s ? s.level : (draft.level || st.settings.level));
    const dot = c => h('span.stat-dot.' + c);
    const rows = [];
    rows.push(h('div.prot', dot(ext.connected ? 'ok' : 'bad'), 'Расширение Brave', h('span.v', ext.connected ? (ext.incognito ? 'подключено' : 'подключено, приват — выкл') : h('a', { href: '#', style: { color: 'var(--accent)' }, onclick: e => { e.preventDefault(); DW.go('settings'); } }, 'установить'))));
    if (s) {
      if (L.dnd) rows.push(h('div.prot', dot(en.dnd ? 'ok' : en.dnd === false ? 'warn' : ''), '«Не беспокоить»', h('span.v', en.dnd ? 'включено' : en.dnd === false ? 'частично' : '…')));
      if (L.hosts) rows.push(h('div.prot', dot(en.hosts ? 'ok' : en.hosts === false ? 'bad' : ''), 'Блок в hosts', h('span.v', en.hosts ? 'активен' : en.hosts === false ? 'нет прав' : '…')));
      if (L.apps !== 'off' || L.onlyBrave) rows.push(h('div.prot', dot(en.apps === 'on' ? 'ok' : 'warn'), 'Контроль программ', h('span.v', en.apps === 'on' ? (L.apps === 'whitelist' ? 'белый список' : 'следит') : 'пауза')));
      const sites = Object.entries(s.attempts.sites), apps = Object.entries(s.attempts.apps);
      const total = [...sites, ...apps].reduce((a, [, n]) => a + n, 0);
      rows.push(h('div.prot', dot(total ? 'warn' : 'ok'), 'Попыток отвлечься', h('span.v.num', String(total))));
      [...sites, ...apps].sort((a, b) => b[1] - a[1]).slice(0, 4).forEach(([k, n]) => rows.push(h('div.prot.dim', { style: { paddingLeft: '17px', fontSize: '12.5px' } }, k, h('span.v.num', '×' + n))));
    } else {
      rows.push(h('div.prot', dot(''), '«Не беспокоить»', h('span.v', L.dnd ? 'включится' : 'нет')));
      rows.push(h('div.prot', dot(''), 'Сайты', h('span.v', { block: 'блок', warn: 'предупреждение', whitelist: 'белый список', off: 'нет' }[L.sites])));
      rows.push(h('div.prot', dot(''), 'Программы', h('span.v', { block: 'закрывать', whitelist: 'белый список', off: L.onlyBrave ? 'только браузеры' : 'нет' }[L.apps])));
    }
    return h('div.card', h('h3', s ? 'Защита активна' : 'Защита'), rows);
  }

  // ---------------------------------------------------------------- running
  function liveFocusMin(s) {
    let ms = s.focusMs;
    if (s.phase === 'focus') ms += (s.pausedAt || Date.now()) - s.phaseStart;
    return ms / 60000;
  }

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
    const rnd = s.mode === 'pomodoro' ? `раунд ${s.round} из ${s.rounds}` : s.mode === 'flow' ? 'flow' : 'таймер';
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
        document.title = `${DW.clock(now - s.phaseStart)} · Flow — Deepwork`;
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

    const center = h('div.card.timer-wrap',
      ring,
      s.goal ? h('div.goal-now', s.goal) : h('div.goal-now.dim', 'Без цели — просто глубокая работа'),
      s.status === 'paused' ? h('div.paused-tag', 'Пауза') : next,
      ctrls);
    return h('div',
      h('div.view-head', h('h1', isBreak ? 'Перерыв' : 'В фокусе'), h('span.sub', `с ${DW.hhmm(s.startedAt)} · ${DW.dur(liveFocusMin(s))} фокуса`)),
      h('div.running', center, rightColumn(s)));
  }

  // ---------------------------------------------------------------- friction exit
  function exitFlow(s) {
    const L = DW.levelCfg(s.level);
    const phrase = DW.state.defaults.phrase;
    const flowFree = s.mode === 'flow' && liveFocusMin(s) >= 25;
    if (flowFree) {
      return DW.confirm('Завершить flow-сессию?', `${DW.dur(liveFocusMin(s))} фокуса будут засчитаны.`, 'Завершить').then(ok => ok && DW.call('session:confirmStop'));
    }
    const type = L.exit.type;
    DW.modal(async (m, close) => {
      close.onclose = () => window.dw.call('session:cancelStop');
      const until = await window.dw.call('session:requestStop');
      const needPhrase = type !== 'confirm';
      const title = type === 'emergency' ? 'Аварийный выход' : 'Выйти из фокуса?';
      const text = type === 'emergency'
        ? 'Уровень «Монах». Выход станет доступен через 5 минут — если за это время желание пройдёт, просто закрой окно.'
        : 'Сессия будет отмечена как прерванная, серия может сгореть.';
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
      m.append(h('h2', rec.result === 'done' ? 'Сессия завершена' : 'Сессия прервана'),
        h('p', `${DW.dur(min)} глубокой работы${rec.goal ? ' · ' + rec.goal : ''}.`));
      const acts = h('div.acts');
      if (t && !t.done) {
        acts.append(h('button.btn', { onclick: () => close() }, 'Ещё не готово'),
          h('button.btn.primary', { onclick: () => { window.dw.call('tasks:save', { id: t.id, done: true, doneAt: Date.now() }); close(); } }, 'Задача выполнена'));
      } else acts.append(h('button.btn.primary', { onclick: () => close() }, 'Отлично'));
      m.append(acts);
    });
  };

  DW.focusDraft = draft;
  DW.views.focus = { render, title: 'Фокус', leave: () => { clearInterval(tickTimer); document.title = 'Deepwork'; } };
})();
