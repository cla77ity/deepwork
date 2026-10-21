// Blocks view: site and app categories, whitelists.
(function () {
  const { h } = DW;

  const splitList = v => [...new Set(v.split(/[\s,;]+/).map(x => x.trim().toLowerCase()
    .replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/.*$/, '').replace(/\.exe$/, '')).filter(Boolean))];

  function saveLists(lists) { return DW.call('settings:set', { lists }); }

  const unit = (key, n) => key === 'domains' ? DW.count(n, 'сайт', 'сайта', 'сайтов') : DW.count(n, 'программа', 'программы', 'программ');

  function catCard(cat, key, lists, locked) {
    const items = cat[key];
    let editing = false;
    const card = h('div.cat' + (cat.on ? '' : '.off'));
    function paint() {
      card.innerHTML = '';
      card.append(h('div.ch', DW.switchEl(cat.on, v => { cat.on = v; card.classList.toggle('off', !v); saveLists(lists); }, locked), h('b', cat.name), h('div.spacer'),
        h('span.dim', { style: { fontSize: '12px' } }, unit(key, items.length)),
        locked ? null : h('button.btn.ghost.sm', { onclick: () => { editing = !editing; paint(); } }, editing ? 'Готово' : 'Изменить')));
      if (editing) {
        const ta = h('textarea.input', { placeholder: key === 'domains' ? 'по одному в строке: example.com' : 'по одному в строке, без .exe: steam' }, items.join('\n'));
        ta.addEventListener('change', () => { cat[key] = splitList(ta.value); saveLists(lists); });
        card.append(ta);
        setTimeout(() => ta.focus(), 0);
      } else card.append(h('div.list', items.length ? items.join(', ') : h('span.dim', 'Пусто — нажми «Изменить», чтобы добавить')));
    }
    paint();
    return card;
  }

  function listCard(title, desc, arr, setArr, lists, locked, placeholder) {
    const ta = h('textarea.input', { disabled: locked, placeholder, style: { minHeight: '120px' } }, arr.join('\n'));
    ta.addEventListener('change', () => { setArr(splitList(ta.value)); saveLists(lists); });
    return h('div.cat.allow', h('div.ch', h('b', title)), h('div.list', desc), ta);
  }

  function render(root) {
    const st = DW.state.settings;
    const lists = JSON.parse(JSON.stringify(st.lists));
    const locked = DW.locked();

    root.append(h('div.view-head', h('h1', 'Блокировки'), h('span.sub', 'что закрывать во время фокуса')));
    if (locked) root.append(h('div.banner', 'Идёт сессия — списки можно будет изменить после неё.'));

    root.append(h('div.section',
      h('h2', 'Сайты'),
      h('p', 'В Brave их закрывает расширение, на уровнях с hosts — ещё и все остальные браузеры. Поддомены блокируются вместе с доменом.'),
      h('div.cats.stagger', lists.siteCats.map(c => catCard(c, 'domains', lists, locked)),
        listCard('Белый список', 'Когда у уровня включено «только белый список» (по умолчанию «Монах»), открываются только эти сайты.', lists.siteAllow, v => { lists.siteAllow = v; }, lists, locked, 'github.com'))));

    const addRunning = async () => {
      const running = await window.dw.call('apps:running');
      DW.modal((m, close) => {
        const custom = lists.appCats.find(c => c.id === 'custom');
        m.append(h('h2', 'Запущенные программы'), h('p', 'Нажми на программу — она добавится в «Мои программы».'),
          h('div.col', { style: { gap: '4px', maxHeight: '360px', overflow: 'auto' } }, running.map(r => h('button.btn', {
            style: { justifyContent: 'space-between' },
            disabled: custom.names.includes(r.name),
            onclick: e => { custom.names.push(r.name); saveLists(lists); e.currentTarget.disabled = true; },
          }, h('b', r.name), h('span.dim', { style: { fontSize: '12px', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '240px' } }, r.title)))),
          h('div.acts', h('button.btn.primary', { onclick: () => close() }, 'Готово')));
      });
    };

    root.append(h('div.section',
      h('div.row', h('div.h2', 'Программы'), h('div.spacer'), locked ? null : h('button.btn.sm', { onclick: addRunning }, DW.svg(DW.icons.plus), 'Добавить запущенную')),
      h('p', { style: { marginTop: '4px' } }, 'Закрываются сразу при запуске. Системные процессы и консоли со скриптами (python, node, java) не трогаются никогда.'),
      h('div.cats.stagger', lists.appCats.map(c => catCard(c, 'names', lists, locked)),
        listCard('Белый список', 'В режиме «только белый список» закрывается всё с окном, кроме этих программ. Имя процесса без .exe.', lists.appAllow, v => { lists.appAllow = v; }, lists, locked, 'code'))));
  }

  DW.views.blocks = { render, title: 'Блокировки' };
})();
