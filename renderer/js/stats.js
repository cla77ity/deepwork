// Stats view: KPI tiles, 26-week heatmap, 14-day bars, top distractions, recent sessions.
(function () {
  const { h } = DW;

  // one shared hover tooltip for all marks
  let tip;
  function hover(el, text) {
    el.addEventListener('mouseenter', () => {
      if (!tip) { tip = h('div.tip'); document.body.append(tip); }
      tip.textContent = text;
      tip.classList.add('show');
    });
    el.addEventListener('mousemove', e => { tip.style.left = e.clientX + 12 + 'px'; tip.style.top = e.clientY - 34 + 'px'; });
    el.addEventListener('mouseleave', () => tip.classList.remove('show'));
  }

  function render(root) {
    const st = DW.state;
    const by = DW.focusByDay();
    const today = DW.today();
    const goal = DW.goalFor(today);
    const sum = days => { let m = 0; for (let i = 0; i < days; i++) m += by[DW.addDays(today, -i)] || 0; return m; };
    const total = st.sessions.reduce((a, s) => a + s.focusMs, 0) / 60000;
    const done = st.sessions.filter(s => s.result === 'done').length;
    const weekAgo = Date.now() - 7 * 86400000;
    const distractWeek = st.sessions.filter(s => s.start >= weekAgo).reduce((a, s) =>
      a + Object.values(s.attempts.sites).reduce((x, y) => x + y, 0) + Object.values(s.attempts.apps).reduce((x, y) => x + y, 0), 0);

    // best streak over history
    let best = 0, cur = 0;
    const daysSorted = Object.keys(by).sort();
    if (daysSorted.length) {
      // same rule as the live streak: days off don't break it
      for (let d = daysSorted[0]; d <= today; d = DW.addDays(d, 1)) {
        if (DW.metGoal(by, d)) cur++; else if (DW.goalFor(d) > 0 && d !== today) cur = 0;
        best = Math.max(best, cur);
      }
    }
    const streak = DW.streak();

    const kpi = (k, v, s) => h('div.kpi', h('div.k', k), h('div.v', v), h('div.s', s));
    root.append(h('div.view-head', h('h1', 'Статистика')),
      h('div.kpis.stagger',
        kpi('Сегодня', DW.dur(by[today] || 0), goal ? `норма — ${DW.dur(goal)}` : 'выходной'),
        kpi('7 дней', DW.dur(sum(7)), `в среднем ${DW.dur(sum(7) / 7)} в день`),
        kpi('Всего', DW.dur(total), DW.count(st.sessions.length, 'сессия', 'сессии', 'сессий')),
        kpi('Серия', DW.count(streak, 'день', 'дня', 'дней'), `рекорд — ${DW.count(best, 'день', 'дня', 'дней')}`),
        kpi('Доведено до конца', st.sessions.length ? Math.round(done / st.sessions.length * 100) + '%' : '—', `${done} из ${st.sessions.length}`),
        kpi('Отвлечений за 7 дней', String(distractWeek), 'попыток открыть заблокированное')));

    root.append(h('div.stats-grid.stagger', heatmap(by), bars(by, st.settings.dailyGoalMin), distractions(), recent()));
  }

  function heatmap(by) {
    const today = DW.today();
    const weeks = 26;
    const dow = (DW.parse(today).getDay() + 6) % 7;
    const start = DW.addDays(today, -(weeks - 1) * 7 - dow);
    const grid = h('div.heat');
    for (let i = 0; i < weeks * 7; i++) {
      const d = DW.addDays(start, i);
      const m = by[d] || 0;
      const cell = h('i');
      if (d > today) cell.style.visibility = 'hidden';
      else if (m > 0) {
        // 4 sequential steps of the accent: <25%, <60%, <100%, >= that day's norm
        const g = DW.goalFor(d);
        const r = g ? m / g : 1;
        cell.style.background = `rgba(232,236,255,${r >= 1 ? 0.95 : r >= 0.6 ? 0.6 : r >= 0.25 ? 0.34 : 0.16})`;
        if (r >= 1) cell.style.boxShadow = '0 0 6px rgba(180,195,255,.35)';
      }
      hover(cell, `${DW.parse(d).getDate()} ${DW.MONTHS_GEN[DW.parse(d).getMonth()]}: ${m ? DW.dur(m) : 'нет фокуса'}`);
      grid.append(cell);
    }
    const legend = h('div.row.muted', { style: { fontSize: '11.5px', gap: '5px', marginTop: '10px' } }, 'меньше',
      [0.04, 0.16, 0.34, 0.6, 0.95].map((a, i) => h('i', { style: { width: '11px', height: '11px', borderRadius: '3px', background: i ? `rgba(232,236,255,${a})` : 'rgba(255,255,255,.04)' } })), 'норма');
    return h('div.card', h('h3', 'Полгода фокуса'), h('div', { style: { overflowX: 'auto' } }, grid), legend);
  }

  function bars(by, goal) {
    const today = DW.today();
    const days = [...Array(14)].map((_, i) => DW.addDays(today, i - 13));
    const vals = days.map(d => by[d] || 0);
    const max = Math.max(goal * 1.15, ...vals);
    const wrap = h('div.bars');
    days.forEach((d, i) => {
      const v = vals[i];
      const bar = h('i' + (DW.metGoal(by, d) ? '' : '.under'), { style: { height: (v / max * 100) + '%' } });
      const col = h('div.b', bar, h('span', DW.DOW[(DW.parse(d).getDay() + 6) % 7]));
      const g = DW.goalFor(d);
      hover(col, `${DW.longDate(d)}: ${v ? DW.dur(v) : 'нет фокуса'}${g ? ' из ' + DW.dur(g) : ' · выходной'}`);
      wrap.append(col);
    });
    // the bar area is 100% minus the day labels row (~17px)
    wrap.append(h('div.goal-line', { style: { bottom: `calc(17px + (100% - 23px) * ${goal / max})` } }, h('span', 'норма ' + DW.durShort(goal))));
    return h('div.card', h('h3', 'Последние 14 дней'), wrap);
  }

  function distractions() {
    const since = Date.now() - 30 * 86400000;
    const agg = {};
    for (const s of DW.state.sessions) {
      if (s.start < since) continue;
      for (const [k, n] of Object.entries(s.attempts.sites)) agg[k] = (agg[k] || 0) + n;
      for (const [k, n] of Object.entries(s.attempts.apps)) agg[k + ' (прогр.)'] = (agg[k + ' (прогр.)'] || 0) + n;
    }
    const top = Object.entries(agg).sort((a, b) => b[1] - a[1]).slice(0, 8);
    const max = top.length ? top[0][1] : 1;
    return h('div.card', h('h3', 'Что тянет отвлечься · 30 дней'),
      top.length ? top.map(([k, n], i) => h('div.dist', { style: { '--i': i } }, h('span', { style: { width: '170px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, k),
        h('div.bar', h('i', { style: { width: n / max * 100 + '%' } })), h('span.num.muted', { style: { width: '34px', textAlign: 'right' } }, String(n))))
        : h('div.empty', 'За 30 дней ни одной попытки'));
  }

  function recent() {
    const list = DW.state.sessions.slice(-12).reverse();
    const lvlName = n => (DW.levelCfg(n) || {}).name || n;
    return h('div.card', h('h3', 'Последние сессии'),
      list.length ? h('table.sess', h('tr', h('th', 'Когда'), h('th', 'Фокус'), h('th', 'Уровень'), h('th', 'Цель'), h('th', '')),
        list.map(s => h('tr',
          h('td.num', `${DW.parse(DW.ymd(s.start)).getDate()} ${DW.MONTHS_GEN[new Date(s.start).getMonth()].slice(0, 3)} ${DW.hhmm(s.start)}`),
          h('td.num', DW.dur(s.focusMs / 60000)),
          h('td', lvlName(s.level)),
          h('td', { style: { maxWidth: '200px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, s.goal || h('span.dim', '—')),
          h('td.res-' + s.result, s.result === 'done' ? 'завершена' : 'прервана'))))
        : h('div.empty', 'Здесь появятся завершённые сессии'));
  }

  DW.views.stats = { render, title: 'Статистика' };
})();
