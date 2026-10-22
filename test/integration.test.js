// Integration tests: Telegram bot logic (fake API), phone server (real HTTP), watchdog (real processes).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

test('telegram: pairing by code, strangers ignored, commands routed', async () => {
  const { TelegramBot } = require('../core/telegram');
  const sent = [];
  const cfg = { enabled: true, token: 't', chatId: null, pairCode: '123456' };
  const bot = new TelegramBot({
    fetch: async (url, o) => { const body = JSON.parse(o.body); if (url.endsWith('/sendMessage')) sent.push(body); return { json: async () => ({ ok: true, result: [] }) }; },
    log() { }, config: () => cfg, savePair: id => { cfg.chatId = id; },
    handlers: { status: () => 'STATUS', today: () => 'TODAY', plan: () => 'PLAN', focus: m => 'FOCUS ' + m, park: t => 'PARK ' + t, add: t => 'ADD ' + t },
  });
  bot.running = true;
  const msg = (chat, text) => bot.handle({ chat: { id: chat }, text });
  await msg(7, 'hello');
  assert.match(sent.pop().text, /отправь код/);
  await msg(7, '/start 123456');
  assert.equal(cfg.chatId, 7);
  await msg(8, '/status'); // stranger
  assert.equal(sent.filter(m => m.chat_id === 8).length, 0);
  await msg(7, '/focus 50'); assert.equal(sent.pop().text, 'FOCUS 50');
  await msg(7, '/park купить хлеб'); assert.equal(sent.pop().text, 'PARK купить хлеб');
  await msg(7, 'просто мысль'); assert.equal(sent.pop().text, 'PARK просто мысль');
  await msg(7, '/nope'); assert.match(sent.pop().text, /Не знаю/);
});

test('phone server: PIN, actions, static files, no traversal', async () => {
  const { PhoneServer } = require('../core/phone');
  const acts = [];
  const srv = new PhoneServer({
    port: 0, pin: '4321', root: path.join(__dirname, '..', 'renderer'), log() { },
    getState: () => ({ ok: 1 }), act: (name, body) => { acts.push([name, body]); if (name === 'bad') throw new Error('нельзя'); return true; },
  });
  srv.start();
  await new Promise(r => srv.server.once('listening', r));
  const base = `http://127.0.0.1:${srv.server.address().port}`;
  try {
    assert.equal((await fetch(base + '/api/state')).status, 401);
    assert.equal((await fetch(base + '/api/login', { method: 'POST', body: JSON.stringify({ pin: '0000' }) })).status, 401);
    const ok = await fetch(base + '/api/login', { method: 'POST', body: JSON.stringify({ pin: '4321' }) });
    assert.equal(ok.status, 200);
    assert.match(ok.headers.get('set-cookie'), /dwpin=4321/);
    const st = await fetch(base + '/api/state', { headers: { cookie: 'dwpin=4321' } });
    assert.deepEqual(await st.json(), { ok: 1 });
    const park = await fetch(base + '/api/park', { method: 'POST', headers: { 'x-pin': '4321' }, body: JSON.stringify({ text: 'идея' }) });
    assert.equal(park.status, 200);
    assert.deepEqual(acts.pop(), ['park', { text: 'идея' }]);
    const bad = await fetch(base + '/api/bad', { method: 'POST', headers: { 'x-pin': '4321' }, body: '{}' });
    assert.equal(bad.status, 400);
    assert.match((await (await fetch(base + '/')).text()), /Deepwork/);
    assert.equal((await fetch(base + '/js/core.js')).status, 404); // only phone/ and fonts/ are served
    assert.equal((await fetch(base + '/phone/..%2f..%2fmain.js')).status, 404);
  } finally { srv.stop(); }
});

function watchdogRun(guard) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dw-wd-'));
  const stateFile = path.join(dir, 'state.json');
  const marker = path.join(dir, 'revived.txt');
  const relaunch = path.join(dir, 'relaunch.js');
  fs.writeFileSync(stateFile, JSON.stringify({ session: { id: 'x' }, guard }));
  fs.writeFileSync(relaunch, `require('fs').writeFileSync(${JSON.stringify(marker)}, process.argv.slice(2).join(' '))`);
  // the "app": a process that dies after a second, like Deepwork killed from Task Manager
  const parent = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 1000)'], { stdio: 'ignore' });
  const wd = spawn(process.execPath, [path.join(__dirname, '..', 'core', 'watchdog.js'), String(parent.pid), stateFile, process.execPath, JSON.stringify([relaunch])], { stdio: 'ignore' });
  return new Promise(resolve => wd.on('exit', () => setTimeout(() => resolve(fs.existsSync(marker) ? fs.readFileSync(marker, 'utf8') : null), 800)));
}

test('watchdog: relaunches a killed app during a guarded session', async () => {
  assert.equal(await watchdogRun(true), '--hidden --revived');
});

test('watchdog: stays quiet when the session is not guarded', async () => {
  assert.equal(await watchdogRun(false), null);
});
