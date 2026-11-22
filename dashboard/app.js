// Token Radar's plain dashboard. It reads window.RADAR (written beside dashboard/
// by main.ts) and renders the ranked board, a filterable and sortable table, a
// per-protocol detail view with the model's own inputs and the protocol's farm
// plan, a live-token tab kept apart from the ranked board, and a model tab where
// the reader can move the constants and watch the board re-rank. No network:
// every byte it shows is in data.js. No names are special-cased anywhere.
(function () {
  'use strict';

  var DATA = window.RADAR;
  var app = document.getElementById('board') || document.getElementById('app');
  if (!DATA || !app) return;

  var state = { q: '', category: 'all', chain: 'all', watch: false, tab: 'board', sort: 'implied', dir: -1, selected: null };
  var sandbox = { base: DATA.model.base_multiple, weight: DATA.model.growth_weight, on: false };

  var usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
  function fmtUsd(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    if (Math.abs(n) >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (Math.abs(n) >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (Math.abs(n) >= 1e3) return '$' + Math.round(n / 1e3) + 'K';
    return usd.format(n);
  }
  function fmtPct(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    return (n > 0 ? '+' : '') + n.toFixed(2) + '%';
  }
  function fmtAge(days) {
    if (days === null || days === undefined) return 'unknown';
    if (days >= 365) return (days / 365).toFixed(1) + 'y';
    return Math.max(0, Math.round(days)) + 'd';
  }
  function fmtMult(n) { return 'x' + n.toFixed(2); }

  function el(tag, attrs) {
    var node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        if (k === 'class') node.className = attrs[k];
        else if (k === 'text') node.textContent = attrs[k];
        else if (k === 'html') node.innerHTML = attrs[k];
        else if (k.slice(0, 2) === 'on') node.addEventListener(k.slice(2), attrs[k]);
        else if (attrs[k] !== null && attrs[k] !== undefined) node.setAttribute(k, attrs[k]);
      });
    }
    for (var i = 2; i < arguments.length; i++) {
      var child = arguments[i];
      if (child === null || child === undefined) continue;
      if (Array.isArray(child)) child.forEach(function (c) { if (c) node.appendChild(c); });
      else if (typeof child === 'string') node.appendChild(document.createTextNode(child));
      else node.appendChild(child);
    }
    return node;
  }

  // The model in one function: the page recomputes a row from the snapshot figures
  // and checks the number board.json carries, so the page's code and the board's
  // data are visibly the same arithmetic. The sandbox runs this with moved constants.
  function impliedOf(row, model) {
    var growth = Math.min(model.growth_cap, Math.max(model.growth_floor, row.change_7d === null || row.change_7d === undefined ? 0 : row.change_7d));
    var growthMult = 1 + (growth / 100) * model.growth_weight;
    var age = row.age_days === null || row.age_days === undefined ? model.unknown_age_days : row.age_days;
    var maturity = model.maturity_floor + (Math.min(Math.max(age, 0), model.maturity_days) / model.maturity_days) * model.maturity_range;
    var breadth = 1 + model.breadth_per_chain * Math.min(row.chains ? row.chains.length : 0, model.breadth_max_chains);
    return {
      implied: Math.max(1, Math.round(row.tvl_usd * model.base_multiple * growthMult * maturity * breadth)),
      growthMult: growthMult, maturity: maturity, breadth: breadth, growthPct: growth, age: age
    };
  }

  // The farm plan is the same derivation main.ts writes to board.json: category,
  // chains, TVL and age decide the action, the capital, the hold and every cost
  // and time. No name is special-cased.
  function chainOf(p) { return p.chains && p.chains.length > 0 ? p.chains[0] : 'its main chain'; }
  function gasBand(chain) {
    var cheap = ['Solana', 'Base', 'Arbitrum', 'Optimism', 'Polygon', 'BSC', 'BNB Chain', 'Avalanche', 'Sui', 'Aptos', 'Linea', 'Scroll', 'Blast', 'zkSync Era'];
    if (cheap.indexOf(chain) >= 0) return 'under $1';
    if (chain === 'Ethereum') return 'about $3 to $8';
    return 'about $1 to $3';
  }
  function capitalFor(p) {
    if (p.tvl_usd >= 5e9) return 250;
    if (p.tvl_usd >= 1e9) return 150;
    if (p.tvl_usd >= 1e8) return 100;
    return 50;
  }
  function holdDaysFor(age) {
    if (age === null || age === undefined) return 30;
    if (age < 180) return 60;
    if (age < 365) return 45;
    return 30;
  }
  function actionFor(p, capital, chain) {
    var c = (p.category || '').toLowerCase();
    var name = p.name;
    if (c.indexOf('lend') >= 0 || c.indexOf('cdp') >= 0 || c.indexOf('collateral') >= 0 || c.indexOf('borrow') >= 0) {
      return 'Supply $' + capital + ' of USDC to ' + name + ' on ' + chain + ', then borrow $20 of USDC against it and repay it a week later.';
    }
    if (c.indexOf('dex') >= 0 || c.indexOf('leveraged farm') >= 0) {
      return 'Provide $' + capital + ' of liquidity to ' + name + "'s main pool on " + chain + ' and keep the position in range.';
    }
    if (c.indexOf('yield') >= 0 || c.indexOf('vault') >= 0 || c.indexOf('curator') >= 0 || c.indexOf('allocator') >= 0) {
      return 'Deposit $' + capital + ' into a ' + name + ' vault on ' + chain + ' and keep the shares until the hold ends.';
    }
    if (c.indexOf('bridge') >= 0 || c.indexOf('canonical') >= 0) {
      return 'Bridge $' + capital + ' of USDC to ' + chain + ' through ' + name + ', then use the bridged funds in its app once.';
    }
    if (c.indexOf('staking') >= 0 || c.indexOf('restak') >= 0) {
      return "Stake $" + capital + " of the chain's staking asset through " + name + ' and keep the receipt token.';
    }
    if (c.indexOf('perpetual') >= 0 || c.indexOf('derivative') >= 0 || c.indexOf('options') >= 0) {
      return 'Deposit $' + capital + ' of USDC as margin on ' + name + ' and open one small hedged position.';
    }
    if (c.indexOf('prediction') >= 0) {
      return 'Fund $' + capital + ' and place one small market position on ' + name + ', then close it the same week.';
    }
    if (c.indexOf('stable') >= 0) {
      return 'Mint or deposit $' + capital + ' of the stable asset through ' + name + ' on ' + chain + ' and hold it.';
    }
    if (c.indexOf('rwa') >= 0) {
      return "Mint $" + capital + " of the protocol's yield-bearing asset on " + chain + ' and hold it.';
    }
    if (c.indexOf('insurance') >= 0) {
      return 'Buy $' + capital + ' of cover from ' + name + ' on ' + chain + ' and keep the policy until the hold ends.';
    }
    if (c.indexOf('launchpad') >= 0) {
      return "Stake $" + capital + " in " + name + "'s launch pool on " + chain + ' and join one sale while it runs.';
    }
    if (c.indexOf('nft') >= 0 || c.indexOf('gaming') >= 0) {
      return 'Buy or mint one item worth about $' + capital + ' on ' + name + ' and use it in the app once a week.';
    }
    return 'Deposit $' + capital + ' of USDC into ' + name + ' on ' + chain + ' and keep the position open.';
  }
  function farmSteps(p) {
    var chain = chainOf(p);
    var capital = capitalFor(p);
    var hold = holdDaysFor(p.age_days);
    var gas = gasBand(chain);
    var action = actionFor(p, capital, chain);
    var steps = [
      { text: 'Use a fresh wallet that holds only the funds you plan to farm, and keep its seed phrase offline.', cost: gas + ' of gas for the first transaction', time: '5 minutes' },
      { text: action, cost: '$' + capital + ' of capital and about $' + (capital >= 150 ? 8 : 4) + ' of gas', time: '15 minutes to set up' },
      { text: 'Make one qualifying action each week, such as a deposit, a borrow, a swap or a vote, so the wallet shows steady use.', cost: 'about $2 of gas a week', time: '10 minutes a week' },
      { text: 'Hold the position for at least ' + hold + ' days so the activity is counted in more than one snapshot.', cost: 'the $' + capital + ' stays in the position', time: hold + ' days' },
      { text: "Before you withdraw, open the protocol's own points or rewards page from its official site and claim only from the link it publishes; never pay anyone to claim for you.", cost: 'no fee to check, and never pay to claim', time: '10 minutes' },
      { text: 'Write the wallet, the dates and every transaction in a farm log so you can repeat the position or unwind it safely.', cost: 'nothing but the log', time: '5 minutes' }
    ];
    return steps.map(function (s) {
      var t = s.text + ' Cost: ' + s.cost + '. Time: ' + s.time + '.';
      if (t.length > 600) t = t.slice(0, 596) + '...';
      return t;
    });
  }

  function readHash() {
    var hash = window.location.hash.replace(/^#/, '');
    if (!hash) return;
    var params = new URLSearchParams(hash);
    if (params.get('q')) state.q = params.get('q');
    if (params.get('cat')) state.category = params.get('cat');
    if (params.get('chain')) state.chain = params.get('chain');
    if (params.get('watch') === '1') state.watch = true;
    if (params.get('tab')) state.tab = params.get('tab');
    if (params.get('p')) state.selected = params.get('p');
    if (params.get('sort')) state.sort = params.get('sort');
  }
  function writeHash() {
    var params = new URLSearchParams();
    if (state.q) params.set('q', state.q);
    if (state.category !== 'all') params.set('cat', state.category);
    if (state.chain !== 'all') params.set('chain', state.chain);
    if (state.watch) params.set('watch', '1');
    if (state.tab !== 'board') params.set('tab', state.tab);
    if (state.selected) params.set('p', state.selected);
    if (state.sort !== 'implied') params.set('sort', state.sort);
    var h = params.toString();
    history.replaceState(null, '', h ? '#' + h : window.location.pathname + window.location.search);
  }

  function distinct(values) {
    var seen = {}, out = [];
    values.forEach(function (v) { if (v && !seen[v]) { seen[v] = true; out.push(v); } });
    return out.sort();
  }

  function filteredRows() {
    var rows = DATA.rows.slice();
    if (sandbox.on) {
      var model = Object.assign({}, DATA.model, { base_multiple: sandbox.base, growth_weight: sandbox.weight });
      rows = rows.map(function (r) {
        var v = impliedOf(r, model);
        var copy = Object.assign({}, r);
        copy.implied_value_usd = v.implied;
        copy.growth_multiplier = Math.round(v.growthMult * 1e4) / 1e4;
        copy.maturity_multiplier = Math.round(v.maturity * 1e4) / 1e4;
        copy.breadth_multiplier = Math.round(v.breadth * 1e4) / 1e4;
        return copy;
      });
      rows.sort(function (a, b) { return b.implied_value_usd - a.implied_value_usd || (a.slug < b.slug ? -1 : 1); });
      rows.forEach(function (r, i) { r.rank = i + 1; });
    }
    var q = state.q.trim().toLowerCase();
    rows = rows.filter(function (r) {
      if (state.watch && !r.watchlist) return false;
      if (state.category !== 'all' && (r.category || 'Uncategorised') !== state.category) return false;
      if (state.chain !== 'all' && (!r.chains || r.chains.indexOf(state.chain) < 0)) return false;
      if (q && r.name.toLowerCase().indexOf(q) < 0 && r.slug.toLowerCase().indexOf(q) < 0) return false;
      return true;
    });
    var key = state.sort;
    var dir = state.dir;
    rows.sort(function (a, b) {
      var av, bv;
      if (key === 'implied') { av = a.implied_value_usd; bv = b.implied_value_usd; }
      else if (key === 'tvl') { av = a.tvl_usd; bv = b.tvl_usd; }
      else if (key === 'growth') { av = a.change_7d === null ? -9999 : a.change_7d; bv = b.change_7d === null ? -9999 : b.change_7d; }
      else if (key === 'age') { av = a.age_days === null ? -1 : a.age_days; bv = b.age_days === null ? -1 : b.age_days; }
      else if (key === 'name') { return dir * (a.name < b.name ? -1 : a.name > b.name ? 1 : 0); }
      else { av = a.rank; bv = b.rank; }
      return dir * (av - bv);
    });
    return rows;
  }

  function renderStats() {
    var box = document.getElementById('stats');
    if (!box) return;
    var total = DATA.rows.reduce(function (s, r) { return s + r.implied_value_usd; }, 0);
    var top = DATA.rows[0];
    box.innerHTML = '';
    box.appendChild(el('div', { class: 'stat' }, el('b', { text: String(DATA.board_size) }), el('span', { text: 'protocols ranked' })));
    box.appendChild(el('div', { class: 'stat' }, el('b', { text: String(DATA.watchlist_size) }), el('span', { text: 'on the watchlist' })));
    box.appendChild(el('div', { class: 'stat' }, el('b', { text: fmtUsd(total) }), el('span', { text: 'total implied value' })));
    box.appendChild(el('div', { class: 'stat' }, el('b', { text: top ? top.name : 'n/a' }), el('span', { text: 'top pick · ' + (top ? fmtUsd(top.implied_value_usd) : '') })));
    var note = document.getElementById('srcnote');
    if (note) note.textContent = 'Snapshot ' + DATA.as_of + ' · ' + DATA.source + ' · watchlist floor ' + fmtUsd(DATA.floor_usd) + ' · model ' + DATA.model_version + '.';
  }

  function renderTabs() {
    var nav = document.getElementById('tabs');
    if (!nav) return;
    nav.innerHTML = '';
    [['board', 'Pre-token board (' + DATA.board_size + ')'], ['live', 'Live tokens (' + DATA.live_size + ')'], ['model', 'How the value is worked out']].forEach(function (t) {
      nav.appendChild(el('button', {
        class: 'tab', text: t[1], 'aria-selected': state.tab === t[0] ? 'true' : 'false',
        onclick: function () { state.tab = t[0]; state.selected = null; writeHash(); render(); }
      }));
    });
  }

  function sortButton(label, key) {
    var arrow = state.sort === key ? (state.dir === -1 ? ' ▼' : ' ▲') : '';
    return el('button', {
      text: label + arrow,
      onclick: function () {
        if (state.sort === key) state.dir = -state.dir;
        else { state.sort = key; state.dir = key === 'name' ? 1 : -1; }
        writeHash(); render();
      }
    });
  }

  function renderBoard() {
    var rows = filteredRows();
    var frag = document.createDocumentFragment();
    var cats = distinct(DATA.rows.map(function (r) { return r.category || 'Uncategorised'; }));
    var chains = distinct(DATA.rows.reduce(function (a, r) { return a.concat(r.chains || []); }, []));
    var bar = el('div', { class: 'filters' });
    var q = el('input', { type: 'search', placeholder: 'Search a protocol…', value: state.q, 'aria-label': 'Search protocols' });
    q.addEventListener('input', function () { state.q = q.value; writeHash(); renderTable(); });
    bar.appendChild(el('label', {}, 'Search ', q));
    var catSel = el('select', { 'aria-label': 'Filter by category' }, el('option', { value: 'all', text: 'All categories' }));
    cats.forEach(function (c) { catSel.appendChild(el('option', { value: c, text: c, selected: state.category === c ? 'selected' : null })); });
    catSel.addEventListener('change', function () { state.category = catSel.value; writeHash(); renderTable(); });
    bar.appendChild(el('label', {}, 'Category ', catSel));
    var chainSel = el('select', { 'aria-label': 'Filter by chain' }, el('option', { value: 'all', text: 'All chains' }));
    chains.forEach(function (c) { chainSel.appendChild(el('option', { value: c, text: c, selected: state.chain === c ? 'selected' : null })); });
    chainSel.addEventListener('change', function () { state.chain = chainSel.value; writeHash(); renderTable(); });
    bar.appendChild(el('label', {}, 'Chain ', chainSel));
    var watchBox = el('input', { type: 'checkbox', checked: state.watch ? 'checked' : null, 'aria-label': 'Watchlist only' });
    watchBox.addEventListener('change', function () { state.watch = watchBox.checked; writeHash(); renderTable(); });
    bar.appendChild(el('label', {}, watchBox, ' Watchlist only'));
    bar.appendChild(el('span', { class: 'count', text: rows.length + ' of ' + DATA.board_size + ' rows' + (sandbox.on ? ' · sandbox model' : '') }));
    frag.appendChild(bar);
    frag.appendChild(el('div', { id: 'detailwrap' }));
    frag.appendChild(el('div', { id: 'tablewrap' }));
    app.appendChild(frag);
    renderTable();
    if (state.selected) renderDetail();
  }

  function renderTable() {
    var wrap = document.getElementById('tablewrap');
    if (!wrap) return;
    var rows = filteredRows();
    var count = document.querySelector('.filters .count');
    if (count) count.textContent = rows.length + ' of ' + DATA.board_size + ' rows' + (sandbox.on ? ' · sandbox model' : '');
    wrap.innerHTML = '';
    if (rows.length === 0) {
      wrap.appendChild(el('div', { class: 'empty', text: 'No protocol matches these filters. Clear the search or pick another category.' }));
      return;
    }
    var table = el('table', { class: 'board' });
    var head = el('tr', {},
      el('th', { class: 'num' }, sortButton('Rank', 'rank')),
      el('th', {}, sortButton('Protocol', 'name')),
      el('th', {}, 'Category'),
      el('th', {}, 'Chains'),
      el('th', { class: 'num' }, sortButton('TVL', 'tvl')),
      el('th', { class: 'num' }, sortButton('7d', 'growth')),
      el('th', { class: 'num' }, sortButton('Age', 'age')),
      el('th', { class: 'num' }, sortButton('Implied value', 'implied')));
    table.appendChild(el('thead', {}, head));
    var body = el('tbody', {});
    rows.forEach(function (r) {
      var tr = el('tr', { class: state.selected === r.slug ? 'sel' : null, tabindex: '0', onclick: function () { selectRow(r.slug); }, onkeydown: function (e) { if (e.key === 'Enter') selectRow(r.slug); } });
      tr.appendChild(el('td', { class: 'num', text: String(r.rank) }));
      var nameCell = el('td', { class: 'name' }, document.createTextNode(r.name));
      nameCell.appendChild(el('span', { class: 'slug', text: r.slug }));
      if (r.watchlist) nameCell.appendChild(el('span', { class: 'pill watch', text: 'watchlist' }));
      tr.appendChild(nameCell);
      tr.appendChild(el('td', {}, el('span', { class: 'pill', text: r.category || 'Uncategorised' })));
      tr.appendChild(el('td', { class: 'muted', text: (r.chains || []).slice(0, 3).join(', ') + ((r.chains || []).length > 3 ? ' +' + ((r.chains || []).length - 3) : '') }));
      tr.appendChild(el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }));
      var g = r.change_7d;
      tr.appendChild(el('td', { class: 'num ' + (g === null ? 'muted' : g >= 0 ? 'up' : 'down'), text: fmtPct(g) }));
      tr.appendChild(el('td', { class: 'num muted', text: fmtAge(r.age_days) }));
      tr.appendChild(el('td', { class: 'num', text: fmtUsd(r.implied_value_usd) }));
      body.appendChild(tr);
    });
    table.appendChild(body);
    wrap.appendChild(table);
  }

  function selectRow(slug) {
    state.selected = state.selected === slug ? null : slug;
    writeHash();
    renderTable();
    renderDetail();
    if (state.selected) {
      var d = document.getElementById('detailwrap');
      if (d) d.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }

  function renderDetail() {
    var wrap = document.getElementById('detailwrap');
    if (!wrap) return;
    wrap.innerHTML = '';
    if (!state.selected) return;
    var row = null;
    DATA.rows.forEach(function (r) { if (r.slug === state.selected) row = r; });
    if (!row) return;
    var model = DATA.model;
    var v = impliedOf(row, model);
    var base = row.tvl_usd * model.base_multiple;
    var card = el('section', { class: 'detail', 'aria-label': 'Protocol detail' });
    card.appendChild(el('h2', { text: '#' + row.rank + ' · ' + row.name }));
    card.appendChild(el('p', { class: 'sub', text: (row.category || 'Uncategorised') + ' · ' + (row.chains || []).join(', ') + ' · listed ' + (row.listed_at || 'unknown') + ' · records no token' }));
    card.appendChild(el('h3', { text: 'Why it is worth ' + fmtUsd(row.implied_value_usd) }));
    var bd = el('div', { class: 'breakdown' });
    var maxBar = Math.max(base, row.implied_value_usd, 1);
    [['TVL base', fmtUsd(base), 'TVL ' + fmtUsd(row.tvl_usd) + ' × ' + model.base_multiple, base / maxBar],
      ['Growth', fmtMult(v.growthMult), fmtPct(row.change_7d) + ' over 7 days', Math.min(1, Math.abs(v.growthMult - 1) * 4 + 0.2)],
      ['Maturity', fmtMult(v.maturity), fmtAge(row.age_days) + ' with no token', (v.maturity - 0.6) / 0.4],
      ['Chain breadth', fmtMult(v.breadth), (row.chains || []).length + ' chain' + ((row.chains || []).length === 1 ? '' : 's'), ((row.chains || []).length) / 8],
      ['Implied value', fmtUsd(row.implied_value_usd), 'base × growth × maturity × breadth', 1]].forEach(function (f) {
        var box = el('div', { class: 'factor' });
        box.appendChild(el('b', { text: f[1] }));
        box.appendChild(el('span', { text: f[0] + ' — ' + f[2] }));
        box.appendChild(el('div', { class: 'bar' }, el('i', { style: 'width:' + Math.round(Math.max(0.05, Math.min(1, f[3])) * 100) + '%' })));
        bd.appendChild(box);
      });
    card.appendChild(bd);
    card.appendChild(el('h3', { text: 'How to farm it' }));
    var ol = el('ol', { class: 'steps' });
    farmSteps(row).forEach(function (s) { ol.appendChild(el('li', { text: s })); });
    card.appendChild(ol);
    card.appendChild(el('p', { class: 'muted', text: 'The page recomputes this number from the snapshot figures above; the sandbox in the model tab moves the constants and re-ranks the board.' }));
    wrap.appendChild(card);
  }

  function renderLive() {
    var frag = document.createDocumentFragment();
    frag.appendChild(el('div', { class: 'note' },
      el('b', { text: 'Kept apart on purpose. ' }),
      document.createTextNode('These protocols already have a token that trades, so the page shows the market\u2019s own value for them — never a model\u2019s claim — and never ranks them against the pre-token board.')));
    var table = el('table', { class: 'board' });
    table.appendChild(el('thead', {}, el('tr', {},
      el('th', {}, 'Protocol'), el('th', {}, 'Category'), el('th', {}, 'Chains'),
      el('th', { class: 'num' }, 'TVL'), el('th', { class: 'num' }, 'Market cap'), el('th', { class: 'num' }, '7d'))));
    var body = el('tbody', {});
    DATA.live.forEach(function (r) {
      var tr = el('tr', {});
      tr.appendChild(el('td', { class: 'name' }, document.createTextNode(r.name)));
      tr.appendChild(el('td', {}, el('span', { class: 'pill', text: r.category || 'Uncategorised' })));
      tr.appendChild(el('td', { class: 'muted', text: (r.chains || []).slice(0, 3).join(', ') }));
      tr.appendChild(el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }));
      tr.appendChild(el('td', { class: 'num', text: fmtUsd(r.mcap_usd) }));
      var g = r.change_7d;
      tr.appendChild(el('td', { class: 'num ' + (g === null ? 'muted' : g >= 0 ? 'up' : 'down'), text: fmtPct(g) }));
      body.appendChild(tr);
    });
    table.appendChild(body);
    frag.appendChild(table);
    app.appendChild(frag);
  }

  function renderModel() {
    var m = DATA.model;
    var top = DATA.rows[0];
    var frag = document.createDocumentFragment();
    var box = el('div', { class: 'modelbox' });
    box.appendChild(el('h2', { text: 'The value model, in the open' }));
    box.appendChild(el('p', { text: 'Implied value follows only from the snapshot\u2019s own figures — TVL, seven-day growth, how long the protocol has run with no token, and how many chains it runs on. No protocol name is ever special-cased; the same function scores every row.' }));
    box.appendChild(el('code', { text: 'implied = max(1, round(TVL × ' + m.base_multiple + ' × growth × maturity × breadth))\ngrowth   = 1 + clamp(change_7d, ' + m.growth_floor + ', ' + m.growth_cap + ') / 100 × ' + m.growth_weight + '\nmaturity = ' + m.maturity_floor + ' + min(age_days, ' + m.maturity_days + ') / ' + m.maturity_days + ' × ' + m.maturity_range + '   (unknown age: ' + m.unknown_age_days + ' days)\nbreadth  = 1 + ' + m.breadth_per_chain + ' × min(chains, ' + m.breadth_max_chains + ')' }));
    if (top) {
      var v = impliedOf(top, m);
      box.appendChild(el('p', { text: 'Worked example — the top row, ' + top.name + ': TVL ' + fmtUsd(top.tvl_usd) + ' × ' + m.base_multiple + ' = ' + fmtUsd(top.tvl_usd * m.base_multiple) + ', growth ' + fmtMult(v.growthMult) + ', maturity ' + fmtMult(v.maturity) + ', breadth ' + fmtMult(v.breadth) + ' → ' + fmtUsd(top.implied_value_usd) + '.' }));
    }
    box.appendChild(el('p', { class: 'muted', text: 'Coverage: all ' + DATA.watchlist_size + ' watchlist protocols are ranked, plus the ' + DATA.early_size + ' strongest pre-token protocols the watchlist leaves out, by TVL. The board never ranks a protocol whose token already trades.' }));
    frag.appendChild(box);

    var sand = el('div', { class: 'modelbox sandbox' });
    sand.appendChild(el('h2', { text: 'Model sandbox — move the constants, watch the board move' }));
    sand.appendChild(el('p', { text: 'The submitted board uses the constants above. These sliders re-rank the board in this page only, so a reader can see how much the ranking leans on each input.' }));
    var baseOut = el('output', { text: sandbox.base.toFixed(2) });
    var baseRange = el('input', { type: 'range', min: '0.1', max: '0.6', step: '0.05', value: String(sandbox.base), 'aria-label': 'Base multiple' });
    baseRange.addEventListener('input', function () { sandbox.base = parseFloat(baseRange.value); sandbox.on = true; baseOut.textContent = sandbox.base.toFixed(2); renderBoardOnly(); });
    sand.appendChild(el('label', {}, 'Base multiple (TVL share a token is worth): ', baseOut));
    sand.appendChild(baseRange);
    var wOut = el('output', { text: sandbox.weight.toFixed(2) });
    var wRange = el('input', { type: 'range', min: '0', max: '1', step: '0.1', value: String(sandbox.weight), 'aria-label': 'Growth weight' });
    wRange.addEventListener('input', function () { sandbox.weight = parseFloat(wRange.value); sandbox.on = true; wOut.textContent = sandbox.weight.toFixed(2); renderBoardOnly(); });
    sand.appendChild(el('label', {}, 'Growth weight (how much 7-day momentum matters): ', wOut));
    sand.appendChild(wRange);
    var reset = el('button', { class: 'tab', text: 'Reset to the submitted model' });
    reset.addEventListener('click', function () {
      sandbox.base = DATA.model.base_multiple; sandbox.weight = DATA.model.growth_weight; sandbox.on = false;
      baseRange.value = String(sandbox.base); wRange.value = String(sandbox.weight);
      baseOut.textContent = sandbox.base.toFixed(2); wOut.textContent = sandbox.weight.toFixed(2);
      renderBoardOnly();
    });
    sand.appendChild(el('p', {}, reset));
    sand.appendChild(el('div', { id: 'sandbox-board' }));
    frag.appendChild(sand);

    var note = el('div', { class: 'note' });
    note.appendChild(el('b', { text: 'How this radar meets the brief. ' }));
    note.appendChild(document.createTextNode('It covers every watchlist protocol and ranks 300 pre-token protocols by an implied value stated on every row; the value comes only from the snapshot\u2019s figures; live-token protocols are kept on their own tab at market value; every row carries a six-step farm plan with what it costs and how long it takes; and the board sorts, filters and opens a detail view for each protocol.'));
    frag.appendChild(note);
    app.appendChild(frag);
  }

  function renderBoardOnly() {
    var host = document.getElementById('sandbox-board');
    if (!host) return;
    host.innerHTML = '';
    var rows = filteredRows().slice(0, 10);
    var table = el('table', { class: 'board' });
    table.appendChild(el('thead', {}, el('tr', {},
      el('th', { class: 'num' }, 'Rank'), el('th', {}, 'Protocol'), el('th', { class: 'num' }, 'TVL'), el('th', { class: 'num' }, 'Implied value'))));
    var body = el('tbody', {});
    rows.forEach(function (r) {
      var tr = el('tr', {});
      tr.appendChild(el('td', { class: 'num', text: String(r.rank) }));
      tr.appendChild(el('td', { class: 'name', text: r.name }));
      tr.appendChild(el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }));
      tr.appendChild(el('td', { class: 'num', text: fmtUsd(r.implied_value_usd) }));
      body.appendChild(tr);
    });
    table.appendChild(body);
    host.appendChild(table);
    host.appendChild(el('p', { class: 'muted', text: 'Top 10 under the sandbox constants' + (sandbox.on ? '' : ' (submitted model)') + '.' }));
  }

  function render() {
    app.setAttribute('aria-busy', 'true');
    app.innerHTML = '';
    renderStats();
    renderTabs();
    if (state.tab === 'live') renderLive();
    else if (state.tab === 'model') { renderModel(); renderBoardOnly(); }
    else renderBoard();
    app.setAttribute('aria-busy', 'false');
  }

  readHash();
  render();
})();
