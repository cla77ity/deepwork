// Seeds a throwaway profile with sample tasks, goals and sessions (for screenshots/tests).
// node tools/demo-data.js <profileDir>
const fs = require('fs');
const path = require('path');
const { defaultSettings } = require('../core/defaults');

const dir = path.resolve(process.argv[2] || 'demo-profile');
fs.mkdirSync(dir, { recursive: true });
const ymd = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const day = n => { const d = new Date(); d.setDate(d.getDate() + n); return ymd(d); };
let id = 0;
const nid = () => 'd' + (++id);

const goals = [
  { id: 'g1', title: 'Выпустить Deepwork на GitHub', deadline: day(20), color: '#6d7cff', createdAt: Date.now() },
  { id: 'g2', title: 'Английский до B2', deadline: day(90), color: '#3ecf8e', createdAt: Date.now() },
  { id: 'g3', title: 'Lume Client 1.0', deadline: day(-2), color: '#f5b04a', createdAt: Date.now() },
];
const T = (title, date, extra = {}) => ({ id: nid(), title, date, done: false, prio: 2, est: 0, time: '', goalId: null, notes: '', createdAt: Date.now() - id * 1000, ...extra });
const tasks = [
  T('Расширение для Brave: чистка YouTube', day(0), { time: '10:00', est: 90, prio: 1, goalId: 'g1', focusMs: 50 * 60000 }),
  T('Календарь планов', day(0), { time: '13:30', est: 60, goalId: 'g1', done: true }),
  T('Урок английского', day(0), { time: '18:00', est: 45, goalId: 'g2' }),
  T('README и скриншоты', day(1), { est: 40, goalId: 'g1' }),
  T('Тест на всех уровнях', day(2), { prio: 1, goalId: 'g1' }),
  T('Shaders для ClickGUI', day(-1), { goalId: 'g3', prio: 1 }),
  T('Слова: 50 новых', day(3), { goalId: 'g2', est: 30 }),
  T('Созвон с другом про NemGlobal', day(4), { time: '19:00' }),
  T('Разобрать почту', day(-3), { done: true }),
  T('Спортзал', day(1), { time: '08:00', prio: 3 }),
  T('Сделать бэкап проектов', day(6)),
  T('Отчёт OneCrypto', day(2), { time: '09:00' }),
  T('Идея: мобильное приложение-компаньон', null, { prio: 3 }),
  T('Прочитать «Deep Work» Кэла Ньюпорта', null, {}),
  T('Firefox-версия расширения', null, { goalId: 'g1' }),
];
const sessions = [];
for (let i = 1; i <= 120; i++) {
  if (Math.random() < 0.28) continue;
  const d = new Date(); d.setDate(d.getDate() - i); d.setHours(10 + Math.floor(Math.random() * 6), 0, 0, 0);
  const n = 1 + Math.floor(Math.random() * 3);
  for (let k = 0; k < n; k++) {
    const focus = [25, 50, 90, 100][Math.floor(Math.random() * 4)] * 60000;
    const start = d.getTime() + k * 2 * 3600000;
    sessions.push({ id: 's' + i + k, start, end: start + focus, focusMs: focus, mode: 'pomodoro', level: 1 + Math.floor(Math.random() * 3), goal: ['Код', 'Учёба', 'Дизайн', ''][k % 4], taskId: null,
      result: Math.random() < 0.85 ? 'done' : 'abandoned', rounds: 4,
      attempts: { sites: Math.random() < 0.5 ? { 'youtube.com': 2, 'vk.com': 1 } : {}, apps: Math.random() < 0.2 ? { telegram: 1 } : {} } });
  }
}
const t0 = new Date(); t0.setHours(9, 30, 0, 0);
sessions.push({ id: 'today1', start: t0.getTime(), end: t0.getTime() + 50 * 60000, focusMs: 50 * 60000, mode: 'pomodoro', level: 2, goal: 'Расширение для Brave', taskId: tasks[0].id, result: 'done', rounds: 2, attempts: { sites: { 'tiktok.com': 3 }, apps: {} } });
sessions.sort((a, b) => a.start - b.start);

fs.writeFileSync(path.join(dir, 'data.json'), JSON.stringify({ v: 1, settings: defaultSettings(), tasks, goals, sessions }, null, 1));
try { fs.unlinkSync(path.join(dir, 'state.json')); } catch { }
console.log('demo profile at', dir);
