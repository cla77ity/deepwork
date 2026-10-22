// Focus session state machine: pomodoro / custom / flow, breaks, pause, friction exit.
// The state is a plain object so it can be persisted and restored after a crash.
const { EventEmitter } = require('events');

const MIN = 60000;
const FLOW_MIN_DONE = 25 * MIN;

class Session extends EventEmitter {
  constructor() {
    super();
    this.s = null;
    this.timer = setInterval(() => this.tick(), 1000);
  }

  get state() { return this.s; }

  // opts: { mode, level, goal, taskId, focus, short, long, rounds, longEvery, custom, exitWait, canPause }
  start(opts) {
    const now = Date.now();
    const mode = opts.mode;
    const focusMin = mode === 'custom' ? opts.custom : opts.focus;
    this.s = {
      id: 's' + now.toString(36),
      status: 'running',
      mode, level: opts.level, goal: opts.goal || '', taskId: opts.taskId || null, presetId: opts.presetId || null,
      durations: { focus: focusMin, short: opts.short, long: opts.long },
      rounds: mode === 'pomodoro' ? opts.rounds : 1,
      longEvery: opts.longEvery || 4,
      round: 1,
      phase: 'focus',
      phaseStart: now,
      phaseEnd: mode === 'flow' ? null : now + focusMin * MIN,
      startedAt: now,
      focusMs: 0,
      pausedAt: null,
      exitWait: opts.exitWait || 0,
      canPause: !!opts.canPause,
      stopReqAt: null,
      attempts: { sites: {}, apps: {} },
      idleMs: 0, // time away from the computer during focus — not counted as focus
      usage: { apps: {}, sites: {} }, // seconds per foreground app / browser domain during focus
      parked: 0, // thoughts sent to the parking lot during the session
    };
    this.changed('start');
    return this.s;
  }

  restore(s) {
    this.s = s;
    if (!s) return;
    // states saved by older versions
    s.idleMs = s.idleMs || 0;
    s.usage = s.usage || { apps: {}, sites: {} };
    s.parked = s.parked || 0;
    // fast-forward phases that ended while the app was closed
    let guard = 0;
    while (this.s && this.s.status === 'running' && this.s.phaseEnd && Date.now() >= this.s.phaseEnd && guard++ < 100) this.advance(this.s.phaseEnd);
    if (this.s) this.changed('restore');
  }

  tick() {
    const s = this.s;
    if (!s || s.status !== 'running' || !s.phaseEnd) return;
    if (Date.now() >= s.phaseEnd) this.advance(s.phaseEnd);
  }

  advance(at = Date.now()) {
    const s = this.s;
    if (s.phase === 'focus') {
      s.focusMs += at - s.phaseStart;
      const last = s.mode === 'custom' || (s.mode === 'pomodoro' && s.round >= s.rounds);
      if (last) return this.finish('done', at, true);
      const long = s.round % s.longEvery === 0;
      this.setPhase(long ? 'long' : 'short', at, (long ? s.durations.long : s.durations.short) * MIN);
    } else {
      s.round += 1;
      this.setPhase('focus', at, s.mode === 'flow' ? null : s.durations.focus * MIN);
    }
    this.changed('phase');
  }

  setPhase(phase, at, len) {
    const s = this.s;
    s.phase = phase;
    s.phaseStart = at;
    s.phaseEnd = len == null ? null : at + len;
  }

  // flow mode: user ends a focus stretch, break = 1/5 of it (5..30 min)
  takeBreak() {
    const s = this.s;
    if (!s || s.mode !== 'flow' || s.phase !== 'focus' || s.status !== 'running') return false;
    const now = Date.now();
    const worked = now - s.phaseStart;
    s.focusMs += worked;
    const len = Math.min(30, Math.max(5, Math.round(worked / MIN / 5)));
    this.setPhase('short', now, len * MIN);
    this.changed('phase');
    return true;
  }

