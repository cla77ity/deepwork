// Plan view: month calendar with tasks, day panel, backlog ("someday" tasks) and long-term goals.
(function () {
  const { h } = DW;
  const ui = { month: null, sel: null, tab: 'day' };

  const save = t => window.dw.call('tasks:save', t);
  const del = id => window.dw.call('tasks:delete', id);

  function render(root) {
    const today = DW.today();
    if (!ui.sel) ui.sel = today;
    if (!ui.month) ui.month = today.slice(0, 7);
    root.append(
      h('div.view-head', h('h1', 'План'), h('span.sub', 'задачи по дням, бэклог и цели — запускай фокус прямо из задачи')),
      h('div.plan-grid', calendar(), side()));
  }

  // ---------------------------------------------------------------- calendar
  function calendar() {
    const [y, m] = ui.month.split('-').map(Number);
    const first = new Date(y, m - 1, 1);
    const offset = (first.getDay() + 6) % 7; // monday first
    const start = DW.ymd(new Date(y, m - 1, 1 - offset));
    const today = DW.today();
    const by = DW.focusByDay();
    const goal = DW.state.settings.dailyGoalMin;
    const tasksBy = {};
    for (const t of DW.state.tasks) if (t.date) (tasksBy[t.date] = tasksBy[t.date] || []).push(t);

    const shift = n => { const d = new Date(y, m - 1 + n, 1); ui.month = DW.ymd(d).slice(0, 7); DW.render(); };
    const head = h('div.cal-head',
      DW.iconBtn('left', 'Предыдущий месяц', () => shift(-1)),
      h('div.m', `${DW.MONTHS[m - 1]} ${y}`),
      DW.iconBtn('right', 'Следующий месяц', () => shift(1)),
      h('div.spacer'),
      h('button.btn.sm', { onclick: () => { ui.month = today.slice(0, 7); ui.sel = today; ui.tab = 'day'; DW.render(); } }, 'Сегодня'));

    const body = h('div.cal-body');
    for (let i = 0; i < 42; i++) {
      const d = DW.addDays(start, i);
      const list = (tasksBy[d] || []).sort((a, b) => a.done - b.done || (a.time || '99').localeCompare(b.time || '99') || a.prio - b.prio);
      const fm = by[d] || 0;
      const cls = ['day', d.slice(0, 7) !== ui.month && 'out', d === today && 'today', d === ui.sel && 'sel'].filter(Boolean).join('.');
      const cell = h('div.' + cls, {
        onclick: () => { ui.sel = d; ui.tab = 'day'; DW.render(); },
        ondragover: e => { e.preventDefault(); cell.classList.add('drop'); },
        ondragleave: () => cell.classList.remove('drop'),
        ondrop: e => { e.preventDefault(); const id = e.dataTransfer.getData('text/task'); if (id) save({ id, date: d }); },
      },
        h('div.dn', h('b', String(+d.slice(8))), fm >= 1 ? h('span.fm.num', DW.durShort(fm)) : null),
        list.slice(0, 3).map(t => h('div.tchip' + (t.done ? '.done' : ''), { style: { '--c': goalColor(t) }, draggable: true, ondragstart: e => e.dataTransfer.setData('text/task', t.id) }, (t.time ? t.time + ' ' : '') + t.title)),
        list.length > 3 ? h('div.more', '+' + (list.length - 3) + ' ещё') : null,
        fm >= 1 ? h('div.heat', { style: { opacity: String(Math.min(1, 0.25 + fm / goal * 0.75)), width: Math.min(100, fm / goal * 100) + '%' } }) : null);
      body.append(cell);
    }
    return h('div.card.cal', head, h('div.cal-dow', DW.DOW.map(d => h('div', d))), body);
  }

  const goalColor = t => { const g = t.goalId && DW.goalById(t.goalId); return g ? g.color : 'var(--dim)'; };

  // ---------------------------------------------------------------- side panel
  function side() {
    const seg = h('div.seg', [['day', 'День'], ['backlog', 'Бэклог'], ['goals', 'Цели']].map(([k, l]) =>
      h('button' + (ui.tab === k ? '.on' : ''), { onclick: () => { ui.tab = k; DW.render(); } }, l)));
    const content = ui.tab === 'day' ? dayPanel() : ui.tab === 'backlog' ? backlogPanel() : goalsPanel();
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
    return h('div.add-row', inp, h('button.btn', { title: 'Подробнее', onclick: () => editTask(make({ title: inp.value.trim() })) }, DW.svg(DW.icons.plus)));
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
    meta.push(h('span.row', { style: { gap: '5px' } }, h('span.prio.p' + (t.prio || 2)), ['', 'важно', 'обычно', 'потом'][t.prio || 2]));
    if (opts.showDate && t.date) meta.push(h('span', DW.parse(t.date).getDate() + ' ' + DW.MONTHS_GEN[DW.parse(t.date).getMonth()]));
    if (t.time) meta.push(h('span.num', t.time));
    if (t.est) meta.push(h('span', '≈ ' + DW.dur(t.est)));
    if (t.focusMs >= 60000) meta.push(h('span', { style: { color: 'var(--accent)' } }, '◷ ' + DW.dur(t.focusMs / 60000)));
    if (g) meta.push(h('span.row', { style: { gap: '5px' } }, h('span.gdot', { style: { '--c': g.color } }), g.title));
    const today = DW.today();
    return h('div.task' + (t.done ? '.done' : ''), { draggable: true, ondragstart: e => e.dataTransfer.setData('text/task', t.id), ondblclick: () => editTask(t) },
      h('button.check' + (t.done ? '.on' : ''), { onclick: () => save({ id: t.id, done: !t.done, doneAt: !t.done ? Date.now() : null }) }),
      h('div.body', h('div.title', t.title), h('div.meta', meta), t.notes ? h('div.dim', { style: { fontSize: '12px', marginTop: '3px', whiteSpace: 'pre-wrap' } }, t.notes) : null),
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
    parts.push(h('div.sec-title', d === today ? 'Сегодня' : 'Задачи'), tasks.length ? tasks.map(t => taskRow(t)) : h('div.empty', 'Нет задач. Перетащи из бэклога или добавь выше'));
    return h('div.col', { style: { flex: 1, minHeight: 0 } },
      h('div', h('div.day-title', DW.longDate(d)),
        h('div.muted', { style: { fontSize: '12.5px' } }, [
          tasks.length ? `${doneN}/${tasks.length} готово` : null,
          est ? `осталось ≈ ${DW.dur(est)}` : null,
          fm >= 1 ? `фокус ${DW.dur(fm)}` : null].filter(Boolean).join(' · ') || ' ')),
      addInput('Добавить задачу… (14:00, !1, 50м)', o => ({ ...o, date: d, done: false })),
      h('div.scroll', parts));
  }

  function backlogPanel() {
    const list = sortTasks(DW.state.tasks.filter(t => !t.date && !t.done));
    const done = DW.state.tasks.filter(t => !t.date && t.done);
    return h('div.col', { style: { flex: 1, minHeight: 0 } },
      h('div', h('div.day-title', 'Бэклог'), h('div.muted', { style: { fontSize: '12.5px' } }, 'Планы на будущее без даты. Перетащи задачу на день в календаре.')),
      addInput('Идея или задача на потом…', o => ({ ...o, date: null, done: false })),
      h('div.scroll',
        list.length ? list.map(t => taskRow(t)) : h('div.empty', 'Бэклог пуст'),
        done.length ? [h('div.sec-title', 'Сделано · ' + done.length), done.slice(-10).map(t => taskRow(t))] : null));
  }

  function goalsPanel() {
    const goals = DW.state.goals.filter(g => !g.archived);
    return h('div.col', { style: { flex: 1, minHeight: 0 } },
      h('div.row', h('div', h('div.day-title', 'Цели'), h('div.muted', { style: { fontSize: '12.5px' } }, 'Большие цели. Привязывай к ним задачи — прогресс считается сам.')),
        h('div.spacer'), h('button.btn.sm', { onclick: () => editGoal({}) }, '+ Цель')),
      h('div.scroll', goals.length ? goals.map(goalCard) : h('div.empty', 'Добавь первую цель: «Запустить Deepwork на GitHub», «Выучить английский до B2»…')));
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
        h('span', `${done}/${tasks.length} задач`), focus >= 1 ? h('span', '◷ ' + DW.dur(focus)) : null, h('div.spacer'), h('span', dl)));
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
      const prioSeg = h('div.seg', [[1, 'Важно'], [2, 'Обычно'], [3, 'Потом']].map(([k, l]) =>
        h('button' + (prio === k ? '.on' : ''), { onclick: e => { prio = k; [...prioSeg.children].forEach(b => b.classList.toggle('on', b === e.target)); } }, l)));
      const goal = h('select.select.input', h('option', { value: '' }, '— без цели —'),
        DW.state.goals.filter(g => !g.archived).map(g => h('option', { value: g.id, selected: g.id === o.goalId }, g.title)));
      const notes = h('textarea.input', { placeholder: 'Заметки, ссылки, подзадачи', style: { fontFamily: 'var(--font)', fontSize: '13px', minHeight: '70px' } }, o.notes || '');
      const doSave = async () => {
        if (!title.value.trim()) return title.focus();
        await save({ ...o, title: title.value.trim(), date: date.value || null, time: time.value, est: +est.value || 0, prio, goalId: goal.value || null, notes: notes.value });
        close();
      };
      title.addEventListener('keydown', e => e.key === 'Enter' && doSave());
      m.append(h('h2', o.id ? 'Задача' : 'Новая задача'),
        h('div.form',
          h('span.label', 'Название'), title,
          h('span.label', 'Дата'), h('div.row', date, h('button.btn.ghost.sm', { onclick: () => { date.value = ''; } }, 'в бэклог')),
          h('span.label', 'Время'), time,
          h('span.label', 'Оценка, мин'), est,
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
      const notes = h('textarea.input', { placeholder: 'Зачем это и как пойму, что готово', style: { fontFamily: 'var(--font)', fontSize: '13px', minHeight: '70px' } }, o.notes || '');
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
          o.id ? h('button.btn', { onclick: () => { window.dw.call('goals:save', { id: o.id, archived: true }); close(); } }, 'Достигнута ✓') : null,
          h('button.btn', { onclick: () => close() }, 'Отмена'),
          h('button.btn.primary', { onclick: doSave }, 'Сохранить')));
    });
  }

  DW.views.plan = { render, title: 'План' };
})();
