// Blocks view: site and app categories, whitelists.
(function () {
  const { h } = DW;

  const splitList = v => [...new Set(v.split(/[\s,;]+/).map(x => x.trim().toLowerCase()
    .replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/.*$/, '').replace(/\.exe$/, '')).filter(Boolean))];

  function saveLists(lists) { return DW.call('settings:set', { lists }); }

  function catCard(cat, key, lists, locked) {
    const items = cat[key];
    let editing = false;
    const card = h('div.cat');
    function paint() {
      card.innerHTML = '';
      card.append(h('div.ch', DW.switchEl(cat.on, v => { cat.on = v; saveLists(lists); }, locked), h('b', cat.name), h('div.spacer'),
        h('span.dim', { style: { fontSize: '12px' } }, items.length + ''),
        locked ? null : h('button.btn.ghost.sm', { onclick: () => { editing = !editing; paint(); } }, editing ? 'Готово' : 'Изменить')));
      if (editing) {
        const ta = h('textarea.input', { placeholder: key === 'domains' ? 'по одному домену в строке: example.com' : 'имя процесса без .exe: steam' }, items.join('\n'));
        ta.addEventListener('change', () => { cat[key] = splitList(ta.value); saveLists(lists); });
        card.append(ta);
        setTimeout(() => ta.focus(), 0);
      } else card.append(h('div.list', items.length ? items.join(', ') : h('span.dim', 'пусто')));
    }
    paint();
    return card;
  }

  function listCard(title, desc, arr, setArr, lists, locked, placeholder) {
    const ta = h('textarea.input', { disabled: locked, placeholder, style: { minHeight: '120px' } }, arr.join('\n'));
    ta.addEventListener('change', () => { setArr(splitList(ta.value)); saveLists(lists); });
    return h('div.cat', h('div.ch', h('b', title)), h('div.list', desc), ta);
  }

  function render(root) {
    const st = DW.state.settings;
    const lists = JSON.parse(JSON.stringify(st.lists));
    const locked = DW.locked();

    root.append(h('div.view-head', h('h1', 'Блокировки'), h('span.sub', 'что закрывать во время фокуса')));
    if (locked) root.append(h('div.banner', 'Идёт сессия — списки заблокированы до её конца. Так задумано: в фокусе нельзя «ослабить» защиту.'));

    root.append(h('div.section',
      h('h2', 'Сайты'),
      h('p', 'Работает в Brave через расширение (уровни 1–4) и во всех браузерах через hosts (уровни 3–4). Поддомены блокируются вместе с доменом.'),
      h('div.cats', lists.siteCats.map(c => catCard(c, 'domains', lists, locked)),
        listCard('Белый список', 'Только эти сайты открываются на уровне «Монах».', lists.siteAllow, v => { lists.siteAllow = v; }, lists, locked, 'github.com'))));

    const addRunning = async () => {
      const running = await window.dw.call('apps:running');
      DW.modal((m, close) => {
        const custom = lists.appCats.find(c => c.id === 'custom');
        m.append(h('h2', 'Запущенные программы'), h('p', 'Нажми, чтобы добавить в «Мои программы».'),
          h('div.col', { style: { gap: '4px', maxHeight: '360px', overflow: 'auto' } }, running.map(r => h('button.btn', {
            style: { justifyContent: 'space-between' },
            disabled: custom.names.includes(r.name),
            onclick: e => { custom.names.push(r.name); saveLists(lists); e.currentTarget.disabled = true; },
          }, h('b', r.name), h('span.dim', { style: { fontSize: '12px', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '240px' } }, r.title)))),
          h('div.acts', h('button.btn.primary', { onclick: () => close() }, 'Готово')));
      });
    };

    root.append(h('div.section',
      h('div.row', h('h2', { style: { margin: 0 } }, 'Программы'), h('div.spacer'), locked ? null : h('button.btn.sm', { onclick: addRunning }, '+ Из запущенных')),
      h('p', { style: { marginTop: '4px' } }, 'Закрываются при запуске (уровни 2–4). На уровне «Монах» закрывается всё с окном, чего нет в белом списке. Системные процессы, консоли и скрипты (python, node, java) не трогаются никогда.'),
      h('div.cats', lists.appCats.map(c => catCard(c, 'names', lists, locked)),
        listCard('Белый список', 'Разрешены на уровне «Монах». Имя процесса без .exe.', lists.appAllow, v => { lists.appAllow = v; }, lists, locked, 'code'))));
  }

  DW.views.blocks = { render, title: 'Блокировки' };
})();
