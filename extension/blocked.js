const params = new URLSearchParams(location.search);
const mode = params.get('m');
const target = decodeURIComponent(location.hash.slice(1));
let host = '';
try { host = new URL(target).hostname.replace(/^www\./, ''); } catch { }

const $ = id => document.getElementById(id);
$('host').textContent = host || 'Этот сайт';
if (mode === 'whitelist') $('why').textContent = 'не в белом списке';
const matches = (h, d) => h === d || h.endsWith('.' + d);

// daily limit page: shown in or out of a session, stays until midnight or until the limit is raised
if (mode === 'limit') {
  document.querySelector('h1').textContent = 'Лимит на сегодня исчерпан';
  document.querySelector('.ring').style.display = 'none';
  chrome.storage.local.get(['limitHit', 'limitInfo'], ({ limitHit = [], limitInfo = {} }) => {
    const d = limitHit.find(x => matches(host, x));
    if (!d) return location.replace(target);
    $('why').textContent = `— ${limitInfo[d] || ''} мин в день уже потрачены. Завтра лимит обнулится.`;
  });
  chrome.storage.onChanged.addListener(ch => {
    if (ch.limitHit && !(ch.limitHit.newValue || []).some(x => matches(host, x))) location.replace(target);
  });
}

const TIPS = [
  'Желание отвлечься — это волна. Подожди 60 секунд, она пройдёт.',
  'Запиши мысль, которая потянула сюда, и вернись к задаче.',
  'Один глубокий час стоит трёх рассеянных.',
  'Перерыв скоро. Сайт никуда не денется.',
  'Сделай самый маленький следующий шаг в задаче.',
];
$('tip').textContent = TIPS[Math.floor(Math.random() * TIPS.length)];

if (mode !== 'limit') chrome.runtime.sendMessage({ type: 'attempt', domain: host });

const effective = s => !!(s && s.active && s.enforce && Date.now() < s.expires);
let dw = null;
function tick() {
  if (!dw || !dw.phaseEnd) { $('left').textContent = '∞'; return; }
  const left = Math.max(0, dw.phaseEnd - Date.now());
  const t = Math.round(left / 1000);
  $('left').textContent = `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
  const total = dw.phaseEnd - (dw.phaseStart || dw.phaseEnd - 25 * 60000);
  $('arc').style.strokeDashoffset = String(414.7 * (1 - Math.min(1, left / Math.max(1, total))));
}
function load(s) {
  dw = s;
  if (mode === 'limit') return;
  // focus is over (or relaxed for a break): let the page through
  if (!effective(dw) && /^https?:/.test(target)) return location.replace(target);
  $('goalBox').hidden = !(dw && dw.goal);
  if (dw && dw.goal) $('goal').textContent = dw.goal;
  tick();
}
chrome.storage.local.get('dw', r => load(r.dw));
chrome.storage.onChanged.addListener(ch => { if (ch.dw) load(ch.dw.newValue); });
setInterval(() => { if (mode === 'limit') return; tick(); if (dw && !effective(dw)) load(dw); }, 1000);

$('back').onclick = () => {
  if (history.length > 1) history.back();
  else chrome.tabs.getCurrent(t => t && chrome.tabs.remove(t.id));
};

if (mode === 'warn' && host) {
  const btn = $('anyway');
  btn.hidden = false;
  let n = 15;
  const paint = () => { btn.textContent = n > 0 ? `Открыть всё равно (${n})` : 'Открыть на 5 минут'; btn.disabled = n > 0; };
  paint();
  const iv = setInterval(() => { n--; paint(); if (n <= 0) clearInterval(iv); }, 1000);
  btn.onclick = () => chrome.runtime.sendMessage({ type: 'allow', domain: host, minutes: 5 }, ok => { if (ok) location.replace(target); });
}
