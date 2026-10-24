// Default levels, block lists and settings. User overrides live in settings.levels / settings.lists.

const LEVELS = {
  1: {
    name: 'Лёгкий',
    dnd: true, sites: 'warn', hosts: false, apps: 'off', onlyBrave: false,
    youtube: true, clickbait: 'blur', feeds: false, pushBlock: true,
    pause: true, breakUnlock: true, lockSettings: false, guard: false,
    exit: { type: 'confirm', wait: 0 },
  },
  2: {
    name: 'Рабочий',
    dnd: true, sites: 'block', hosts: false, apps: 'block', onlyBrave: false,
    youtube: true, clickbait: 'hide', feeds: true, pushBlock: true,
    pause: false, breakUnlock: true, lockSettings: true, guard: false,
    exit: { type: 'phrase', wait: 0 },
  },
  3: {
    name: 'Жёсткий',
    dnd: true, sites: 'block', hosts: true, apps: 'block', onlyBrave: true,
    youtube: true, clickbait: 'hide', feeds: true, pushBlock: true,
    pause: false, breakUnlock: false, lockSettings: true, guard: true,
    exit: { type: 'phrase', wait: 60 },
  },
  4: {
    name: 'Монах',
    dnd: true, sites: 'whitelist', hosts: true, apps: 'whitelist', onlyBrave: true,
    youtube: true, clickbait: 'hide', feeds: true, pushBlock: true,
    pause: false, breakUnlock: false, lockSettings: true, guard: true,
    exit: { type: 'emergency', wait: 300 },
  },
};

const MAC = process.platform === 'darwin';

// What each level flag means — drives the level editor in Settings.
const LEVEL_FIELDS = [
  { key: 'dnd', label: 'Режим «Не беспокоить»', kind: 'bool' },
  { key: 'sites', label: 'Сайты', kind: 'select', options: [['off', 'не трогать'], ['warn', 'предупреждать'], ['block', 'блокировать'], ['whitelist', 'только белый список']] },
  { key: 'hosts', label: MAC ? 'Блок через hosts (все браузеры, пароль)' : 'Блок через hosts (все браузеры, UAC)', kind: 'bool' },
  { key: 'apps', label: 'Программы', kind: 'select', options: [['off', 'не трогать'], ['block', 'закрывать из списка'], ['whitelist', 'только белый список']] },
  { key: 'onlyBrave', label: 'Закрывать другие браузеры', kind: 'bool' },
  { key: 'youtube', label: 'Чистка YouTube', kind: 'bool' },
  { key: 'clickbait', label: 'Кликбейт', kind: 'select', options: [['off', 'не трогать'], ['blur', 'размывать'], ['hide', 'скрывать']] },
  { key: 'feeds', label: 'Скрывать ленты соцсетей', kind: 'bool' },
  { key: 'pushBlock', label: 'Запрет push-уведомлений сайтов', kind: 'bool' },
  { key: 'pause', label: 'Можно ставить паузу', kind: 'bool' },
  { key: 'breakUnlock', label: 'В перерыв снимать блоки', kind: 'bool' },
  { key: 'lockSettings', label: 'Запрет менять настройки в сессии', kind: 'bool' },
  { key: 'guard', label: 'Перезапуск, если Deepwork закрыли; Brave без расширения закрывается', kind: 'bool' },
  { key: 'exit', label: 'Досрочный выход', kind: 'exit' },
];

const EXIT_TYPES = [
  ['confirm', 'подтверждение'],
  ['phrase', 'ввести фразу'],
  ['emergency', 'аварийный выход'],
];

