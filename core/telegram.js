// Telegram bot over long polling (no server needed). Paired to one chat with a code shown in the app;
// every other chat is ignored. The bot can't end a session — exiting focus stays in the app.
const COMMANDS = [
  ['status', 'Что сейчас: фокус, перерыв, сколько осталось'],
  ['today', 'Итог дня: фокус, норма, задачи'],
  ['plan', 'Задачи и рутина на сегодня'],
  ['focus', 'Начать фокус: /focus 50'],
  ['park', 'Запарковать мысль: /park позвонить маме'],
  ['add', 'Задача на сегодня: /add дописать отчёт'],
  ['help', 'Список команд'],
];

class TelegramBot {
  // handlers: { status(), today(), plan(), focus(min), park(text), add(text) } → reply text
  constructor({ fetch, log, config, savePair, handlers }) {
    Object.assign(this, { fetch, log, config, savePair, handlers });
    this.offset = 0;
    this.running = false;
    this.ctrl = null;
  }

  api(method, body, signal) {
    const { token } = this.config();
    return this.fetch(`https://api.telegram.org/bot${token}/${method}`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body || {}), signal,
    }).then(r => r.json());
  }

  async start() {
    const c = this.config();
    if (this.running || !c.enabled || !c.token) return;
    this.running = true;
    try {
      const me = await this.api('getMe');
      if (!me.ok) throw new Error(me.description || 'bad token');
      this.username = me.result.username;
      await this.api('setMyCommands', { commands: COMMANDS.map(([command, description]) => ({ command, description })) });
      this.status = { ok: true, username: this.username };
    } catch (e) {
      this.status = { ok: false, error: String(e.message || e) };
      this.running = false;
      return;
    }
    this.loop();
  }

  stop() {
    this.running = false;
    if (this.ctrl) this.ctrl.abort();
  }

  async restart() { this.stop(); await new Promise(r => setTimeout(r, 300)); return this.start(); }

  async loop() {
    while (this.running) {
      try {
        this.ctrl = new AbortController();
        const r = await this.api('getUpdates', { offset: this.offset, timeout: 25, allowed_updates: ['message'] }, this.ctrl.signal);
        if (!r.ok) throw new Error(r.description);
        for (const u of r.result) {
          this.offset = u.update_id + 1;
          if (u.message && u.message.text) await this.handle(u.message).catch(e => this.log('tg handle', e.message));
        }
      } catch (e) {
        if (!this.running) break;
        this.log('tg poll', e.message);
        await new Promise(r => setTimeout(r, 5000));
      }
    }
  }

  send(text, chatId = this.config().chatId) {
    if (!chatId || !this.running) return Promise.resolve();
    return this.api('sendMessage', { chat_id: chatId, text }).catch(e => this.log('tg send', e.message));
  }

  async handle(msg) {
    const c = this.config();
    const chat = msg.chat.id;
    const text = msg.text.trim();
    if (!c.chatId) {
      const code = text.replace(/^\/start\s*/, '').trim();
      if (code && code === c.pairCode) {
        this.savePair(chat);
        return this.send('Готово, Deepwork подключён. Команды — /help', chat);
      }
      return this.send('Чтобы подключить бота, отправь код из Deepwork → Настройки → Telegram.', chat);
    }
    if (chat !== c.chatId) return; // strangers get silence
    const [, cmd, rest = ''] = text.match(/^\/(\w+)(?:@\w+)?\s*([\s\S]*)$/) || [null, '', text];
    const h = this.handlers;
    let reply;
    switch (cmd) {
      case 'status': reply = h.status(); break;
      case 'today': reply = h.today(); break;
      case 'plan': reply = h.plan(); break;
      case 'focus': reply = h.focus(parseInt(rest, 10) || null); break;
      case 'park': reply = rest ? h.park(rest) : 'Напиши мысль после команды: /park купить билеты'; break;
      case 'add': reply = rest ? h.add(rest) : 'Напиши задачу после команды: /add дописать отчёт'; break;
      case 'start': case 'help': reply = COMMANDS.map(([c2, d]) => `/${c2} — ${d}`).join('\n'); break;
      default: reply = cmd ? 'Не знаю такой команды. /help' : h.park(text); // plain text = parking
    }
    return this.send(await reply);
  }
}

module.exports = { TelegramBot };
