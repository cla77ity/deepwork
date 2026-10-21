// Journal view: a day page (mood, energy, notes, auto summary) and a week review with insights.
(function () {
  const { h } = DW;
  const ui = { mode: 'day', date: null };
  const MOOD = ['ужасно', 'плохо', 'нормально', 'хорошо', 'отлично'];
  const ENERGY = ['на нуле', 'мало', 'средне', 'много', 'на пике'];

  const entry = d => DW.state.journal[d] || {};
  let saveT = {};
  // autosave per field; the view isn't re-rendered while a textarea has focus (see app.js)
  const save = (d, patch, now) => {
    const key = d + Object.keys(patch).join();
    clearTimeout(saveT[key]);
    const go = () => window.dw.call('journal:save', d, patch);
    if (now) go(); else saveT[key] = setTimeout(go, 500);
  };

  function sessionsOn(d) { return DW.state.sessions.filter(s => DW.ymd(s.start) === d); }

  function render(root) {
    if (!ui.date) ui.date = DW.today();
    const shift = n => { ui.date = DW.addDays(ui.date, ui.mode === 'week' ? n * 7 : n); DW.entering = true; DW.render(); };
    const mon = DW.addDays(ui.date, -DW.dowOf(ui.date));
    const label = ui.mode === 'day' ? DW.longDate(ui.date) : weekLabel(mon);
    root.append(h('div.view-head', h('h1', 'Журнал'),
      h('div.seg', { style: { marginLeft: '6px', alignSelf: 'center' } }, [['day', 'День'], ['week', 'Неделя']].map(([k, l]) =>
        h('button' + (ui.mode === k ? '.on' : ''), { onclick: () => { ui.mode = k; DW.entering = true; DW.render(); } }, l))),
      h('div.spacer'),
      h('div.row', { style: { alignSelf: 'center', gap: '4px' } },
        DW.iconBtn('left', ui.mode === 'day' ? 'Предыдущий день' : 'Прошлая неделя', () => shift(-1)),
        h('span', { style: { minWidth: '200px', textAlign: 'center', fontWeight: 500 } }, label),
        DW.iconBtn('right', ui.mode === 'day' ? 'Следующий день' : 'Следующая неделя', () => shift(1)),
        h('button.btn.sm', { style: { marginLeft: '8px' }, onclick: () => { ui.date = DW.today(); DW.entering = true; DW.render(); } }, 'Сегодня'))));
    root.append(ui.mode === 'day' ? dayPage(ui.date) : weekPage(mon));
  }

  const weekLabel = mon => {
    const sun = DW.addDays(mon, 6), a = DW.parse(mon), b = DW.parse(sun);
    return a.getMonth() === b.getMonth() ? `${a.getDate()}–${b.getDate()} ${DW.MONTHS_GEN[b.getMonth()]}` : `${a.getDate()} ${DW.MONTHS_GEN[a.getMonth()]} – ${b.getDate()} ${DW.MONTHS_GEN[b.getMonth()]}`;
  };

  // ---------------------------------------------------------------- day
  function scale(d, key, labels) {
    const cur = entry(d)[key];
    const row = h('div.scale');
    labels.forEach((l, i) => row.append(h('button' + (cur === i + 1 ? '.on' : ''), {
      title: l,
      onclick: () => save(d, { [key]: cur === i + 1 ? null : i + 1 }, true),
    }, h('i'), h('span', l))));
    return row;
  }

  function field(d, key, title, placeholder, extra) {
    const ta = h('textarea.input.jtext', { placeholder, oninput: e => save(d, { [key]: e.target.value }) }, entry(d)[key] || '');
    return h('div.jfield', h('div.row', h('div.lbl', title), h('div.spacer'), extra || null), ta);
  }

  function toTomorrow(d) {
    const lines = (entry(d).tomorrow || '').split('\n').map(l => l.replace(/^[-•*\d.)\s]+/, '').trim()).filter(Boolean);
    if (!lines.length) return DW.toast('Сначала напиши план — по задаче в строке');
    const date = DW.addDays(d, 1);
    lines.forEach(title => window.dw.call('tasks:save', { title, date, done: false, prio: 2, est: 0, time: '', goalId: null, notes: '' }));
    DW.toast(`${DW.count(lines.length, 'задача добавлена', 'задачи добавлены', 'задач добавлено')} на ${DW.longDate(date).toLowerCase()}`);
  }

  function dayPage(d) {
    const e = entry(d);
    const main = h('div.card.jmain',
      h('div.jrow',
        h('div', h('div.lbl', 'Настроение'), scale(d, 'mood', MOOD)),
        h('div', h('div.lbl', 'Энергия'), scale(d, 'energy', ENERGY))),
      field(d, 'wins', 'Что получилось', 'Что сделал, чем доволен'),
      field(d, 'blockers', 'Что мешало', 'Что отвлекало, где буксовал, что сделать иначе'),
      field(d, 'tomorrow', 'План на завтра', 'По задаче в строке',
        h('button.btn.ghost.sm', { onclick: () => toTomorrow(d) }, DW.svg(DW.icons.next), 'В план на завтра')),
      field(d, 'text', 'Мысли', 'Всё остальное'));
    return h('div.jgrid.stagger', main, h('div.col', { style: { gap: '16px' } }, daySummary(d), sessionNotes(e)));
  }

  function daySummary(d) {
    const by = DW.focusByDay();
    const fm = by[d] || 0, goal = DW.goalFor(d);
    const ss = sessionsOn(d);
    const doneS = ss.filter(s => s.result === 'done').length;
    const tasks = DW.state.tasks.filter(t => t.date === d);
    const tasksDone = tasks.filter(t => t.done);
    const routines = DW.routinesFor(d);
    const rDone = routines.filter(r => DW.routineDone(d, r.id)).length;
    const dist = {};
    ss.forEach(s => { for (const [k, n] of Object.entries(s.attempts.sites)) dist[k] = (dist[k] || 0) + n; for (const [k, n] of Object.entries(s.attempts.apps)) dist[k] = (dist[k] || 0) + n; });
    const topDist = Object.entries(dist).sort((a, b) => b[1] - a[1]).slice(0, 3);
    const row = (k, v) => h('div.prot', h('span.muted', k), h('span.v', { style: { color: 'var(--text)' } }, v));
    return h('div.card',
      h('h3', 'Итог дня'),
      h('div', { style: { font: '600 24px var(--font)', letterSpacing: '-.02em' } }, DW.dur(fm),
        h('span.dim', { style: { fontSize: '14px', fontWeight: 400, marginLeft: '6px' } }, goal ? 'из ' + DW.dur(goal) : 'выходной')),
      h('div.jbar', h('i', { style: { width: (goal ? Math.min(100, fm / goal * 100) : 100) + '%' } })),
      row('Сессии', ss.length ? `${doneS} из ${ss.length} до конца` : 'не было'),
      ss.length ? row('Время работы', `${DW.hhmm(Math.min(...ss.map(s => s.start)))}–${DW.hhmm(Math.max(...ss.map(s => s.end)))}`) : null,
      row('Задачи', tasks.length ? `${tasksDone.length} из ${tasks.length}` : 'не было'),
      routines.length ? row('Рутина', `${rDone} из ${routines.length}`) : null,
      row('Отвлечений', topDist.length ? topDist.map(([k, n]) => `${k} ×${n}`).join(', ') : 'нет'),
      tasksDone.length ? h('div', { style: { marginTop: '8px' } }, tasksDone.slice(0, 6).map(t => h('div.prot.sub', '✓ ' + t.title))) : null);
  }

  function sessionNotes(e) {
    const notes = e.notes || [];
    if (!notes.length) return h('div.card', h('h3', 'Заметки после сессий'), h('div.empty', 'Появятся, когда ты оставишь заметку в конце сессии'));
    return h('div.card', h('h3', 'Заметки после сессий'),
      notes.map(n => h('div.jnote', h('div.row.dim', { style: { fontSize: '12px' } }, h('span.num', DW.hhmm(n.at)), n.goal ? h('span', '· ' + n.goal) : null, n.min ? h('span', '· ' + DW.dur(n.min)) : null),
        h('div', { style: { whiteSpace: 'pre-wrap' } }, n.text))));
  }

  // ---------------------------------------------------------------- week
  // upto: only the first N days count (to compare a running week with the same part of another)
  function weekStats(mon, upto = 7) {
    const by = DW.focusByDay();
    const today = DW.today();
    const days = [...Array(upto)].map((_, i) => DW.addDays(mon, i));
    const ss = DW.state.sessions.filter(s => { const d = DW.ymd(s.start); return d >= mon && d <= days[6]; });
    const focus = days.reduce((a, d) => a + (by[d] || 0), 0);
    const norm = days.reduce((a, d) => a + DW.goalFor(d), 0);
    const met = days.filter(d => DW.metGoal(by, d)).length;
    // finished work days only: today and the future can't be "missed" yet
    const workDays = days.filter(d => DW.goalFor(d) > 0 && (d < today || DW.metGoal(by, d))).length;
    const tasksDone = DW.state.tasks.filter(t => t.done && t.date && t.date >= mon && t.date <= days[6]).length;
    let rSched = 0, rDone = 0;
    days.forEach(d => { const rs = DW.routinesFor(d); rSched += rs.length; rDone += rs.filter(r => DW.routineDone(d, r.id)).length; });
    const moods = days.map(d => entry(d).mood).filter(Boolean), energies = days.map(d => entry(d).energy).filter(Boolean);
    const avg = a => a.length ? a.reduce((x, y) => x + y, 0) / a.length : null;
    return { by, days, ss, focus, norm, met, workDays, tasksDone, rSched, rDone, mood: avg(moods), energy: avg(energies) };
  }

  // short, data-backed observations; each only when there is enough data to say it
  function insights(w, prev) {
    const out = [];
    if (prev.focus > 0 && w.focus > 0) {
      const ch = Math.round((w.focus / prev.focus - 1) * 100);
      const same = prev.days.length < 7 ? ` за те же ${DW.count(prev.days.length, 'день', 'дня', 'дней')}` : '';
      if (Math.abs(ch) >= 5) out.push(`Фокуса на ${Math.abs(ch)}% ${ch > 0 ? 'больше' : 'меньше'}, чем неделей раньше${same}.`);
    }
    const best = w.days.reduce((a, d) => (w.by[d] || 0) > (w.by[a] || 0) ? d : a, w.days[0]);
    if ((w.by[best] || 0) > 0) out.push(`Лучший день — ${DW.DOW_FULL[DW.parse(best).getDay()].toLowerCase()}: ${DW.dur(w.by[best])}.`);
    if (w.ss.length >= 3) {
      const parts = { утром: [5, 12], днём: [12, 18], вечером: [18, 24], ночью: [0, 5] };
      const mins = {};
      w.ss.forEach(s => { const hr = new Date(s.start).getHours(); const k = Object.keys(parts).find(p => hr >= parts[p][0] && hr < parts[p][1]); mins[k] = (mins[k] || 0) + s.focusMs / 60000; });
      const top = Object.entries(mins).sort((a, b) => b[1] - a[1])[0];
      if (top) out.push(`Больше всего глубокой работы ${top[0]} — ${Math.round(top[1] / w.focus * 100)}% недели.`);
    }
    const ab = w.ss.filter(s => s.result === 'abandoned');
    if (ab.length) out.push(`${DW.count(ab.length, 'сессия прервана', 'сессии прерваны', 'сессий прервано')} досрочно — загляни в «Что мешало».`);
    const dist = {};
    w.ss.forEach(s => { for (const [k, n] of Object.entries(s.attempts.sites)) dist[k] = (dist[k] || 0) + n; for (const [k, n] of Object.entries(s.attempts.apps)) dist[k] = (dist[k] || 0) + n; });
    const td = Object.entries(dist).sort((a, b) => b[1] - a[1])[0];
    if (td && td[1] >= 3) out.push(`Чаще всего тянуло в ${td[0]} — ${DW.count(td[1], 'попытка', 'попытки', 'попыток')}.`);
    const hi = w.days.filter(d => entry(d).energy >= 4), lo = w.days.filter(d => entry(d).energy && entry(d).energy <= 2);
    if (hi.length && lo.length) {
      const f = ds => ds.reduce((a, d) => a + (w.by[d] || 0), 0) / ds.length;
      out.push(`В дни с высокой энергией — в среднем ${DW.dur(f(hi))} фокуса, с низкой — ${DW.dur(f(lo))}.`);
    }
    if (w.rSched) out.push(`Рутина выполнена на ${Math.round(w.rDone / w.rSched * 100)}%.`);
    return out;
  }

  function weekPage(mon) {
    const w = weekStats(mon);
    // a running week is compared with the same number of days of the previous one
    const elapsed = Math.min(7, Math.max(1, Math.round((DW.parse(DW.today()) - DW.parse(mon)) / 86400000) + 1));
    const prev = weekStats(DW.addDays(mon, -7), elapsed);
    const key = 'week-' + mon;
    const kpi = (k, v, s) => h('div.kpi', h('div.k', k), h('div.v', v), h('div.s', s));
    const fmt1 = x => x == null ? '—' : x.toFixed(1).replace('.', ',');
    const kpis = h('div.kpis.stagger',
      kpi('Фокус', DW.dur(w.focus), w.norm ? `норма недели — ${DW.dur(w.norm)}` : 'без нормы'),
      kpi('Норма выполнена', w.workDays ? `${w.met} из ${w.workDays}` : '—', w.workDays ? DW.plural(w.workDays, 'рабочего дня', 'рабочих дней', 'рабочих дней') : 'рабочие дни ещё впереди'),
      kpi('Сессии', String(w.ss.length), w.ss.length ? `${w.ss.filter(s => s.result === 'done').length} до конца` : '—'),
      kpi('Задачи', String(w.tasksDone), 'выполнено'),
      kpi('Настроение', fmt1(w.mood), 'из 5, в среднем'),
      kpi('Энергия', fmt1(w.energy), 'из 5, в среднем'));

    const table = h('table.sess',
      h('tr', h('th', 'День'), h('th', 'Фокус'), h('th', 'Норма'), h('th', 'Настроение'), h('th', 'Энергия'), h('th', 'Задачи')),
      w.days.map(d => {
        const e = entry(d), g = DW.goalFor(d), fm = w.by[d] || 0;
        const tasks = DW.state.tasks.filter(t => t.date === d);
        return h('tr', { style: { cursor: 'pointer' }, onclick: () => { ui.mode = 'day'; ui.date = d; DW.entering = true; DW.render(); } },
          h('td', DW.DOW[DW.dowOf(d)] + ' ' + DW.parse(d).getDate()),
          h('td.num', fm ? DW.dur(fm) : '—'),
          h('td', !g ? h('span.dim', 'выходной') : DW.metGoal(w.by, d) ? h('span.res-done', 'выполнена') : d > DW.today() ? h('span.dim', '—') : d === DW.today() ? h('span.dim', 'день идёт') : h('span.dim', 'нет')),
          h('td', e.mood ? MOOD[e.mood - 1] : h('span.dim', '—')),
          h('td', e.energy ? ENERGY[e.energy - 1] : h('span.dim', '—')),
          h('td.num', tasks.length ? `${tasks.filter(t => t.done).length}/${tasks.length}` : '—'));
      }));

    const ins = insights(w, prev);
    const collected = (k, title) => {
      const items = w.days.filter(d => (entry(d)[k] || '').trim()).map(d => h('div.jnote', h('div.dim', { style: { fontSize: '12px' } }, DW.DOW[DW.dowOf(d)] + ' ' + DW.parse(d).getDate()), h('div', { style: { whiteSpace: 'pre-wrap' } }, entry(d)[k])));
      return h('div.card', h('h3', title), items.length ? items : h('div.empty', 'Пусто — заполняй страницу дня'));
    };
    const review = h('div.card.jmain',
      h('h3', 'Итог недели'),
      h('textarea.input.jtext', { placeholder: 'Что главное за неделю? Что сработало?', oninput: e => save(key, { summary: e.target.value }) }, entry(key).summary || ''),
      h('div.lbl', { style: { marginTop: '6px' } }, 'Фокус на следующую неделю'),
      h('textarea.input.jtext', { placeholder: 'Одна-три главные вещи', oninput: e => save(key, { next: e.target.value }) }, entry(key).next || ''));

    return h('div.col.stagger', { style: { gap: '16px' } },
      kpis,
      h('div.jgrid', h('div.card', h('h3', 'По дням'), table),
        h('div.card', h('h3', 'Выводы'), ins.length ? h('ul.insights', ins.map(t => h('li', t))) : h('div.empty', 'Мало данных — поработай в фокусе пару дней'))),
      h('div.stats-grid', collected('wins', 'Что получилось'), collected('blockers', 'Что мешало')),
      review);
  }

  DW.views.journal = { render, title: 'Журнал' };
})();
