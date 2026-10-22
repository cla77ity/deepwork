// Plan view: month calendar with tasks, day panel, backlog ("someday" tasks) and long-term goals.
(function () {
  const { h } = DW;
  const ui = { month: null, sel: null, tab: 'day', shownMonth: null, shownTab: null };

  const save = t => window.dw.call('tasks:save', t);
  const del = id => window.dw.call('tasks:delete', id);

  function render(root) {
    const today = DW.today();
    if (!ui.sel) ui.sel = today;
    // another view can ask for a tab (e.g. "разобрать парковку" → backlog)
    if (DW.planTab) { ui.tab = DW.planTab; DW.planTab = null; }
    if (!ui.month) ui.month = today.slice(0, 7);
    root.append(
      h('div.view-head', h('h1', 'План')),
      h('div.plan-grid.stagger', calendar(), side()));
  }

  // ---------------------------------------------------------------- calendar
  function calendar() {
    const [y, m] = ui.month.split('-').map(Number);
    const first = new Date(y, m - 1, 1);
    const offset = (first.getDay() + 6) % 7; // monday first
    const start = DW.ymd(new Date(y, m - 1, 1 - offset));
    const today = DW.today();
    const by = DW.focusByDay();
    const tasksBy = {};
    for (const t of DW.state.tasks) if (t.date) (tasksBy[t.date] = tasksBy[t.date] || []).push(t);

    const shift = n => { const d = new Date(y, m - 1 + n, 1); ui.month = DW.ymd(d).slice(0, 7); DW.render(); };
    const head = h('div.cal-head',
      DW.iconBtn('left', 'Предыдущий месяц', () => shift(-1)),
      h('div.m', `${DW.MONTHS[m - 1]} ${y}`),
      DW.iconBtn('right', 'Следующий месяц', () => shift(1)),
      h('div.spacer'),
      h('button.btn.sm', { onclick: () => { ui.month = today.slice(0, 7); ui.sel = today; ui.tab = 'day'; DW.render(); } }, 'Сегодня'));

    // slide only when the month actually changed, not on every data refresh
    const body = h('div.cal-body' + (ui.shownMonth && ui.shownMonth !== ui.month ? '.slide' : ''));
    ui.shownMonth = ui.month;
    for (let i = 0; i < 42; i++) {
      const d = DW.addDays(start, i);
      const list = (tasksBy[d] || []).sort((a, b) => a.done - b.done || (a.time || '99').localeCompare(b.time || '99') || a.prio - b.prio);
      const fm = by[d] || 0;
      const evs = DW.eventsOn(d);
      // two lines fit in a cell at the usual window height; the rest is counted in the header
      const slots = 2 - Math.min(1, evs.length);
      const hidden = list.length - Math.min(slots, list.length) + Math.max(0, evs.length - 1);
      const cls = ['day', d.slice(0, 7) !== ui.month && 'out', d === today && 'today', d === ui.sel && 'sel'].filter(Boolean).join('.');
      const cell = h('div.' + cls, {
        onclick: () => { ui.sel = d; ui.tab = 'day'; DW.render(); },
        ondragover: e => { e.preventDefault(); cell.classList.add('drop'); },
        ondragleave: () => cell.classList.remove('drop'),
        ondrop: e => { e.preventDefault(); const id = e.dataTransfer.getData('text/task'); if (id) save({ id, date: d }); },
      },
        h('div.dn', h('b', String(+d.slice(8))), hidden > 0 ? h('span.more', { title: 'ещё ' + hidden }, '+' + hidden) : null, fm >= 1 ? h('span.fm.num', DW.durShort(fm)) : null),
        // calendar event first (one), then tasks
        evs.slice(0, 1).map(e => h('div.echip', { title: (e.allDay ? 'весь день' : DW.hhmm(e.start) + '–' + DW.hhmm(e.end)) + ' · ' + e.title }, e.title)),
        list.slice(0, slots).map(t => h('div.tchip' + (t.done ? '.done' : ''), { style: { '--c': goalColor(t) }, draggable: true, ondragstart: e => e.dataTransfer.setData('text/task', t.id), title: (t.time ? t.time + ' · ' : '') + t.title }, t.title)),

        fm >= 1 ? h('div.heat', { style: { opacity: String(Math.min(1, 0.25 + fm / (DW.goalFor(d) || fm) * 0.75)), width: Math.min(100, fm / (DW.goalFor(d) || fm) * 100) + '%' } }) : null);
      body.append(cell);
    }
    return h('div.card.cal', head, h('div.cal-dow', DW.DOW.map(d => h('div', d))), body);
  }

  const goalColor = t => { const g = t.goalId && DW.goalById(t.goalId); return g ? g.color : 'var(--dim)'; };

  // ---------------------------------------------------------------- side panel
  function side() {
    const seg = h('div.seg', [['day', 'День'], ['routines', 'Рутины'], ['backlog', 'Бэклог'], ['goals', 'Цели']].map(([k, l]) =>
      h('button' + (ui.tab === k ? '.on' : ''), { onclick: () => { ui.tab = k; DW.render(); } }, l)));
    const content = { day: dayPanel, routines: routinesPanel, backlog: backlogPanel, goals: goalsPanel }[ui.tab]();
    if (ui.shownTab && ui.shownTab !== ui.tab + ui.sel) content.classList.add('slide');
    ui.shownTab = ui.tab + ui.sel;
    return h('div.card.side-panel', seg, content);
  }

  function addInput(placeholder, make) {
    const inp = h('input.input#plan-add', {
      placeholder,
      onkeydown: async e => {
        if (e.key !== 'Enter' || !inp.value.trim()) return;
        DW.refocus = 'plan-add';
        await save(make(parseQuick(inp.value.trim())));
      },
    });
    return h('div.col', { style: { gap: '6px' } },
      h('div.add-row', inp, h('button.btn', { title: 'Добавить с подробностями', onclick: () => editTask(make({ title: inp.value.trim() })) }, DW.svg(DW.icons.plus))),
      h('div.hint', 'Enter — добавить. Можно сразу: 14:30 — время, !1 — важно, 50м — сколько займёт'));
  }

  // "14:30 созвон !1 50м" -> time, priority, estimate
  function parseQuick(text) {
    const o = { title: text, time: '', prio: 2, est: 0 };
    o.title = o.title.replace(/(^|\s)(\d{1,2})[:.](\d{2})(?=\s|$)/, (_, s, hh, mm) => { o.time = hh.padStart(2, '0') + ':' + mm; return s; });
    o.title = o.title.replace(/(^|\s)!([123])(?=\s|$)/, (_, s, p) => { o.prio = +p; return s; });
    o.title = o.title.replace(/(^|\s)(\d{1,3})\s?(м|мин|m)(?=\s|$)/, (_, s, n) => { o.est = +n; return s; });
    o.title = o.title.replace(/\s+/g, ' ').trim() || text;
    return o;
  }

  function taskRow(t, opts = {}) {
    const g = t.goalId && DW.goalById(t.goalId);
    const meta = [];
    // "normal" is the default, so only the exceptions are shown
    if (t.prio === 1 || t.prio === 3) meta.push(h('span.row', { style: { gap: '5px' } }, h('span.prio.p' + t.prio), t.prio === 1 ? 'важно' : 'не срочно'));
    if (opts.showDate && t.date) meta.push(h('span', DW.parse(t.date).getDate() + ' ' + DW.MONTHS_GEN[DW.parse(t.date).getMonth()]));
    if (t.time) meta.push(h('span.num', t.time));
    if (t.est) meta.push(h('span', 'займёт ' + DW.dur(t.est)));
    if (t.parked) meta.push(h('span', { title: t.notes || '' }, 'с парковки'));
    if (t.focusMs >= 60000) meta.push(h('span', { style: { color: 'var(--text)' } }, 'в фокусе ' + DW.dur(t.focusMs / 60000)));
    if (g) meta.push(h('span.row', { style: { gap: '5px' } }, h('span.gdot', { style: { '--c': g.color } }), g.title));
    const today = DW.today();
    return h('div.task' + (t.done ? '.done' : ''), { draggable: true, ondragstart: e => e.dataTransfer.setData('text/task', t.id), ondblclick: () => editTask(t) },
      h('button.check' + (t.done ? '.on' : ''), { onclick: () => save({ id: t.id, done: !t.done, doneAt: !t.done ? Date.now() : null }) }),
      h('div.body', h('div.title', t.top === DW.today() ? h('span.star', { title: 'Главное на сегодня' }, '★ ') : null, t.title), h('div.meta', meta), t.notes ? h('div.dim', { style: { fontSize: '12px', marginTop: '3px', whiteSpace: 'pre-wrap' } }, t.notes) : null),
      h('div.acts',
        !t.done && !DW.state.session ? DW.iconBtn('play', 'Начать фокус на задаче', () => { DW.focusDraft.goal = t.title; DW.focusDraft.taskId = t.id; DW.go('focus'); }) : null,
        !t.done && t.date !== DW.addDays(today, 1) ? DW.iconBtn('next', t.date && t.date < today ? 'Перенести на сегодня' : 'Перенести на завтра', () => save({ id: t.id, date: t.date && t.date < today ? today : DW.addDays(t.date || today, 1) })) : null,
        DW.iconBtn('edit', 'Изменить', () => editTask(t)),
        DW.iconBtn('x', 'Удалить', () => del(t.id))));
  }

  const sortTasks = list => list.sort((a, b) => a.done - b.done || (a.time || '99').localeCompare(b.time || '99') || (a.prio || 2) - (b.prio || 2) || a.createdAt - b.createdAt);

  function dayPanel() {
    const d = ui.sel, today = DW.today();
    const tasks = sortTasks(DW.state.tasks.filter(t => t.date === d));
    const fm = DW.focusByDay()[d] || 0;
    const doneN = tasks.filter(t => t.done).length;
    const est = tasks.filter(t => !t.done).reduce((a, t) => a + (t.est || 0), 0);
    const parts = [];
    if (d === today) {
      const overdue = sortTasks(DW.state.tasks.filter(t => t.date && t.date < today && !t.done));
      if (overdue.length) parts.push(h('div.sec-title.bad', 'Просрочено · ' + overdue.length, h('div.spacer'),
        h('button.btn.ghost.sm', { onclick: () => overdue.forEach(t => save({ id: t.id, date: today })) }, 'Всё на сегодня')),
        overdue.map(t => taskRow(t, { showDate: true })));
    }
    parts.push(h('div.sec-title', d === today ? 'Сегодня' : 'Задачи'), tasks.length ? tasks.map(t => taskRow(t)) : h('div.empty', 'Задач нет. Добавь выше или перетащи из бэклога'));
    // busy time from the calendar subscription
    const events = DW.eventsOn(d);
    if (events.length) {
      const busy = events.filter(e => !e.allDay).reduce((a, e) => a + (Math.min(e.end, +DW.parse(DW.addDays(d, 1))) - Math.max(e.start, +DW.parse(d))) / 60000, 0);
      parts.splice(0, 0, h('div.sec-title', 'Календарь' + (busy >= 1 ? ` · занято ${DW.dur(busy)}` : '')),
        events.map(e => h('div.event', h('span.num.dim', e.allDay ? 'весь день' : `${DW.hhmm(e.start)}–${DW.hhmm(e.end)}`), h('span', e.title))));
    }
    const routines = DW.routinesFor(d);
    if (routines.length) {
      const doneR = routines.filter(r => DW.routineDone(d, r.id)).length;
      parts.push(h('div.sec-title', `Рутина · ${doneR} из ${routines.length}`), routines.map(r => routineRow(r, d)));
    }
    return h('div.tabbody',
      h('div', h('div.day-title', DW.longDate(d)),
        h('div.muted', { style: { fontSize: '12.5px' } }, [
          tasks.length ? `${doneN}/${tasks.length} готово` : null,
          est ? `ещё ≈ ${DW.dur(est)} работы` : null,
          fm >= 1 ? `в фокусе ${DW.dur(fm)}` : null].filter(Boolean).join(' · ') || ' ')),
      addInput('Новая задача', o => ({ ...o, date: d, done: false })),
      h('div.scroll', parts));
  }

  function backlogPanel() {
    const list = sortTasks(DW.state.tasks.filter(t => !t.date && !t.done));
    const done = DW.state.tasks.filter(t => !t.date && t.done);
    return h('div.tabbody',
      h('div', h('div.day-title', 'Бэклог'), h('div.muted', { style: { fontSize: '12.5px' } }, 'Планы без даты. Перетащи задачу на день в календаре, когда будешь готов.')),
      addInput('Идея или задача без даты', o => ({ ...o, date: null, done: false })),
      h('div.scroll',
        list.length ? list.map(t => taskRow(t)) : h('div.empty', 'Бэклог пуст'),
        done.length ? [h('div.sec-title', 'Сделано · ' + done.length), done.slice(-10).map(t => taskRow(t))] : null));
  }

  // ---------------------------------------------------------------- routines
  const DOW_SHORT = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];
  const daysText = days => {
    const d = [...(days || [])].sort();
    if (d.length === 7) return 'каждый день';
    if (d.join() === '0,1,2,3,4') return 'по будням';
    if (d.join() === '5,6') return 'по выходным';
    return d.map(i => DOW_SHORT[i]).join(', ');
  };

  function routineRow(r, d) {
    const on = DW.routineDone(d, r.id);
    return h('div.task' + (on ? '.done' : ''),
      h('button.check' + (on ? '.on' : ''), { onclick: () => window.dw.call('routines:toggle', d, r.id) }),
      h('div.body', h('div.title', r.title), h('div.meta', r.time ? h('span.num', r.time) : null, r.est ? h('span', 'займёт ' + DW.dur(r.est)) : null)),
      h('div.acts', DW.iconBtn('edit', 'Изменить рутину', () => editRoutine(r))));
  }

  // how many of the last 14 scheduled days were done
  function routineRate(r) {
    let sched = 0, done = 0, d = DW.today();
    for (let i = 0; i < 28 && sched < 14; i++, d = DW.addDays(d, -1)) {
      if (!(r.days || []).includes(DW.dowOf(d)) || (r.createdAt && DW.parse(d) < DW.parse(DW.ymd(r.createdAt)))) continue;
      sched++;
      if (DW.routineDone(d, r.id)) done++;
    }
    return sched ? `${done} из ${sched} за 2 недели` : 'ещё не было';
  }

  function routinesPanel() {
    const list = [...DW.state.routines].sort((a, b) => (a.time || '99').localeCompare(b.time || '99'));
    return h('div.tabbody',
      h('div.row', { style: { alignItems: 'flex-start' } }, h('div', h('div.day-title', 'Рутины'),
        h('div.muted', { style: { fontSize: '12.5px' } }, 'Повторяющиеся дела: зарядка, английский, разбор почты. Появляются в нужные дни сами.')),
        h('div.spacer'), h('button.btn.sm', { onclick: () => editRoutine({}) }, DW.svg(DW.icons.plus), 'Рутина')),
      h('div.scroll', list.length ? list.map(r => h('div.goal', { onclick: () => editRoutine(r), style: { opacity: r.active === false ? '.5' : '1' } },
        h('div.gt', r.title, h('div.spacer'), r.time ? h('span.dim.num', { style: { fontWeight: 400, fontSize: '12.5px' } }, r.time) : null),
        h('div.row.muted', { style: { fontSize: '12px', marginTop: '6px', gap: '12px' } }, h('span', r.active === false ? 'на паузе' : daysText(r.days)), h('div.spacer'), h('span', routineRate(r)))))
        : h('div.empty', 'Рутин пока нет')));
  }

  function editRoutine(r) {
    const o = { days: [0, 1, 2, 3, 4], time: '', est: 0, active: true, ...r };
    DW.modal((m, close) => {
      const title = h('input.input', { value: o.title || '', placeholder: 'Например: 30 минут английского' });
      const time = h('input.input', { type: 'time', value: o.time || '' });
      const est = h('input.input', { type: 'number', min: 0, step: 5, value: o.est || '', placeholder: 'мин' });
      const days = new Set(o.days);
      const dayRow = h('div.row', { style: { gap: '5px' } });
      const paintDays = () => {
        dayRow.innerHTML = '';
        DOW_SHORT.forEach((l, i) => dayRow.append(h('button.chip' + (days.has(i) ? '.on' : ''), { onclick: () => { days.has(i) ? days.delete(i) : days.add(i); paintDays(); } }, l)));
      };
      paintDays();
      let active = o.active !== false;
      const doSave = async () => {
        if (!title.value.trim()) return title.focus();
        if (!days.size) return DW.toast('Выбери хотя бы один день', true);
        await window.dw.call('routines:save', { ...o, title: title.value.trim(), time: time.value, est: +est.value || 0, days: [...days].sort(), active });
        close();
      };
      title.addEventListener('keydown', e => e.key === 'Enter' && doSave());
      m.append(h('h2', o.id ? 'Рутина' : 'Новая рутина'),
        h('div.form',
          h('span.label', 'Что делать'), title,
          h('span.label', 'Дни'), dayRow,
          h('span.label', 'Время'), time,
          h('span.label', 'Займёт, мин'), est,
          o.id ? h('span.label', 'Активна') : null, o.id ? DW.switchEl(active, v => { active = v; }) : null),
        h('div.acts',
          o.id ? h('button.btn.danger', { style: { marginRight: 'auto' }, onclick: () => { window.dw.call('routines:delete', o.id); close(); } }, 'Удалить') : null,
          h('button.btn', { onclick: () => close() }, 'Отмена'),
          h('button.btn.primary', { onclick: doSave }, 'Сохранить')));
    });
  }

  function goalsPanel() {
    const goals = DW.state.goals.filter(g => !g.archived);
    return h('div.tabbody',
      h('div.row', { style: { alignItems: 'flex-start' } }, h('div', h('div.day-title', 'Цели'), h('div.muted', { style: { fontSize: '12.5px' } }, 'Привязывай к цели задачи — прогресс посчитается сам.')),
        h('div.spacer'), h('button.btn.sm', { onclick: () => editGoal({}) }, DW.svg(DW.icons.plus), 'Цель')),
      h('div.scroll', goals.length ? goals.map(goalCard) : h('div.empty', 'Целей пока нет. Например: «Выучить английский до B2»')));
  }

  function goalCard(g) {
    const tasks = DW.state.tasks.filter(t => t.goalId === g.id);
    const done = tasks.filter(t => t.done).length;
    const focus = tasks.reduce((a, t) => a + (t.focusMs || 0), 0) / 60000;
    let dl = '';
    if (g.deadline) {
      const days = Math.round((DW.parse(g.deadline) - DW.parse(DW.today())) / 86400000);
      dl = days < 0 ? `просрочено на ${-days} дн.` : days === 0 ? 'дедлайн сегодня' : `осталось ${days} ${DW.plural(days, 'день', 'дня', 'дней')}`;
    }
    return h('div.goal', { style: { '--c': g.color }, onclick: () => editGoal(g) },
      h('div.gt', h('span.gdot'), g.title),
      h('div.bar', h('i', { style: { width: (tasks.length ? done / tasks.length * 100 : 0) + '%' } })),
      h('div.row.muted', { style: { fontSize: '12px', gap: '12px' } },
        h('span', tasks.length ? `${done} из ${DW.count(tasks.length, 'задачи', 'задач', 'задач')}` : 'нет задач'), focus >= 1 ? h('span', 'в фокусе ' + DW.dur(focus)) : null, h('div.spacer'), h('span', dl)));
  }

  // ---------------------------------------------------------------- editors
  function editTask(t) {
    const o = { prio: 2, est: 0, time: '', notes: '', goalId: null, date: ui.sel, ...t };
    DW.modal((m, close) => {
      const title = h('input.input', { value: o.title || '', placeholder: 'Что сделать' });
      const date = h('input.input', { type: 'date', value: o.date || '' });
      const time = h('input.input', { type: 'time', value: o.time || '' });
      const est = h('input.input', { type: 'number', min: 0, step: 5, value: o.est || '', placeholder: 'мин' });
      let prio = o.prio;
      const prioSeg = h('div.seg', [[1, 'Важно'], [2, 'Обычно'], [3, 'Не срочно']].map(([k, l]) =>
        h('button' + (prio === k ? '.on' : ''), { onclick: e => { prio = k; [...prioSeg.children].forEach(b => b.classList.toggle('on', b === e.target)); } }, l)));
      const goal = h('select.select.input', h('option', { value: '' }, '— без цели —'),
        DW.state.goals.filter(g => !g.archived).map(g => h('option', { value: g.id, selected: g.id === o.goalId }, g.title)));
      const notes = h('textarea.input', { placeholder: 'Ссылки, подзадачи, детали', style: { fontFamily: 'var(--font)', fontSize: '13px', minHeight: '70px' } }, o.notes || '');
      const doSave = async () => {
        if (!title.value.trim()) return title.focus();
        await save({ ...o, title: title.value.trim(), date: date.value || null, time: time.value, est: +est.value || 0, prio, goalId: goal.value || null, notes: notes.value });
        close();
      };
      title.addEventListener('keydown', e => e.key === 'Enter' && doSave());
      m.append(h('h2', o.id ? 'Задача' : 'Новая задача'),
        h('div.form',
          h('span.label', 'Название'), title,
          h('span.label', 'Дата'), h('div.row', date, h('button.btn.ghost.sm', { onclick: () => { date.value = ''; } }, 'Без даты')),
          h('span.label', 'Время'), time,
          h('span.label', 'Займёт, мин'), est,
          h('span.label', 'Приоритет'), prioSeg,
          h('span.label', 'Цель'), goal,
          h('span.label', 'Заметки'), notes),
        h('div.acts',
          o.id ? h('button.btn.danger', { style: { marginRight: 'auto' }, onclick: () => { del(o.id); close(); } }, 'Удалить') : null,
          h('button.btn', { onclick: () => close() }, 'Отмена'),
          h('button.btn.primary', { onclick: doSave }, 'Сохранить')));
    });
  }

  function editGoal(g) {
    const o = { color: DW.GOAL_COLORS[DW.state.goals.length % DW.GOAL_COLORS.length], deadline: '', notes: '', ...g };
    DW.modal((m, close) => {
      const title = h('input.input', { value: o.title || '', placeholder: 'Например: выпустить Deepwork 1.0' });
      const deadline = h('input.input', { type: 'date', value: o.deadline || '' });
      const notes = h('textarea.input', { placeholder: 'Как пойму, что цель достигнута', style: { fontFamily: 'var(--font)', fontSize: '13px', minHeight: '70px' } }, o.notes || '');
      let color = o.color;
      const sw = h('div.swatches', DW.GOAL_COLORS.map(c => h('button' + (c === color ? '.on' : ''), { style: { background: c }, onclick: e => { color = c; [...sw.children].forEach(b => b.classList.toggle('on', b === e.target)); } })));
      const doSave = async () => {
        if (!title.value.trim()) return title.focus();
        await window.dw.call('goals:save', { ...o, title: title.value.trim(), deadline: deadline.value, notes: notes.value, color });
        close();
      };
      title.addEventListener('keydown', e => e.key === 'Enter' && doSave());
      m.append(h('h2', o.id ? 'Цель' : 'Новая цель'),
        h('div.form', h('span.label', 'Цель'), title, h('span.label', 'Дедлайн'), deadline, h('span.label', 'Цвет'), sw, h('span.label', 'Заметки'), notes),
        h('div.acts',
          o.id ? h('button.btn.danger', { style: { marginRight: 'auto' }, onclick: async () => { if (await DW.confirm('Удалить цель?', 'Задачи останутся, просто без цели.', 'Удалить', true)) window.dw.call('goals:delete', o.id); } }, 'Удалить') : null,
          o.id ? h('button.btn', { title: 'Убрать из списка как выполненную', onclick: () => { window.dw.call('goals:save', { id: o.id, archived: true }); close(); } }, 'Достигнута') : null,
          h('button.btn', { onclick: () => close() }, 'Отмена'),
          h('button.btn.primary', { onclick: doSave }, 'Сохранить')));
    });
  }

  DW.views.plan = { render, title: 'План' };
})();
