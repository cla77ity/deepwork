// Day/streak numbers for the main process (Telegram, phone). Same rules as renderer/js/core.js:
// a day's norm is goalByDow[weekday] ?? dailyGoalMin, 0 = day off (doesn't break the streak).
const ymd = d => { d = new Date(d); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const addDays = (s, n) => { const [y, m, d] = s.split('-').map(Number); return ymd(new Date(y, m - 1, d + n)); };
const dow = s => { const [y, m, d] = s.split('-').map(Number); return (new Date(y, m - 1, d).getDay() + 6) % 7; };

function focusByDay(sessions) {
  const map = {};
  for (const s of sessions) { const k = ymd(s.start); map[k] = (map[k] || 0) + s.focusMs / 60000; }
  return map;
}

function goalFor(settings, day) {
  const o = (settings.goalByDow || [])[dow(day)];
  return o == null ? settings.dailyGoalMin : o;
}

function streak(settings, sessions, today = ymd(Date.now())) {
  const by = focusByDay(sessions);
  const met = d => { const g = goalFor(settings, d); return g > 0 && (by[d] || 0) >= g; };
  let n = 0, d = today;
  if (!met(d)) d = addDays(d, -1);
  for (let i = 0; i < 3650; i++, d = addDays(d, -1)) {
    if (met(d)) n++;
    else if (goalFor(settings, d) > 0) break;
  }
  return n;
}

const dur = min => { min = Math.round(min); if (min < 60) return min + ' мин'; const h = Math.floor(min / 60), m = min % 60; return h + ' ч' + (m ? ' ' + m + ' мин' : ''); };

function routinesFor(routines, day) {
  return routines.filter(r => r.active !== false && (r.days || []).includes(dow(day))).sort((a, b) => (a.time || '99').localeCompare(b.time || '99'));
}

module.exports = { ymd, addDays, dow, focusByDay, goalFor, streak, dur, routinesFor };
