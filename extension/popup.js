const $ = id => document.getElementById(id);
const effective = s => !!(s && s.active && Date.now() < s.expires);
const PH = { focus: 'Фокус', short: 'Перерыв', long: 'Длинный перерыв' };

chrome.runtime.sendMessage({ type: 'connect' });

function render({ dw, conn }) {
  $('dot').className = 'dot' + (conn ? ' ok' : '');
  $('conn').textContent = conn ? 'Связь с приложением есть' : 'Приложение Deepwork не запущено';
  const b = $('body');
  b.innerHTML = '';
  if (!effective(dw)) {
    b.innerHTML = '<div class="muted">Сейчас не в фокусе. Начни сессию в приложении.</div>';
    return;
  }
  const el = (cls, text) => { const d = document.createElement('div'); d.className = cls; d.textContent = text; b.append(d); return d; };
  el('ph', PH[dw.phase] + ' · ' + (dw.levelName || ''));
  const big = el('big', '');
  if (dw.goal) el('goal', dw.goal);
  const tick = () => {
    if (!dw.phaseEnd) { big.textContent = 'flow'; return; }
    const t = Math.max(0, Math.round((dw.phaseEnd - Date.now()) / 1000));
    big.textContent = `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
  };
  tick();
  clearInterval(render.iv);
  render.iv = setInterval(tick, 1000);
}

chrome.storage.local.get(['dw', 'conn'], render);
chrome.storage.onChanged.addListener(() => chrome.storage.local.get(['dw', 'conn'], render));