const SITE_CATS = [
  { id: 'social', name: 'Соцсети', on: true, domains: ['vk.com', 'instagram.com', 'facebook.com', 'x.com', 'twitter.com', 'tiktok.com', 'ok.ru', 'threads.net', 'pinterest.com', 'snapchat.com'] },
  { id: 'video', name: 'Видео и стримы', on: true, domains: ['twitch.tv', 'kick.com', 'netflix.com', 'kinopoisk.ru', 'hd.kinopoisk.ru', 'rutube.ru', 'ivi.ru', 'okko.tv', 'vkvideo.ru'] },
  { id: 'youtube', name: 'YouTube целиком', on: false, domains: ['youtube.com', 'm.youtube.com', 'youtu.be'] },
  { id: 'news', name: 'Новости и развлечения', on: true, domains: ['lenta.ru', 'ria.ru', 'rbc.ru', 'meduza.io', 'pikabu.ru', 'dtf.ru', 'reddit.com', '9gag.com', 'joyreactor.cc', 'news.google.com'] },
  { id: 'shopping', name: 'Магазины и барахолки', on: false, domains: ['avito.ru', 'ozon.ru', 'wildberries.ru', 'aliexpress.com', 'amazon.com', 'ebay.com', 'vinted.com', 'vinted.pl', 'olx.pl', 'allegro.pl'] },
  { id: 'games', name: 'Игры', on: true, domains: ['store.steampowered.com', 'steamcommunity.com', 'epicgames.com', 'chess.com', 'lichess.org', 'poki.com'] },
  { id: 'markets', name: 'Крипта и рынки', on: false, domains: ['binance.com', 'bybit.com', 'tradingview.com', 'coinmarketcap.com', 'coingecko.com', 'dexscreener.com'] },
  { id: 'custom', name: 'Мои сайты', on: true, domains: [] },
];

const SITE_ALLOW = ['github.com', 'stackoverflow.com', 'developer.mozilla.org', 'google.com', 'claude.ai', 'chatgpt.com', 'npmjs.com', 'figma.com', 'notion.so', 'localhost', '127.0.0.1'];

// App names are lowercase process names: Windows — the .exe name, macOS — the name shown in the Dock.
const APP_CATS = MAC ? [
  { id: 'games', name: 'Игры и лаунчеры', on: true, names: ['steam', 'steam_osx', 'epic games launcher', 'riot client', 'league of legends', 'battle.net'] },
  { id: 'messengers', name: 'Мессенджеры', on: true, names: ['telegram', 'discord', 'whatsapp', 'viber', 'slack', 'messages'] },
  { id: 'media', name: 'Музыка и видео', on: false, names: ['spotify', 'music', 'tv', 'vlc'] },
  { id: 'custom', name: 'Мои программы', on: true, names: [] },
] : [
  { id: 'games', name: 'Игры и лаунчеры', on: true, names: ['steam', 'steamwebhelper', 'epicgameslauncher', 'riotclientservices', 'leagueclient', 'battle.net', 'origin', 'eadesktop', 'ubisoftconnect'] },
  { id: 'messengers', name: 'Мессенджеры', on: true, names: ['telegram', 'discord', 'whatsapp', 'viber', 'slack'] },
  { id: 'media', name: 'Музыка и видео', on: false, names: ['spotify', 'vlc', 'yandexmusic'] },
  { id: 'custom', name: 'Мои программы', on: true, names: [] },
];

// Closed when level.onlyBrave is on (prevents dodging the Brave extension).
const OTHER_BROWSERS = MAC
  ? ['google chrome', 'safari', 'firefox', 'microsoft edge', 'opera', 'opera gx', 'arc', 'comet', 'vivaldi', 'yandex', 'chromium', 'orion', 'zen']
  : ['chrome', 'msedge', 'firefox', 'opera', 'opera_gx', 'browser', 'vivaldi', 'yandex', 'comet', 'arc', 'chromium', 'thorium', 'waterfox', 'librewolf'];

const APP_ALLOW = MAC
  ? ['code', 'cursor', 'brave browser', 'figma', 'terminal', 'iterm2', 'warp', 'notes', 'obsidian', 'claude', 'notion', 'xcode', 'preview']
  : ['code', 'cursor', 'idea64', 'pycharm64', 'brave', 'figma', 'notepad', 'notepad++', 'windowsterminal', 'powershell', 'pwsh', 'cmd', 'claude', 'obsidian', 'notion'];

