// Unit tests for the pure parts of the core. Run: npm test (node --test, no extra deps).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const MIN = 60000;

test('session: pomodoro phases, long break, total focus', t => {
  let now = 1e12;
  t.mock.method(Date, 'now', () => now);
  const { Session } = require('../core/session');
  const s = new Session(); clearInterval(s.timer);
  const fin = []; s.on('finish', r => fin.push(r));
  s.start({ mode: 'pomodoro', level: 2, focus: 25, short: 5, long: 15, rounds: 4, longEvery: 2 });
  const seq = [];
  while (s.state) { now = s.state.phaseEnd; s.tick(); seq.push(s.state ? s.state.phase + s.state.round : 'end'); }
  assert.deepEqual(seq, ['short1', 'focus2', 'long2', 'focus3', 'short3', 'focus4', 'end']);
  assert.equal(fin[0].focusMs, 100 * MIN);
  assert.equal(fin[0].result, 'done');
});

test('session: idle time is not focus', t => {
  let now = 1e12;
  t.mock.method(Date, 'now', () => now);
  const { Session } = require('../core/session');
  const s = new Session(); clearInterval(s.timer);
  const fin = []; s.on('finish', r => fin.push(r));
  s.start({ mode: 'custom', custom: 60, level: 1 });
  now += 20 * MIN;
  s.addIdle(10 * MIN);
  assert.equal(s.focusSoFar(), 10 * MIN);
  now = s.state.phaseEnd; s.tick();
  assert.equal(fin[0].focusMs, 50 * MIN);
  assert.equal(fin[0].idleMs, 10 * MIN);
});

test('session: exit waits and friction', t => {
  let now = 1e12;
  t.mock.method(Date, 'now', () => now);
  const { Session } = require('../core/session');
  const s = new Session(); clearInterval(s.timer);
  s.start({ mode: 'custom', custom: 90, level: 3, exitWait: 60 });
  assert.equal(s.confirmStop().ok, false); // must request first
  s.requestStop(); now += 30000;
  assert.equal(s.confirmStop().ok, false);
  now += 31000;
  assert.equal(s.confirmStop().ok, true);
  assert.equal(s.state, null);
});

test('session: pause shifts the end, restore fast-forwards', t => {
  let now = 1e12;
  t.mock.method(Date, 'now', () => now);
  const { Session } = require('../core/session');
  const s = new Session(); clearInterval(s.timer);
  s.start({ mode: 'custom', custom: 30, level: 1, canPause: true });
  const end = s.state.phaseEnd;
  s.pause(); now += 10 * MIN; s.resume();
  assert.equal(s.state.phaseEnd - end, 10 * MIN);
  const saved = JSON.parse(JSON.stringify({ ...s.state, mode: 'pomodoro', rounds: 2, durations: { focus: 30, short: 5, long: 15 } }));
  const s2 = new Session(); clearInterval(s2.timer);
  now = saved.phaseEnd + 6 * MIN; // app was closed through the break
  s2.restore(saved);
  assert.equal(s2.state.phase + s2.state.round, 'focus2');
});

test('scheduler: warning, start, once a day', () => {
  const { due, dailyDue } = require('../core/scheduler');
  const it = { id: 'a', days: [3], time: '10:00', minutes: 50 }; // Thursday
  const thu = (h, m) => new Date(2026, 9, 22, h, m); // 2026-10-22 is a Thursday
  const fired = new Set();
  assert.deepEqual(due([it], thu(9, 57), fired).map(e => e.type), []);
  const w = due([it], thu(9, 59), fired); assert.deepEqual(w.map(e => e.type), ['warn']); fired.add(w[0].key);
  const st = due([it], thu(10, 1), fired); assert.deepEqual(st.map(e => e.type), ['start']); fired.add(st[0].key);
  assert.equal(due([it], thu(10, 2), fired).length, 0);
  assert.equal(due([{ ...it, days: [0] }], thu(10, 1), new Set()).length, 0); // not on Thursday
  assert.equal(dailyDue('21:30', thu(21, 31), null), true);
  assert.equal(dailyDue('21:30', thu(21, 31), '2026-10-22'), false);
  assert.equal(dailyDue('21:30', thu(20, 0), null), false);
});