  skipBreak() {
    const s = this.s;
    if (!s || s.phase === 'focus') return false;
    this.advance(Date.now());
    return true;
  }

  extend(min) {
    const s = this.s;
    if (!s || !s.phaseEnd) return false;
    s.phaseEnd += min * MIN;
    this.changed('extend');
    return true;
  }

  pause() {
    const s = this.s;
    if (!s || !s.canPause || s.status !== 'running') return false;
    s.status = 'paused';
    s.pausedAt = Date.now();
    this.changed('pause');
    return true;
  }

  resume() {
    const s = this.s;
    if (!s || s.status !== 'paused') return false;
    const d = Date.now() - s.pausedAt;
    s.phaseStart += d;
    if (s.phaseEnd) s.phaseEnd += d;
    s.pausedAt = null;
    s.status = 'running';
    this.changed('resume');
    return true;
  }

  focusSoFar(at = Date.now()) {
    const s = this.s;
    if (!s) return 0;
    let ms = s.focusMs - s.idleMs;
    if (s.phase === 'focus') ms += (s.pausedAt || at) - s.phaseStart;
    return Math.max(0, ms);
  }

  // away-from-keyboard time inside a focus phase
  addIdle(ms) {
    const s = this.s;
    if (!s || ms <= 0) return;
    s.idleMs += ms;
    this.changed('idle');
  }

  // kind: 'apps' | 'sites'; adds seconds, only while focusing
  track(kind, key, sec) {
    const s = this.s;
    if (!s || s.phase !== 'focus' || s.status !== 'running' || !key || sec <= 0) return;
    const bag = s.usage[kind];
    bag[key] = (bag[key] || 0) + sec;
  }

  park() {
    if (!this.s) return;
    this.s.parked += 1;
    this.changed('park');
  }

  // Normal finish for flow sessions that reached the minimum; everything else goes through requestStop.
  canFinishFreely() {
    const s = this.s;
    return !!s && s.mode === 'flow' && this.focusSoFar() >= FLOW_MIN_DONE;
  }

  requestStop() {
    const s = this.s;
    if (!s) return null;
    if (!s.stopReqAt) { s.stopReqAt = Date.now(); this.changed('stopreq'); }
    return s.stopReqAt + s.exitWait * 1000;
  }

  cancelStop() {
    if (!this.s) return;
    this.s.stopReqAt = null;
    this.changed('stopcancel');
  }

  confirmStop() {
    const s = this.s;
    if (!s) return { ok: false };
    if (this.canFinishFreely()) { this.finish('done'); return { ok: true }; }
    if (!s.stopReqAt) return { ok: false, error: 'Сначала запроси выход' };
    const left = s.stopReqAt + s.exitWait * 1000 - Date.now();
    if (left > 500) return { ok: false, error: `Подожди ещё ${Math.ceil(left / 1000)} с` };
    this.finish('abandoned');
    return { ok: true };
  }

  attempt(kind, key) {
    const s = this.s;
    if (!s) return;
    const bag = s.attempts[kind];
    bag[key] = (bag[key] || 0) + 1;
    this.changed('attempt');
  }

  // counted: the current focus stretch is already added to focusMs (natural end of the last phase)
  finish(result, at = Date.now(), counted = false) {
    const s = this.s;
    const focusMs = s.phase === 'focus' && !counted ? this.focusSoFar(at) : Math.max(0, s.focusMs - s.idleMs);
    const record = {
      id: s.id, start: s.startedAt, end: at, focusMs, mode: s.mode, level: s.level,
      goal: s.goal, taskId: s.taskId, result, rounds: s.round, attempts: s.attempts,
      idleMs: s.idleMs, usage: s.usage, parked: s.parked, presetId: s.presetId,
    };
    this.s = null;
    this.emit('finish', record);
    this.changed('finish');
  }

  changed(why) { this.emit('change', this.s, why); }
}

module.exports = { Session, MIN };
