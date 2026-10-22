// Scheduled sessions: what is due at a given moment. Pure function, the main process keeps `fired`.
// item: { id, name, days: [0..6 Mon-based], time: 'HH:MM', minutes, level, presetId, auto, contract, active }
const ymd = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const WARN_MS = 2 * 60000; // heads-up two minutes before
const LATE_MS = 5 * 60000; // still start if the app was busy/asleep for up to 5 minutes

function due(items, now, fired) {
  const out = [];
  const dow = (now.getDay() + 6) % 7;
  const date = ymd(now);
  for (const it of items || []) {
    if (it.active === false || !(it.days || []).includes(dow) || !/^\d{1,2}:\d{2}$/.test(it.time || '')) continue;
    const [hh, mm] = it.time.split(':').map(Number);
    const diff = now - new Date(now.getFullYear(), now.getMonth(), now.getDate(), hh, mm);
    const warn = `${it.id}@${date}:warn`, start = `${it.id}@${date}:start`;
    if (diff >= -WARN_MS && diff < 0 && !fired.has(warn)) out.push({ type: 'warn', item: it, key: warn });
    if (diff >= 0 && diff < LATE_MS && !fired.has(start)) out.push({ type: 'start', item: it, key: start });
  }
  return out;
}

// once a day at `time` ('HH:MM'), if not done yet today
function dailyDue(time, now, lastDate) {
  if (!/^\d{1,2}:\d{2}$/.test(time || '') || lastDate === ymd(now)) return false;
  const [hh, mm] = time.split(':').map(Number);
  return now.getHours() * 60 + now.getMinutes() >= hh * 60 + mm;
}

module.exports = { due, dailyDue, ymd };
