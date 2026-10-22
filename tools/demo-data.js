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
  { id: 'g1', title: 'Выпустить Deepwork на GitHub', deadline: day(20), color: '#e8ecff', createdAt: Date.now() },
  { id: 'g2', title: 'Английский до B2', deadline: day(90), color: '#8fd2b2', createdAt: Date.now() },
  { id: 'g3', title: 'Lume Client 1.0', deadline: day(-2), color: '#dcc08c', createdAt: Date.now() },
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

const settings = defaultSettings();
settings.presets = [
  { id: 'p1', name: 'Код', apps: [{ name: 'Code', path: 'C:/Program Files/Microsoft VS Code/Code.exe' }], urls: ['github.com', 'claude.ai'] },
  { id: 'p2', name: 'Учёба', apps: [], urls: ['duolingo.com', 'notion.so'] },
];
settings.lastPreset = 'p1';
settings.goalByDow = [null, null, null, null, null, 60, 0];
settings.templates = [
  { id: 't1', name: 'Код 90', mode: 'custom', minutes: 90, level: 3, presetId: 'p1' },
  { id: 't2', name: 'Помодоро', mode: 'pomodoro', focus: 25, short: 5, long: 15, rounds: 4, level: 2, presetId: null },
];
settings.schedule = [{ id: 'sc1', name: 'Утренний код', days: [0, 1, 2, 3, 4], time: '10:00', minutes: 90, level: 3, presetId: 'p1', auto: true, contract: false, active: true }];
settings.limits = [{ domain: 'youtube.com', minutes: 30 }, { domain: 'reddit.com', minutes: 15 }];
settings.onboarded = true;
settings.rituals.lastMorning = ymd(new Date());
const usage = {};
for (let i = 0; i < 8; i++) usage[day(-i)] = { 'youtube.com': 600 + Math.round(Math.random() * 1800), 'github.com': 1800 + Math.round(Math.random() * 3600), 'reddit.com': Math.round(Math.random() * 900), 'claude.ai': 1200 };
const routines = [
  { id: 'r1', title: 'Зарядка', days: [0, 1, 2, 3, 4, 5, 6], time: '08:00', est: 15, createdAt: Date.now() - 40 * 86400000 },
  { id: 'r2', title: '30 минут английского', days: [0, 1, 2, 3, 4], time: '19:00', est: 30, createdAt: Date.now() - 40 * 86400000 },
  { id: 'r3', title: 'Разбор недели', days: [6], time: '20:00', est: 30, createdAt: Date.now() - 40 * 86400000 },
];
const routineLog = {};
for (let i = 0; i < 20; i++) routineLog[day(-i)] = ['r1', 'r2', 'r3'].filter(() => Math.random() < (i === 0 ? 0.5 : 0.75));
const MOODS = [[4, 3], [3, 2], [5, 4], [2, 2], [4, 5], [3, 3], [4, 4]];
const journal = {};
for (let i = 0; i < 7; i++) {
  const [mood, energy] = MOODS[i];
  journal[day(-i)] = { mood, energy,
    wins: ['Доделал чистку YouTube в расширении', 'Закрыл три задачи по Lume', 'Прочитал главу «Deep Work»', '', 'Настроил календарь планов', 'Выучил 40 слов', ''][i],
    blockers: ['', 'Телеграм — 3 раза полез проверять чаты', '', 'Плохо спал, тяжело было включиться', 'YouTube на перерыве затянул', '', ''][i],
    tomorrow: i === 0 ? ['README и скриншоты', 'Тест на всех уровнях'].join('\n') : '' };
}
journal[day(0)].notes = [{ at: Date.now() - 3 * 3600000, text: 'Первые 15 минут раскачивался, потом пошло.', goal: 'Расширение для Brave', min: 50 }];
for (const ss of sessions) {
  const m = ss.focusMs / 1000;
  ss.usage = { apps: { code: Math.round(m * 0.62), brave: Math.round(m * 0.2), telegram: Math.round(m * (Math.random() * 0.1)), explorer: 40 }, sites: {} };
  ss.idleMs = Math.random() < 0.2 ? 6 * 60000 : 0;
}
tasks.push(T('Купить билеты на выходные', null, { parked: true, notes: 'Запарковано во время фокуса: Код' }));
fs.writeFileSync(path.join(dir, 'data.json'), JSON.stringify({ v: 1, settings, tasks, goals, sessions, routines, routineLog, journal, usage, achievements: {} }, null, 1));
try { fs.unlinkSync(path.join(dir, 'state.json')); } catch { }
console.log('demo profile at', dir);
