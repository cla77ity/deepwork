// Minimal iCalendar (.ics) reader: VEVENT with DTSTART/DTEND/SUMMARY and simple RRULEs
// (DAILY/WEEKLY/MONTHLY with INTERVAL, BYDAY, UNTIL, COUNT, EXDATE). Enough for a Google Calendar
// "secret address in iCal format". Times become local Date objects.

function unfold(text) {
  return text.replace(/\r\n/g, '\n').replace(/\n[ \t]/g, '');
}

// "20261022T140000Z" | "20261022T140000" (floating/TZID → treated as local) | "20261022" (all-day)
function parseDate(v) {
  const m = v.match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})(Z)?)?$/);
  if (!m) return null;
  const [, y, mo, d, hh, mi, ss, z] = m;
  if (hh == null) return { date: new Date(+y, +mo - 1, +d), allDay: true };
  const date = z ? new Date(Date.UTC(+y, +mo - 1, +d, +hh, +mi, +ss)) : new Date(+y, +mo - 1, +d, +hh, +mi, +ss);
  return { date, allDay: false };
}

const unescape = s => s.replace(/\\n/gi, '\n').replace(/\\([,;\\])/g, '$1');
const DAYS = { MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6, SU: 0 };

function parseEvents(text) {
  const out = [];
  let cur = null;
  for (const line of unfold(text).split('\n')) {
    if (line === 'BEGIN:VEVENT') { cur = { exdates: [] }; continue; }
    if (line === 'END:VEVENT') { if (cur && cur.start) out.push(cur); cur = null; continue; }
    if (!cur) continue;
    const i = line.indexOf(':');
    if (i < 0) continue;
    const [name] = line.slice(0, i).split(';');
    const value = line.slice(i + 1);
    if (name === 'DTSTART') { const p = parseDate(value); if (p) { cur.start = p.date; cur.allDay = p.allDay; } }
    else if (name === 'DTEND') { const p = parseDate(value); if (p) cur.end = p.date; }
    else if (name === 'SUMMARY') cur.title = unescape(value);
    else if (name === 'UID') cur.uid = value;
    else if (name === 'RRULE') cur.rrule = Object.fromEntries(value.split(';').map(kv => kv.split('=')));
    else if (name === 'EXDATE') value.split(',').forEach(v => { const p = parseDate(v); if (p) cur.exdates.push(+p.date); });
    else if (name === 'STATUS' && value === 'CANCELLED') cur.cancelled = true;
  }
  return out.filter(e => !e.cancelled);
}

// All occurrences overlapping [from, to)
function expand(events, from, to) {
  const res = [];
  for (const e of events) {
    const dur = (e.end ? +e.end : +e.start + (e.allDay ? 86400000 : 3600000)) - +e.start;
    const push = start => {
      if (e.exdates.includes(+start)) return;
      const end = new Date(+start + dur);
      if (end > from && start < to) res.push({ id: (e.uid || e.title) + '@' + +start, title: e.title || '(без названия)', start: +start, end: +end, allDay: !!e.allDay });
    };
    if (!e.rrule) { push(e.start); continue; }
    const r = e.rrule;
    const step = Math.max(1, +(r.INTERVAL || 1));
    const until = r.UNTIL ? (parseDate(r.UNTIL) || {}).date : null;
    const maxCount = r.COUNT ? +r.COUNT : Infinity;
    const byDay = r.BYDAY ? r.BYDAY.split(',').map(d => DAYS[d.slice(-2)]).filter(d => d != null) : null;
    let n = 0;
    const base = new Date(e.start);
    for (let k = 0; k < 2000 && n < maxCount; k++) {
      const occ = [];
      if (r.FREQ === 'DAILY') occ.push(new Date(base.getFullYear(), base.getMonth(), base.getDate() + k * step, base.getHours(), base.getMinutes(), base.getSeconds()));
      else if (r.FREQ === 'WEEKLY') {
        const weekStart = new Date(base.getFullYear(), base.getMonth(), base.getDate() - ((base.getDay() + 6) % 7) + k * 7 * step, base.getHours(), base.getMinutes(), base.getSeconds());
        for (const d of (byDay || [base.getDay()]).sort((a, b) => ((a + 6) % 7) - ((b + 6) % 7))) {
          occ.push(new Date(weekStart.getFullYear(), weekStart.getMonth(), weekStart.getDate() + ((d + 6) % 7), base.getHours(), base.getMinutes(), base.getSeconds()));
        }
      } else if (r.FREQ === 'MONTHLY') occ.push(new Date(base.getFullYear(), base.getMonth() + k * step, base.getDate(), base.getHours(), base.getMinutes(), base.getSeconds()));
      else { push(e.start); break; }
      let past = false;
      for (const o of occ) {
        if (o < base) continue;
        if ((until && o > until) || n >= maxCount) { past = true; break; }
        n++;
        if (o >= to) { past = true; break; }
        push(o);
      }
      if (past) break;
    }
  }
  return res.sort((a, b) => a.start - b.start);
}

module.exports = { parseEvents, expand, parseDate };
