// Shared renderer helpers on window.DW: DOM builder, dates, formatting, modal, toasts.
(function () {
  const DW = window.DW = { views: {}, state: null, view: 'focus' };

  // h('div.cls#id', {attrs/on*}, ...children)
  DW.h = function h(sel, attrs, ...kids) {
    if (attrs == null || typeof attrs !== 'object' || attrs instanceof Node || Array.isArray(attrs)) { kids.unshift(attrs); attrs = {}; }
    const m = sel.match(/^([a-z0-9]+)?((?:[.#][\w-]+)*)$/i);
    const el = document.createElement((m && m[1]) || 'div');
    if (m && m[2]) for (const p of m[2].match(/[.#][\w-]+/g)) p[0] === '.' ? el.classList.add(p.slice(1)) : (el.id = p.slice(1));
    for (const [k, v] of Object.entries(attrs)) {
      if (v == null || v === false) continue;
      if (k.startsWith('on')) el.addEventListener(k.slice(2).toLowerCase(), v);
      else if (k === 'style' && typeof v === 'object') for (const [sk, sv] of Object.entries(v)) sk.startsWith('--') ? el.style.setProperty(sk, sv) : (el.style[sk] = sv);
      else if (k === 'class') String(v).split(/\s+/).filter(Boolean).forEach(c => el.classList.add(c));
      else if (k === 'html') el.innerHTML = v;
      else if (k in el && k !== 'list' && typeof v !== 'string') el[k] = v;
      else el.setAttribute(k, v === true ? '' : v);
    }
    const add = k => {
      if (k == null || k === false) return;
      if (Array.isArray(k)) return k.forEach(add);
      el.appendChild(k instanceof Node ? k : document.createTextNode(String(k)));
    };
    kids.forEach(add);
    return el;
  };
  const h = DW.h;

  DW.svg = (paths, cls = '') => {
    const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    s.setAttribute('viewBox', '0 0 24 24');
    if (cls) s.setAttribute('class', cls);
    s.innerHTML = paths;
    return s;
  };
  DW.icons = {
    focus: '<circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="4"/>',
    plan: '<rect x="3.5" y="5" width="17" height="15.5" rx="3"/><path d="M3.5 10h17M8.5 3v4M15.5 3v4"/>',
    blocks: '<path d="M12 3l7.5 3v5.5c0 4.4-3.1 8.1-7.5 9.5-4.4-1.4-7.5-5.1-7.5-9.5V6z"/><path d="M9 12l2.2 2.2L15.5 10"/>',
    stats: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
    settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-1.8-.3 1.6 1.6 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.6 1.6 0 0 0-1-1.5 1.6 1.6 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.6 1.6 0 0 0 .3-1.8 1.6 1.6 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.6 1.6 0 0 0 1.5-1 1.6 1.6 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.6 1.6 0 0 0 1.8.3H9a1.6 1.6 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.6 1.6 0 0 0 1 1.5 1.6 1.6 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0-.3 1.8V9a1.6 1.6 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.6 1.6 0 0 0-1.5 1z"/>',
    play: '<path d="M7 4.5v15l12-7.5z"/>',
    edit: '<path d="M4 20h4L19 9l-4-4L4 16z"/>',
    x: '<path d="M6 6l12 12M18 6L6 18"/>',
    next: '<path d="M5 12h13M13 6l6 6-6 6"/>',
    left: '<path d="M15 5l-7 7 7 7"/>',
    right: '<path d="M9 5l7 7-7 7"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    inbox: '<path d="M3 13l3-8h12l3 8v6H3z"/><path d="M3 13h5l1 3h6l1-3h5"/>',
  };
  DW.iconBtn = (name, title, on) => h('button.icon-btn', { title, onclick: e => { e.stopPropagation(); on(e); } }, DW.svg(DW.icons[name]));

  // ---- dates (local) ----
  DW.ymd = d => { d = new Date(d); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
  DW.today = () => DW.ymd(new Date());
  DW.addDays = (ymd, n) => { const [y, m, d] = ymd.split('-').map(Number); return DW.ymd(new Date(y, m - 1, d + n)); };
  DW.parse = ymd => { const [y, m, d] = ymd.split('-').map(Number); return new Date(y, m - 1, d); };
  DW.MONTHS = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'];
  DW.MONTHS_GEN = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
  DW.DOW = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];
  DW.DOW_FULL = ['Воскресенье', 'Понедельник', 'Вторник', 'Среда', 'Четверг', 'Пятница', 'Суббота'];
  DW.longDate = ymd => { const d = DW.parse(ymd); return `${DW.DOW_FULL[d.getDay()]}, ${d.getDate()} ${DW.MONTHS_GEN[d.getMonth()]}`; };

  DW.clock = ms => { const t = Math.max(0, Math.round(ms / 1000)); const hh = Math.floor(t / 3600), mm = Math.floor(t % 3600 / 60), ss = t % 60; return (hh ? hh + ':' + String(mm).padStart(2, '0') : mm) + ':' + String(ss).padStart(2, '0'); };
  DW.dur = min => { min = Math.round(min); if (min < 60) return min + ' мин'; if (min >= 600) return Math.round(min / 60) + ' ч'; const hh = Math.floor(min / 60), mm = min % 60; return hh + ' ч' + (mm ? ' ' + mm + ' мин' : ''); };
  DW.durShort = min => { min = Math.round(min); if (min < 60) return min + 'м'; const hh = Math.floor(min / 60), mm = min % 60; return hh + 'ч' + (mm ? mm : ''); };
  DW.hhmm = ts => { const d = new Date(ts); return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0'); };
  DW.plural = (n, a, b, c) => { const m10 = n % 10, m100 = n % 100; return m10 === 1 && m100 !== 11 ? a : m10 >= 2 && m10 <= 4 && (m100 < 10 || m100 >= 20) ? b : c; };

  // focus minutes per local day, from finished sessions (+ the running one)
  DW.focusByDay = () => {
    const map = {};
    for (const s of DW.state.sessions) { const k = DW.ymd(s.start); map[k] = (map[k] || 0) + s.focusMs / 60000; }
    return map;
  };
  DW.streak = () => {
    const by = DW.focusByDay(), goal = DW.state.settings.dailyGoalMin;
    let n = 0, d = DW.today();
    if ((by[d] || 0) < goal) d = DW.addDays(d, -1); // today still in progress
    while ((by[d] || 0) >= goal) { n++; d = DW.addDays(d, -1); }
    return n;
  };

  DW.GOAL_COLORS = ['#6d7cff', '#3ecf8e', '#f5b04a', '#ff5d8a', '#38c9c0', '#b07cff', '#ff8a4c', '#8b91a3'];
  DW.goalById = id => DW.state.goals.find(g => g.id === id);

  // ---- modal ----
  DW.modal = function (build) {
    const root = document.getElementById('modal-root');
    const close = () => { root.innerHTML = ''; document.removeEventListener('keydown', esc); if (close.onclose) close.onclose(); };
    const esc = e => { if (e.key === 'Escape' && !close.sticky) close(); };
    const box = h('div.modal');
    const bg = h('div.modal-bg', { onmousedown: e => { if (e.target === bg && !close.sticky) close(); } }, box);
    root.innerHTML = '';
    root.appendChild(bg);
    build(box, close);
    document.addEventListener('keydown', esc);
    const first = box.querySelector('input, textarea');
    if (first) setTimeout(() => first.focus(), 30);
    return close;
  };

  DW.confirm = (title, text, okLabel = 'Да', danger) => new Promise(res => {
    DW.modal((m, close) => {
      close.onclose = () => res(false);
      m.append(h('h2', title), text ? h('p', text) : null,
        h('div.acts', h('button.btn', { onclick: () => close() }, 'Отмена'),
          h('button.btn' + (danger ? '.danger' : '.primary'), { onclick: () => { close.onclose = null; close(); res(true); } }, okLabel)));
    });
  });

  DW.toast = (text, bad) => {
    const t = h('div.toast' + (bad ? '.bad' : ''), text);
    document.getElementById('toasts').appendChild(t);
    setTimeout(() => t.remove(), 3200);
  };

  DW.call = async (ch, ...a) => {
    const r = await window.dw.call(ch, ...a);
    if (r && r.ok === false && r.error) DW.toast(r.error, true);
    return r;
  };

  DW.switchEl = (checked, onchange, disabled) =>
    h('label.switch', h('input', { type: 'checkbox', checked, disabled, onchange: e => onchange(e.target.checked) }), h('span'));

  DW.locked = () => {
    const s = DW.state.session;
    if (!s) return false;
    const lvl = DW.state.levels[s.level - 1];
    return !!(lvl && lvl.lockSettings);
  };
})();