test('calendar: weekly rule with exception and all-day event', () => {
  const c = require('../core/calendar');
  const ics = ['BEGIN:VCALENDAR', 'BEGIN:VEVENT', 'UID:w', 'DTSTART:20261005T180000', 'DTEND:20261005T190000',
    'RRULE:FREQ=WEEKLY;BYDAY=MO,WE;UNTIL=20261231T000000Z', 'EXDATE:20261026T180000', 'SUMMARY:Gym', 'END:VEVENT',
    'BEGIN:VEVENT', 'UID:d', 'DTSTART;VALUE=DATE:20261024', 'DTEND;VALUE=DATE:20261025', 'SUMMARY:Off\\, rest', 'END:VEVENT', 'END:VCALENDAR'].join('\r\n');
  const ev = c.expand(c.parseEvents(ics), new Date(2026, 9, 20), new Date(2026, 10, 3));
  const days = ev.map(e => new Date(e.start).getDate() + (e.allDay ? 'A' : ''));
  assert.deepEqual(days, ['21', '24A', '28', '2']); // 26th excluded, Nov 2 included
  assert.equal(ev[1].title, 'Off, rest');
});

test('hosts: block is added and removed cleanly', () => {
  const { hostsFile } = require('../core/hosts');
  const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'dw-')), 'hosts');
  fs.writeFileSync(f, '127.0.0.1 localhost\n');
  const h = hostsFile(f, '\n');
  const withBlock = h.build(['tiktok.com', 'store.steampowered.com']);
  assert.match(withBlock, /0\.0\.0\.0 tiktok\.com\n0\.0\.0\.0 www\.tiktok\.com\n0\.0\.0\.0 store\.steampowered\.com\n/);
  fs.writeFileSync(f, withBlock);
  assert.equal(h.hasBlock(), true);
  assert.equal(h.build([]), '127.0.0.1 localhost\n');
});

test('summary: norms, days off and streak', () => {
  const S = require('../core/summary');
  const settings = { dailyGoalMin: 60, goalByDow: [null, null, null, null, null, null, 0] }; // Sunday off
  const sess = d => ({ start: new Date(d + 'T10:00:00').getTime(), focusMs: 70 * MIN });
  // Fri, Sat met; Sun is a day off; Mon met → streak 3 counted on Monday
  const sessions = ['2026-10-23', '2026-10-24', '2026-10-26'].map(sess);
  assert.equal(S.goalFor(settings, '2026-10-25'), 0);
  assert.equal(S.streak(settings, sessions, '2026-10-26'), 3);
  assert.equal(S.dur(95), '1 ч 35 мин');
});

test('apps: match by block list and whitelist, safe list wins', () => {
  const { AppWatcher } = require('../core/apps');
  const { appRules } = require('../core/enforcer');
  const D = require('../core/defaults');
  const w = new AppWatcher({ dry: true, log() { } });
  const st = D.defaultSettings();
  // the default lists differ per OS; use names both have (a safe system process comes from the list itself)
  const sysProc = D.APP_SAFE[0];
  const list = [['Telegram', 1, 1, ''], ['Code', 2, 1, ''], [sysProc, 3, 1, ''], ['python', 4, 1, ''], ['Steam', 5, 0, ''], ['figma', 6, 1, '']];
  const block = w.match(list, appRules(st, D.levelConfig(st, 2))).map(v => v.name);
  assert.deepEqual(block.sort(), ['steam', 'telegram']);
  const monk = w.match(list, appRules(st, D.levelConfig(st, 4))).map(v => v.name);
  assert.ok(!monk.includes('code') && !monk.includes(sysProc) && !monk.includes('python') && !monk.includes('figma'));
  assert.ok(monk.includes('telegram'));
  // apps of the session's preset are never closed
  assert.deepEqual(w.match(list, appRules(st, D.levelConfig(st, 2), ['telegram'])).map(v => v.name), ['steam']);
});

test('datahome: backups rotate, bad files are refused', () => {
  const { DataHome, parse } = require('../core/datahome');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dw-'));
  const home = new DataHome(dir);
  fs.writeFileSync(home.file(), JSON.stringify({ settings: {}, tasks: [], sessions: [] }));
  assert.ok(home.backup());
  assert.equal(home.backups().length, 1);
  assert.throws(() => parse('nope'), /не JSON/);
  assert.throws(() => parse('{"a":1}'), /нет данных/);
  assert.ok(parse(fs.readFileSync(home.file(), 'utf8')));
});

test('updates: version compare', () => {
  const { newer } = require('../core/updates');
  assert.equal(newer('v0.2.0', '0.1.9'), true);
  assert.equal(newer('0.1.0', '0.1.0'), false);
  assert.equal(newer('1.0', '0.9.9'), true);
});