// Never killed, whatever the lists say.
const APP_SAFE = [
  ...(MAC ? ['finder', 'dock', 'systemuiserver', 'loginwindow', 'windowserver', 'controlcenter', 'notificationcenter', 'spotlight',
    'system settings', 'system preferences', 'activity monitor', 'universalcontrol', 'screencaptureui', 'siri', 'wallpaper',
    'terminal', 'iterm2', 'zsh', 'python3']
    : ['explorer', 'dwm', 'applicationframehost', 'systemsettings', 'textinputhost',
      'shellexperiencehost', 'startmenuexperiencehost', 'searchhost', 'lockapp', 'taskmgr', 'dllhost', 'rundll32', 'mmc',
      'consent', 'credentialuihost', 'openwith', 'pickerhost', 'shellhost', 'sihost', 'ctfmon', 'conhost', 'csrss',
      'winlogon', 'svchost', 'runtimebroker', 'securityhealthsystray', 'msedgewebview2', 'nvidia share', 'radeonsoftware', 'openconsole']),
  'electron', 'deepwork',
  // dev runtimes: console windows of scripts/bots must survive whitelist mode
  'python', 'pythonw', 'py', 'node', 'java', 'javaw', 'git', 'bash', 'wsl', 'ssh'];

const EXIT_PHRASE = 'я сдаюсь и теряю фокус';

function defaultSettings() {
  return {
    level: 2,
    timer: { mode: 'pomodoro', focus: 25, short: 5, long: 15, rounds: 4, longEvery: 4, custom: 90 },
    dailyGoalMin: 120,
    sound: true,
    alwaysClean: false,
    launchAtLogin: false,
    youtube: { shorts: true, home: true, sidebar: true, endscreen: true, comments: true, autoplay: true, notif: true },
    // per-weekday norm in minutes (Mon..Sun); null = use dailyGoalMin
    goalByDow: [null, null, null, null, null, null, null],
    notify: { breakStart: true, breakSoon: true, breakEnd: true, sessionEnd: true },
    widget: { enabled: true, always: false, x: null, y: null },
    // tabs at session start: 'blocked' = close tabs on blocked sites, 'keep' = close everything
    // except the whitelist and the preset's sites, 'off' = leave them (they get blocked on reload)
    tabs: { mode: 'blocked', restore: true },
    // work presets: apps and sites opened when a session starts
    presets: [],
    lastPreset: null,
    // away from the computer this long during focus → that time doesn't count
    idle: { enabled: true, minutes: 5 },
    hotkeys: true,
    ambient: { kind: 'off', volume: 0.2, breaks: false, v: 2 },
    // full-screen break: 'off' | 'soft' (can skip) | 'strict' (closable only after a minute)
    breakScreen: 'off',
    templates: [],
    schedule: [],
    rituals: { morning: true, evening: true, eveningTime: '21:30', lastMorning: null, lastEvening: null },
    // daily time limits for sites, also outside sessions: [{ domain, minutes }]
    limits: [],
    telegram: { enabled: false, token: '', chatId: null, pairCode: '', notify: true, daily: true, lastDaily: null },
    phone: { enabled: false, port: 47380, pin: '' },
    calendar: { ics: '' },
    updates: { check: true },
    lang: 'ru',
    onboarded: false,
    levels: {},
    lists: {
      siteCats: SITE_CATS.map(c => ({ ...c, domains: [...c.domains] })),
      siteAllow: [...SITE_ALLOW],
      appCats: APP_CATS.map(c => ({ ...c, names: [...c.names] })),
      appAllow: [...APP_ALLOW],
    },
  };
}

function levelConfig(settings, n) {
  const base = LEVELS[n] || LEVELS[2];
  const o = (settings.levels && settings.levels[n]) || {};
  return { ...base, ...o, exit: { ...base.exit, ...(o.exit || {}) }, n: Number(n) };
}

module.exports = { MAC, LEVELS, LEVEL_FIELDS, EXIT_TYPES, OTHER_BROWSERS, APP_SAFE, EXIT_PHRASE, defaultSettings, levelConfig };
