// running as the Chrome/Edge extension's side panel (mg comes from mg-shim.js there) or in the desktop app
const IS_EXT = window.mg?.platform === 'extension';
if (IS_EXT) document.body.classList.add('ext');
// or as the public website (mg comes from mg-web.js there): no game and no buying, just the alarm and the shop
const IS_WEB = window.mg?.platform === 'web';
if (IS_WEB) document.body.classList.add('web', 'ext');

// opening animation: the header, clocks, weather and tabs come in one after another
document.body.classList.add('intro');
setTimeout(() => document.body.classList.remove('intro'), 1600);

// ---------- names ----------
const SHOP_NAMES = { seed: 'Seed Shop', egg: 'Egg Shop', tool: 'Tool Shop', decor: 'Decor Shop', rain: 'Rain Shop', snow: 'Snow Shop',
  thunder: 'Thunder Shop', dawn: 'Dawn Shop', amber: 'Amber Moon Shop', spooky: 'Spooky Shop', apology: 'Apology Shop' };
const shopName = s => SHOP_NAMES[s] || (s[0].toUpperCase() + s.slice(1) + ' Shop');
const TYPE_ICON = { Seed: '🌱', Egg: '🥚', Tool: '🧪', Decor: '🪴' };
const WEATHER = { Rain: 'Rain', Frost: 'Snow', Thunderstorm: 'Thunderstorm', Dawn: 'Dawn', AmberMoon: 'Amber Moon' };
const GROUPS = { Lunar: 'Dawn or Amber Moon', Hydro: 'Rain or Snow' };
const OPENS_WITH = { rain: 'Rain', snow: 'Snow', thunder: 'Thunderstorm', dawn: 'Dawn', amber: 'Amber Moon' };
const RANK = { Common: 0, Uncommon: 1, Rare: 2, Legendary: 3, Mythical: 4, Divine: 5, Celestial: 6 };
const MAIN_SHOPS = ['seed', 'egg', 'tool', 'decor'];
const CLOCK_LABELS = { seed: ['Seeds', 'Seed:Carrot'], egg: ['Eggs', 'Egg:CommonEgg'], tool: ['Tools', 'Tool:WateringCan'], decor: ['Decor', 'Decor:WoodBench'] };
const WEATHER_ICON = { Rain: '🌧️', Frost: '❄️', Thunderstorm: '⛈️', Dawn: '🌅', AmberMoon: '🌕', Lunar: '🌙', Hydro: '🌦️' };
const weatherIcon = f => WEATHER_ICON[f.weather] || WEATHER_ICON[f.group] || '🌤️';
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const $ = id => document.getElementById(id);

let catalog = [], byKey = {}, watched = new Set(), shops = null, weather = null, clockOffset = 0, settings = {}, icons = {}, prices = {}, levels = {};
let seen = {}; // item key -> { at: when its last restock started, n: how many restocks the app has seen it in }
// "last in the shop 3h ago"
function seenText(key, short) {
  const s = seen[key];
  if (!s) return short ? '' : 'not seen yet';
  const m = Math.max(0, Math.round((now() - s.at) / 60000));
  const ago = m < 1 ? 'just now' : m < 60 ? `${m}m ago` : m < 48 * 60 ? `${Math.floor(m / 60)}h ago` : `${Math.round(m / 1440)}d ago`;
  return `seen ${ago}${short ? '' : ` · ${s.n}×`}`;
}
// how hard an item's alert is, quietest first
const LEVELS = {
  silent: { icon: '🔕', name: 'Silent', desc: 'Just shows it, no sound' },
  ping:   { icon: '🔔', name: 'Ping', desc: 'One sound' },
  alert:  { icon: '📣', name: 'Alert', desc: 'Rings 3 times, flashes the taskbar' },
  alarm:  { icon: '🚨', name: 'Alarm', desc: 'Rings until it leaves the shop' },
};
const LEVEL_ORDER = ['silent', 'ping', 'alert', 'alarm'];
const levelOf = key => levels[key] || settings.defaultLevel || 'alarm';
const strongest = list => list.reduce((m, h) => LEVEL_ORDER.indexOf(h.level) > LEVEL_ORDER.indexOf(m) ? h.level : m, 'silent');
let typeFilter = 'all';
const now = () => Date.now() + clockOffset;
const store = { get(k) { try { return localStorage.getItem(k); } catch { return null; } }, set(k, v) { try { localStorage.setItem(k, v); } catch {} } };
// an item's picture from the game, or a stand-in until the pictures have been taken
const pic = (key, type) => icons[key] ? `<img src="${icons[key]}" alt="">` : `<span class="emo">${TYPE_ICON[type] || '✨'}</span>`;

function fmtLeft(ms) {
  if (!(ms > 0)) return '';
  const s = Math.ceil(ms / 1000), m = Math.floor(s / 60);
  if (m >= 60) return `${Math.floor(m / 60)}h ${m % 60}m`;
  return `${m}:${String(s % 60).padStart(2, '0')}`;
}
const weatherName = f => f.weather ? (WEATHER[f.weather] || f.weather) : (GROUPS[f.group] || f.group || 'Weather') + '?';

// ---------- tabs ----------
function showTab(name) {
  document.querySelectorAll('.tabs button').forEach(x => x.classList.toggle('active', x.dataset.tab === name));
  document.querySelectorAll('.pane').forEach(p => p.classList.toggle('active', p.id === 'pane-' + name));
  store.set('tab', name);
  // the opened tab's cards come in one after another (only on switching, not on every update)
  const pane = $('pane-' + name);
  const order = ['mine', 'pick', 'shop', 'calc'], dir = order.indexOf(name) >= order.indexOf(showTab.last ?? name) ? 'from-right' : 'from-left';
  showTab.last = name;
  if (pane) { pane.classList.remove('enter', 'from-right', 'from-left'); void pane.offsetWidth; pane.classList.add('enter', dir); clearTimeout(pane._enterT); pane._enterT = setTimeout(() => pane.classList.remove('enter'), 900); }
}
document.querySelectorAll('.tabs button').forEach(b => b.onclick = () => showTab(b.dataset.tab));
showTab(['mine', 'pick', 'shop', 'calc'].includes(store.get('tab')) ? store.get('tab') : 'mine');

// ---------- what's in stock ----------
function stockOf(key) {
  if (!shops) return 0;
  for (const s of Object.values(shops)) for (const it of s.items) if (it.key === key) return it.stock;
  return 0;
}
function shopOpens(shop) {
  if (!weather) return null;
  if (weather.now?.shop === shop) return { now: true };
  const f = weather.forecast.find(f => f.shop === shop);
  return f ? { at: f.startsAtMs } : null;
}

// ---------- restocks + weather ----------
const clockEnds = {}; // each shop's last restock deadline, to spot a restock happening
// the game's own restock pictures for each shop clock, and its toast pictures for the alarm board
const CLOCK_ART = { seed: 'SeedsRestocked', egg: 'EggsRestocked', tool: 'ToolsRestocked', decor: 'DecorRestocked' };
const TOAST_ART = { seed: 'ToastIllustrationSeeds', egg: 'ToastIllustrationEggs', tool: 'ToastIllustrationTools', snow: 'ToastIllustrationSnowShop',
  thunder: 'ToastIllustrationThunderShop', dawn: 'ToastIllustrationDawnShop', amber: 'ToastIllustrationAmberShop', spooky: 'ToastIllustrationSpookyShop' };
function renderSummary() {
  const restocked = MAIN_SHOPS.filter(k => clockEnds[k] && shops?.[k]?.deadlineMs && shops[k].deadlineMs !== clockEnds[k]);
  for (const k of MAIN_SHOPS) if (shops?.[k]?.deadlineMs) clockEnds[k] = shops[k].deadlineMs;
  requestAnimationFrame(() => restocked.forEach(k => document.querySelector(`[data-clock="${k}"]`)?.classList.add('restocked')));
  $('clocks').innerHTML = MAIN_SHOPS.map(k => {
    const s = shops?.[k], [label, iconKey] = CLOCK_LABELS[k];
    return `<div class="clock" data-clock="${k}" data-start="${s?.startedAtMs || 0}" data-end="${s?.deadlineMs || 0}">
      <div class="lbl">${icons[iconKey] ? `<img src="${icons[iconKey]}" alt="">` : ''}${label}</div><div class="t num">–:––</div><div class="bar"><i></i></div></div>`;
  }).join('');
  renderWeather();
}

// ---------- the weather window: the game's own weather icon and animation, and what's coming ----------
// The art comes from the game's files (icon-extractor.js): an icon per weather ("Weather:Rain" in icons) and,
// in wxart, a strip of frames per weather. Rain, Frost, Dawn and Amber Moon are tiles the game repeats across
// the screen; Thunderstorm is a lightning strike. They're drawn on a small canvas behind the card.
const SCENE = { Rain: 'rain', Frost: 'snow', Thunderstorm: 'storm', Dawn: 'dawn', AmberMoon: 'amber' };
let wxart = {}, lastWeatherKey = '';
const wxImg = {};
function wxImage(name) {
  const a = wxart[name]; if (!a?.src) return null;
  if (!wxImg[name] || wxImg[name].src !== a.src) { const im = new Image(); im.src = a.src; wxImg[name] = im; }
  return wxImg[name].complete && wxImg[name].naturalWidth ? wxImg[name] : null;
}
// the game's icon for a weather (or a forecast group like "Lunar"), or an emoji until the art is in
function wxIcon(f) {
  const key = f ? (f.weather ? `Weather:${f.weather}` : f.group === 'Lunar' ? 'Weather:Lunar' : null) : 'Weather:Sunny';
  return key && icons[key] ? `<img src="${icons[key]}" alt="">` : (f ? weatherIcon(f) : '☀️');
}
// Each weather is drawn as layers of the game's own animated tiles, scrolling like the game's weather pass:
// a far layer (smaller, fainter, slower) and a near one (bigger, brighter, faster) for depth. Frames play at
// their own pace while the pattern glides smoothly at full frame rate.
const WX_LAYERS = {
  Rain:         [{ tile: 'Rain', size: 76, alpha: .5, vx: -34, vy: 230, fps: 12, blend: 'screen' }, { tile: 'Rain', size: 118, alpha: .9, vx: -60, vy: 400, fps: 12, blend: 'screen' }],
  Thunderstorm: [{ tile: 'Rain', size: 76, alpha: .45, vx: -50, vy: 260, fps: 12, blend: 'screen' }, { tile: 'Rain', size: 124, alpha: .85, vx: -85, vy: 470, fps: 12, blend: 'screen' }],
  Frost:        [{ tile: 'Frost', size: 88, alpha: .6, vx: 10, vy: 16, fps: 8, blend: 'screen' }, { tile: 'Frost', size: 136, alpha: 1, vx: -14, vy: 34, fps: 8, blend: 'screen' }],
  Dawn:         [{ tile: 'Dawn', size: 160, alpha: .95, vx: 9, vy: -6, fps: 7, blend: 'lighter' }, { tile: 'Dawn', size: 104, alpha: .55, vx: -6, vy: -11, fps: 9, blend: 'lighter' }],
  AmberMoon:    [{ tile: 'AmberMoon', size: 160, alpha: 1, vx: -8, vy: -4, fps: 7, blend: 'lighter' }, { tile: 'AmberMoon', size: 106, alpha: .7, vx: 6, vy: -9, fps: 9, blend: 'lighter' }],
};
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)');
let wxName = null, wxStart = 0, wxStrike = null, wxNextStrike = 0;
function drawWeather(ts) {
  requestAnimationFrame(drawWeather);
  const card = $('weather'), cvs = card.querySelector('canvas');
  const name = weather?.now?.weather;
  if (!cvs || !name) return;
  if (name !== wxName) { wxName = name; wxStart = ts; wxStrike = null; wxNextStrike = ts + 1800; }
  const dpr = devicePixelRatio || 1, W = card.clientWidth, Hh = card.clientHeight;
  if (cvs.width !== Math.round(W * dpr) || cvs.height !== Math.round(Hh * dpr)) { cvs.width = Math.round(W * dpr); cvs.height = Math.round(Hh * dpr); }
  const c = cvs.getContext('2d');
  c.setTransform(dpr, 0, 0, dpr, 0, 0);
  c.clearRect(0, 0, W, Hh);
  const t = reduceMotion.matches ? 0 : (ts - wxStart) / 1000;
  const fade = reduceMotion.matches ? 1 : Math.min(1, (ts - wxStart) / 800); // eases in when the weather changes
  for (const L of WX_LAYERS[name] || []) {
    const img = wxImage(L.tile), a = wxart[L.tile]; if (!img || !a) continue;
    const f = Math.floor(t * L.fps) % a.frames, s = L.size;
    const ox = ((t * L.vx) % s + s) % s, oy = ((t * L.vy) % s + s) % s;
    c.globalAlpha = L.alpha * fade; c.globalCompositeOperation = L.blend;
    for (let y = oy - s; y < Hh; y += s) for (let x = ox - s; x < W; x += s) c.drawImage(img, f * a.fw, 0, a.fw, a.fh, x, y, s, s);
  }
  c.globalCompositeOperation = 'source-over'; c.globalAlpha = 1;
  // a thunderstorm: every few seconds the game's lightning strike, with a flash of light as it lands
  if (name === 'Thunderstorm' && !reduceMotion.matches) {
    const bolt = wxImage('Thunderstorm'), ba = wxart.Thunderstorm;
    if (bolt && ba) {
      if (!wxStrike && ts > wxNextStrike) { wxStrike = { x: W * 0.5 + Math.random() * (W * 0.5 - 110), start: ts }; wxNextStrike = ts + 3500 + Math.random() * 5000; }
      if (wxStrike) {
        const f = Math.floor((ts - wxStrike.start) / 75);
        if (f >= ba.frames) wxStrike = null;
        else {
          const flash = f === 3 ? .3 : f === 4 ? .14 : f === 5 ? .05 : 0;
          if (flash) { c.fillStyle = `rgba(255,250,225,${flash})`; c.fillRect(0, 0, W, Hh); }
          const h = Math.max(Hh * 2.4, 220), w = h * ba.fw / ba.fh;
          c.drawImage(bolt, f * ba.fw, 0, ba.fw, ba.fh, wxStrike.x, -4, w, h);
        }
      }
    }
  }
}
requestAnimationFrame(drawWeather);const sceneBits = () => '<canvas></canvas>';
function renderWeather() {
  const w = $('weather');
  const key = JSON.stringify(weather) + !!icons['Weather:Rain'];
  if (key === lastWeatherKey && w.firstChild) return; // keep the scene running smoothly between updates
  lastWeatherKey = key;
  if (!weather) { w.className = 'weather wx'; w.dataset.scene = 'clear'; w.innerHTML = `<div class="wscene">${sceneBits('clear')}</div><div class="wbody"><span class="wbadge">⛅</span><div class="wtxt"><div class="wname">Checking the sky…</div></div></div>`; return; }
  const n = weather.now, upcoming = weather.forecast.filter(f => f.startsAtMs > now()).slice(0, 3);
  const scene = n ? (SCENE[n.weather] || 'clear') : 'clear';
  let body;
  if (n) {
    body = `<span class="wbadge">${wxIcon(n)}</span>
      <div class="wtxt"><div class="wkicker">Weather now</div><div class="wname">${esc(weatherName(n))}</div>
        <div class="wsub">${n.shop ? `${esc(shopName(n.shop))} is open` : 'No shop for this one'}</div></div>
      ${n.endsAtMs ? `<div class="wtime"><b class="num" data-until="${n.endsAtMs}"></b><small>left</small></div>` : ''}`;
  } else {
    const f = upcoming[0];
    body = `<span class="wbadge">${wxIcon(null)}</span>
      <div class="wtxt"><div class="wkicker">Clear skies</div><div class="wname">${f ? `${esc(weatherName(f))} next` : 'Nothing coming'}</div>
        <div class="wsub">${f ? (OPENS_WITH[f.shop] ? `brings the ${esc(shopName(f.shop))}` : f.group && !f.weather ? 'which one is a surprise' : 'on its way') : 'No weather on the forecast'}</div></div>
      ${f ? `<div class="wtime"><b class="num" data-until="${f.startsAtMs}"></b><small>to go</small></div>` : ''}`;
  }
  const later = (n ? upcoming : upcoming.slice(1)).slice(0, 2);
  const changed = w.dataset.scene !== scene;
  w.className = 'weather wx' + (changed ? ' wx-enter' : '');
  w.dataset.scene = scene;
  w.innerHTML = `<div class="wscene">${sceneBits(scene)}</div>
    <div class="wbody">${body}</div>
    ${later.length ? `<div class="wnext"><span class="wnl">Then</span>${later.map(f => `<span class="wchip" title="${esc(weatherName(f))}">${wxIcon(f)} ${esc(f.weather ? weatherName(f) : f.group === 'Lunar' ? 'Lunar' : weatherName(f))} <span class="num" data-until="${f.startsAtMs}" data-prefix="in "></span></span>`).join('')}</div>` : ''}
    ${n?.endsAtMs && n.startsAtMs ? `<div class="wbar"><i data-wstart="${n.startsAtMs}" data-wend="${n.endsAtMs}"></i></div>` : ''}`;
}

// ---------- my alarms ----------
function alarmStatus(it) {
  const st = stockOf(it.key);
  if (st > 0) {
    const s = shops?.[it.shop];
    return { in: true, html: `In shop ×${st}<small>${s?.deadlineMs ? `<span class="num" data-until="${s.deadlineMs}" data-prefix="gone in "></span>` : ''}</small>` };
  }
  if (OPENS_WITH[it.shop]) {
    const o = shopOpens(it.shop);
    if (o?.now) return { html: `Not this time<small>next ${esc(OPENS_WITH[it.shop])}</small>` };
    if (o?.at) return { html: `<span class="num" data-until="${o.at}"></span><small>${esc(OPENS_WITH[it.shop])} starts</small>` };
    return { html: `Waiting<small>for ${esc(OPENS_WITH[it.shop])}</small>` };
  }
  const s = shops?.[it.shop];
  if (s?.deadlineMs) return { html: `<span class="num" data-until="${s.deadlineMs}"></span><small>next restock</small>` };
  return { html: 'Waiting' };
}
const alarmRow = (it, s) => `<div class="row alarm${s.in ? ' in' : ''}" data-r="${esc(it.rarity || 'Common')}">
  <div class="pic">${pic(it.key, it.type)}</div>
  <div class="info"><div class="nm">${esc(it.name)}</div><div class="sub"><span class="rar">${esc(it.rarity || '')}</span> · ${esc(shopName(it.shop))}</div>${s.in ? '' : `<div class="sub seen">${esc(seenText(it.key))}</div>`}</div>
  <button class="lvl" data-level="${levelOf(it.key)}" data-level-for="${esc(it.key)}" title="How loud this alarm is">${LEVELS[levelOf(it.key)].icon} ${LEVELS[levelOf(it.key)].name}<span class="chev">▼</span></button>
  <div class="state">${s.html}</div>${s.in ? buyBtn(it.key) : ''}
  <button class="x" title="Remove this alarm" data-unwatch="${esc(it.key)}">✕</button>
</div>`;
function renderMine() {
  $('watchCount').textContent = watched.size || '';
  const items = catalog.filter(it => watched.has(it.key));
  if (!items.length) {
    $('mineList').innerHTML = `<div class="empty">${icons['Seed:Starweaver'] ? `<img class="art" src="${icons['Seed:Starweaver']}" alt="">` : ''}<b>No alarms yet</b>Pick the items you want, and this rings when they're in the shop.<br><button class="primary" id="goPick">Choose items</button></div>`;
    $('goPick').onclick = () => showTab('pick');
    return;
  }
  const byRarity = (a, b) => (RANK[b.it.rarity] ?? -1) - (RANK[a.it.rarity] ?? -1);
  const rows = items.map(it => ({ it, s: alarmStatus(it) }));
  const inShop = rows.filter(r => r.s.in).sort(byRarity), waiting = rows.filter(r => !r.s.in).sort(byRarity);
  let html = '';
  if (inShop.length) html += `<div class="label gold">🔔 Notification Items · in the shop now</div><div class="list">${inShop.map(r => alarmRow(r.it, r.s)).join('')}</div>`;
  if (waiting.length) html += `<div class="label">Waiting</div><div class="list">${waiting.map(r => alarmRow(r.it, r.s)).join('')}</div>`;
  $('mineList').innerHTML = html;
  tick(); // fill in the countdowns straight away
}
$('mineList').addEventListener('click', async e => {
  const lv = e.target.closest('[data-level-for]');
  if (lv) { openLevelMenu(lv); return; }
  const key = e.target.closest('[data-unwatch]')?.dataset.unwatch;
  if (key) { watched = new Set(await mg.watch(key, false)); renderAll(); }
});

// ---------- the level menu ----------
let menuFor = null;
function openLevelMenu(btn) {
  menuFor = btn.dataset.levelFor;
  const cur = levelOf(menuFor);
  $('lvlMenu').innerHTML = LEVEL_ORDER.map(id => `<button data-pick="${id}"${id === cur ? ' class="cur"' : ''}>
    <span class="li">${LEVELS[id].icon}</span><span><b>${LEVELS[id].name}</b><small>${LEVELS[id].desc}</small></span></button>`).join('');
  const r = btn.getBoundingClientRect(), m = $('lvlMenu');
  m.classList.add('show');
  const h = m.offsetHeight, w = m.offsetWidth;
  m.style.left = Math.max(8, Math.min(innerWidth - w - 8, r.right - w)) + 'px';
  m.style.top = (r.bottom + 6 + h < innerHeight ? r.bottom + 6 : r.top - h - 6) + 'px';
}
function closeLevelMenu() { $('lvlMenu').classList.remove('show'); menuFor = null; }
$('lvlMenu').addEventListener('click', async e => {
  const id = e.target.closest('[data-pick]')?.dataset.pick;
  if (!id || !menuFor) return;
  levels = await mg.setLevel(menuFor, id);
  closeLevelMenu();
  renderMine();
  previewLevel(id);
});
document.addEventListener('mousedown', e => { if (menuFor && !e.target.closest('#lvlMenu, [data-level-for]')) closeLevelMenu(); });
document.querySelector('main').addEventListener('scroll', closeLevelMenu, true);

// ---------- all items ----------
const FILTERS = [['all', 'All'], ['Seed', 'Seeds'], ['Egg', 'Eggs'], ['Tool', 'Tools'], ['Decor', 'Decor'], ['on', 'Ticked']];
$('chips').innerHTML = FILTERS.map(([k, l]) => `<button data-f="${k}"${k === 'all' ? ' class="active"' : ''}>${l}</button>`).join('');
$('chips').onclick = e => {
  const b = e.target.closest('[data-f]'); if (!b) return;
  typeFilter = b.dataset.f;
  $('chips').querySelectorAll('button').forEach(x => x.classList.toggle('active', x === b));
  renderPick();
};
function renderPick() {
  const q = $('search').value.trim().toLowerCase();
  const groups = {};
  for (const it of catalog) {
    if (q && !it.name.toLowerCase().includes(q)) continue;
    if (typeFilter === 'on' ? !watched.has(it.key) : typeFilter !== 'all' && it.type !== typeFilter) continue;
    (groups[it.shop] ||= []).push(it);
  }
  let html = '';
  for (const [shop, items] of Object.entries(groups)) {
    let meta = '';
    if (OPENS_WITH[shop]) {
      const o = shopOpens(shop);
      meta = o?.now ? `<span class="open">open now</span>` : o?.at ? `opens in <span class="num" data-until="${o.at}"></span>` : `opens with ${OPENS_WITH[shop]}`;
    } else if (shops?.[shop]?.deadlineMs) meta = `restock <span class="num" data-until="${shops[shop].deadlineMs}"></span>`;
    html += `<div class="shopblock"><div class="shophead"><div class="label">${esc(shopName(shop))}</div><span class="meta">${meta}</span></div><div class="list">`;
    for (const it of items) {
      const on = watched.has(it.key), st = stockOf(it.key);
      html += `<button class="row item${on ? ' on' : ''}" data-key="${esc(it.key)}" data-r="${esc(it.rarity || 'Common')}" aria-pressed="${on}">
        <span class="pic">${pic(it.key, it.type)}</span>
        <span class="nm">${esc(it.name)}<span class="rar">${esc(it.rarity || '')}${seen[it.key] && !(st > 0) ? `<span class="seen"> · ${esc(seenText(it.key, true))}</span>` : ''}</span></span>
        ${st > 0 ? `<span class="stock num">×${st}</span>` : ''}<span class="switch"></span></button>`;
    }
    html += `</div></div>`;
  }
  $('pickList').innerHTML = html || `<div class="empty">${typeFilter === 'on' ? 'Nothing ticked yet.' : 'No items match.'}</div>`;
  tick();
}
$('pickList').addEventListener('click', async e => {
  const b = e.target.closest('[data-key]'); if (!b) return;
  const on = !watched.has(b.dataset.key);
  b.classList.toggle('on', on);
  b.classList.remove('bounce'); void b.offsetWidth; b.classList.add('bounce');
  watched = new Set(await mg.watch(b.dataset.key, on));
  renderMine();
  renderShop();
  if (typeFilter === 'on') renderPick();
});
$('search').oninput = renderPick;

// ---------- shop now ----------
function renderShop() {
  if (!shops) return;
  let html = '';
  // weather and event shops (rare, only open a while) first, then Seed, Egg, Tool, Decor
  const place = n => MAIN_SHOPS.includes(n) ? 100 + MAIN_SHOPS.indexOf(n) : 0;
  const order = Object.entries(shops).sort(([a], [b]) => place(a) - place(b));
  // cheapest first (by the game's coin price; rarity when a price isn't known)
  const cost = i => prices[i.key] ?? (RANK[i.rarity] ?? 0) * 1e9;
  // a shop box like the game's: coin price top left, how many bottom right, the name on the shelf below
  const short = n => n >= 1e9 ? +(n / 1e9).toFixed(1) + 'B' : n >= 1e6 ? +(n / 1e6).toFixed(1) + 'M' : n >= 1e3 ? +(n / 1e3).toFixed(1) + 'K' : n;
  const tile = i => `<div class="tile${watched.has(i.key) ? ' mine' : ''}" data-r="${esc(i.rarity || 'Common')}" data-tkey="${esc(i.key)}" title="${esc(i.name)} · ${esc(i.rarity || '')} · click to ${watched.has(i.key) ? 'remove the alarm' : 'set an alarm'}">
        <div class="box">${typeof prices[i.key] === 'number' ? `<span class="price num"><i class="coin"></i>${short(prices[i.key])}</span>` : ''}<div class="pic">${pic(i.key, i.type)}</div><span class="q num">×${i.stock}</span></div>
        <div class="nm">${esc(i.name.replace(/ (Seed|Spore|Pod|Cutting|Kernel|Bean|Pit)$/, ''))}</div>${buyBtn(i.key)}</div>`;
  // the items you have alarms for that are in the shop right now, in gold at the very top
  const mine = order.flatMap(([, s]) => s.items.filter(i => i.stock > 0 && watched.has(i.key))).sort((a, b) => cost(a) - cost(b));
  if (mine.length) html += `<div class="shopblock mine"><div class="shophead"><div class="label gold">🔔 Notification Items</div><span class="meta">${mine.length} in the shop now</span></div><div class="tiles">${mine.map(tile).join('')}</div></div>`;
  for (const [name, s] of order) {
    if (!s.items.length) continue;
    // your alarm items first (in gold), then cheapest to most expensive
    const inStock = s.items.filter(i => i.stock > 0).sort((a, b) => watched.has(b.key) - watched.has(a.key) || cost(a) - cost(b));
    const out = s.items.length - inStock.length;
    html += `<div class="shopblock"><div class="shophead"><div class="label">${esc(shopName(name))}</div><span class="meta num" data-until="${s.deadlineMs || 0}" data-prefix="restock "></span></div>`;
    html += inStock.length ? `<div class="tiles">` + inStock.map(tile).join('') + `</div>`
      : '<div class="more">Sold out</div>';
    if (inStock.length && out) html += `<div class="more">${out} more sold out</div>`;
    html += `</div>`;
  }
  $('shopList').innerHTML = html || '<div class="empty">No shops open right now.</div>';
}
// click a tile in Shop now to set (or remove) an alarm for it
$('shopList').addEventListener('click', async e => {
  const key = e.target.closest('[data-tkey]')?.dataset.tkey; if (!key) return;
  watched = new Set(await mg.watch(key, !watched.has(key)));
  renderMine(); renderPick(); renderShop();
});


// ---------- crop calculator: what a crop sells for ----------
// Worked out the way the game does it (from its own code):
//   price = base sell price × size multiplier × mutation multiplier
//   size multiplier = 1 + (max size − 1) × (size − 50) / 50, size runs 50..100
//   mutation multiplier = colour (Gold ×25, Rainbow ×50) × (1 + weather + moon − how many of those two)
let crops = {};
const CALC_MUTS = [
  ['Colour', [['Gold', 25], ['Rainbow', 50]]],
  ['Weather', [['Wet', 2], ['Chilled', 2], ['Thunderstruck', 5], ['Frozen', 6], ['Thundercharged', 7]]],
  ['Moon', [['Dawnlit', 4], ['Amberlit', 6], ['Dawnbound', 7], ['Amberbound', 10]]],
];
const MUT_EMOJI = { Gold: '🟡', Rainbow: '🌈', Wet: '💧', Chilled: '❄️', Frozen: '🧊', Thunderstruck: '⚡', Thundercharged: '🌩️', Dawnlit: '🌅', Amberlit: '🌕', Dawnbound: '🌄', Amberbound: '🟠' };
const calc = { crop: store.get('calcCrop') || 'Seed:Carrot', muts: (() => { try { return JSON.parse(store.get('calcMuts')) || {}; } catch { return {}; } })() };
function fmtCoins(n) {
  const a = Math.abs(n), s = n < 0 ? '−' : '';
  for (const [v, u] of [[1e15, 'Q'], [1e12, 'T'], [1e9, 'B'], [1e6, 'M'], [1e3, 'K']]) if (a >= v) return s + (a / v).toFixed(a / v < 10 ? 2 : a / v < 100 ? 1 : 0).replace(/\.(\d*?)0+$/, '.$1').replace(/\.$/, '') + u;
  return s + Math.round(a).toLocaleString();
}
const calcSize = () => Math.min(100, Math.max(50, +$('calcSize').value || 75));
const calcQty = () => Math.max(1, Math.floor(+$('calcQty').value || 1));
function calcMutMult() {
  const colour = calc.muts.Colour ? CALC_MUTS[0][1].find(m => m[0] === calc.muts.Colour)[1] : 1;
  const others = ['Weather', 'Moon'].map(g => calc.muts[g] && CALC_MUTS.find(x => x[0] === g)[1].find(m => m[0] === calc.muts[g])[1]).filter(Boolean);
  return colour * (1 + others.reduce((s, m) => s + m, 0) - others.length);
}
function renderCalcGrid() {
  const q = $('calcSearch').value.trim().toLowerCase();
  const list = Object.entries(crops).map(([key, c]) => ({ key, c, name: c.name || key.split(':')[1], rarity: byKey[key]?.rarity || RARITY_OF(key) }))
    .filter(x => !q || x.name.toLowerCase().includes(q))
    .sort((a, b) => (RANK[a.rarity] ?? 9) - (RANK[b.rarity] ?? 9) || a.c.sell - b.c.sell);
  $('calcGrid').innerHTML = list.map(x => `<button class="cg${x.key === calc.crop ? ' on' : ''}" data-crop="${esc(x.key)}" data-r="${esc(x.rarity || 'Common')}" title="${esc(x.name)}${x.rarity ? ' · ' + esc(x.rarity) : ''}">
    <div class="pic">${pic(x.key, 'Seed')}</div><span><i class="dot"></i>${esc(x.name)}</span></button>`).join('') || '<div class="more">No crops match.</div>';
}
const RARITY_OF = key => byKey[key]?.rarity || null;
function renderCalcMuts() {
  $('calcMuts').innerHTML = CALC_MUTS.map(([g, opts]) => `<div class="mutgrp"><span class="gl">${g}</span><div class="opts">${opts.map(([m, x]) =>
    `<button class="mut${calc.muts[g] === m ? ' on' : ''}" data-g="${g}" data-m="${m}">${MUT_EMOJI[m] || ''} ${m} ×${x}</button>`).join('')}</div></div>`).join('');
}
function renderCalc() {
  const c = crops[calc.crop];
  const size = calcSize(), qty = calcQty();
  $('calcSizeVal').innerHTML = `size <b>${size}</b>${c ? ` · ×${(1 + (c.maxScale - 1) * (size - 50) / 50).toFixed(2)}` : ''}`;
  if (!c) { $('calcResult').innerHTML = `<div class="empty" style="padding:24px 10px"><b>${Object.keys(crops).length ? 'Pick a crop below' : "Reading the game's crops…"}</b>${Object.keys(crops).length ? '' : 'This takes a few seconds once the game has loaded.'}</div>`; return; }
  const sizeMult = 1 + (c.maxScale - 1) * (size - 50) / 50, mm = calcMutMult();
  const each = Math.round(c.sell * sizeMult * mm), total = each * qty;
  const seed = prices[calc.crop], rarity = RARITY_OF(calc.crop);
  const muts = ['Colour', 'Weather', 'Moon'].map(g => calc.muts[g]).filter(Boolean);
  const multi = c.harvest === 'Multiple';
  const perPlant = multi ? c.slots : c.slotMin ? `${c.slotMin}–${c.slotMax}` : 1;
  let extra = '';
  if (typeof seed === 'number') {
    const profit = multi ? null : each * (c.slotMin ? (c.slotMin + c.slotMax) / 2 : 1) - seed;
    extra = `<div class="calc-extra">
      <div>Seed costs<b class="num">${fmtCoins(seed)}</b></div>
      ${multi ? `<div>One full harvest (${c.slots} fruit)<b class="num good">${fmtCoins(each * c.slots)}</b></div>`
        : `<div>Profit per seed${c.slotMin ? ' (avg crops)' : ''}<b class="num ${profit >= 0 ? 'good' : 'bad'}">${fmtCoins(profit)}</b></div>`}
    </div>`;
  }
  $('calcResult').innerHTML = `<div class="calc-result" data-r="${esc(rarity || 'Common')}">
    <div class="calc-top"><div class="pic">${pic(calc.crop, 'Seed')}</div>
      <div class="info"><div class="nm">${muts.length ? esc(muts.join(' ')) + ' ' : ''}${esc(c.name)}</div>
        <div class="sub">${esc(rarity || '')}${rarity ? ' · ' : ''}${multi ? `keeps fruiting · ${perPlant} per plant` : c.slotMin ? `${perPlant} crops per seed` : 'one crop per seed'} · max size ×${c.maxScale}</div></div>
      <div class="calc-price"><b class="num">${fmtCoins(total)}</b><small>${qty > 1 ? `${qty} × ${fmtCoins(each)}` : 'sells for'}</small></div></div>
    <div class="calc-break"><span class="chip num">${fmtCoins(c.sell)}</span><span>base</span><span class="op">×</span><span class="chip num">${sizeMult.toFixed(2)}</span><span>size ${size}</span><span class="op">×</span><span class="chip num">${fmtCoins(mm)}</span><span>mutations</span>${qty > 1 ? `<span class="op">×</span><span class="chip num">${qty}</span>` : ''}</div>
    ${extra}
  </div>
  <div class="calc-note">Weather and moon mutations add together (Frozen + Amberlit is 1 + 6 + 6 − 2 = ×11), then Gold or Rainbow multiplies that. Size runs from 50 to 100; Crop Size Boost pets push crops towards 100.</div>`;
  // the price springs when it changes
  if (renderCalc.lastTotal !== undefined && renderCalc.lastTotal !== total) $('calcResult').querySelector('.calc-price b')?.classList.add('bump');
  renderCalc.lastTotal = total;
}
$('calcGrid').addEventListener('click', e => {
  const b = e.target.closest('[data-crop]'); if (!b) return;
  calc.crop = b.dataset.crop; store.set('calcCrop', calc.crop);
  $('calcGrid').querySelectorAll('.cg').forEach(x => x.classList.toggle('on', x === b));
  renderCalc();
});
$('calcMuts').addEventListener('click', e => {
  const b = e.target.closest('[data-m]'); if (!b) return;
  calc.muts[b.dataset.g] = calc.muts[b.dataset.g] === b.dataset.m ? undefined : b.dataset.m; // tap again to take it off
  store.set('calcMuts', JSON.stringify(calc.muts));
  renderCalcMuts(); renderCalc();
});
$('calcSize').value = store.get('calcSize') || 75;
$('calcSize').oninput = () => { store.set('calcSize', $('calcSize').value); renderCalc(); };
document.querySelectorAll('[data-size]').forEach(b => b.onclick = () => { $('calcSize').value = b.dataset.size; $('calcSize').oninput(); });
$('calcQty').oninput = renderCalc;
$('calcSearch').oninput = renderCalcGrid;
renderCalcMuts();
function renderCalcAll() { renderCalcGrid(); renderCalc(); }

function renderAll() { renderSummary(); renderMine(); renderPick(); renderShop(); renderCalcAll(); if (ringing.length) renderAlarm(); tick(); }

// ---------- the clock ----------
function tick() {
  const t = now();
  document.querySelectorAll('[data-until]').forEach(el => {
    const left = fmtLeft(Number(el.dataset.until) - t);
    el.textContent = left ? (el.dataset.prefix || '') + left : (Number(el.dataset.until) ? 'now' : '');
  });
  document.querySelectorAll('[data-clock]').forEach(el => {
    const start = Number(el.dataset.start), end = Number(el.dataset.end);
    el.querySelector('.t').textContent = end ? (fmtLeft(end - t) || '0:00') : '–:––';
    el.querySelector('.bar i').style.width = end > start ? Math.min(100, (t - start) / (end - start) * 100) + '%' : '0';
    el.classList.toggle('soon', end > 0 && end - t < 30000);
  });
  // how much of the weather has gone by
  document.querySelectorAll('[data-wstart]').forEach(el => {
    const s = Number(el.dataset.wstart), e = Number(el.dataset.wend);
    el.style.width = e > s ? Math.max(0, Math.min(100, (t - s) / (e - s) * 100)) + '%' : '0';
  });
}
setInterval(tick, 1000);

// ---------- sounds ----------
let audio = null;
function tone(t, f, dur, type, vol, slideTo) {
  const o = audio.createOscillator(), g = audio.createGain();
  o.type = type; o.frequency.setValueAtTime(f, t);
  if (slideTo) o.frequency.linearRampToValueAtTime(slideTo, t + dur);
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(vol, t + 0.015);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(audio.destination);
  o.start(t); o.stop(t + dur + 0.02);
}
const SOUNDS = {
  chime: { every: 1600, play(t, v) { [1047, 1319, 1568, 2093].forEach((f, i) => { tone(t + i * 0.12, f, 0.9, 'sine', v * 0.45); tone(t + i * 0.12, f * 2, 0.4, 'sine', v * 0.08); }); } },
  beep: { every: 1100, play(t, v) { [880, 1175, 880, 1175].forEach((f, i) => tone(t + i * 0.15, f, 0.13, 'square', v * 0.22)); } },
  siren: { every: 1000, play(t, v) { tone(t, 620, 0.5, 'triangle', v * 0.5, 1240); tone(t + 0.5, 1240, 0.5, 'triangle', v * 0.5, 620); } },
};
function startSound() {
  audio ||= new AudioContext();
  const snd = SOUNDS[settings.sound] || SOUNDS.chime;
  let stopped = false;
  const play = () => { if (!stopped) snd.play(audio.currentTime + 0.02, settings.volume ?? 0.7); };
  play();
  const iv = setInterval(play, snd.every);
  return () => { stopped = true; clearInterval(iv); };
}
// play the alarm sound n times, then stop by itself; returns a way to cut it short
function playTimes(n) {
  audio ||= new AudioContext();
  const snd = SOUNDS[settings.sound] || SOUNDS.chime;
  const timers = [];
  for (let i = 0; i < n; i++) timers.push(setTimeout(() => snd.play(audio.currentTime + 0.02, settings.volume ?? 0.7), i * snd.every));
  return () => timers.forEach(clearTimeout);
}
// what a level sounds like, for a moment, when it's picked
let levelPreview = null;
function previewLevel(id) {
  if (levelPreview) levelPreview();
  if (id === 'ping') levelPreview = playTimes(1);
  else if (id === 'alert') levelPreview = playTimes(3);
  else if (id === 'alarm') { const stop = startSound(); const t = setTimeout(stop, 2500); levelPreview = () => { clearTimeout(t); stop(); }; }
  else levelPreview = null;
}
function warnSound() {
  audio ||= new AudioContext();
  const t = audio.currentTime, v = settings.volume ?? 0.7;
  [0, 0.35, 0.7].forEach(d => tone(t + d, 330, 0.28, 'triangle', v * 0.4));
}

// ---------- the alarm: rings for as long as the item is in the shop ----------
let ringing = [], ringStop = null, shortSound = null, safetyTimer = null;
function stillInShop(h) {
  if (h.test) return h.deadlineMs > now();
  const s = shops?.[h.shop];
  if (!s) return true; // can't tell right now; the safety timer ends it at the restock
  if (s.restockId !== h.restockId) return false;
  return (s.items.find(i => i.key === h.key)?.stock || 0) > 0;
}
function renderAlarm() {
  const hits = [...ringing].sort((a, b) => (RANK[b.rarity] ?? -1) - (RANK[a.rarity] ?? -1));
  const top = hits[0];
  $('alarm').dataset.r = top?.rarity || 'Common';
  const art = uiTex[TOAST_ART[top?.shop] || 'ToastIllustrationAllShops'];
  $('alarm').style.setProperty('--ab-pic', art?.src ? `url("${art.src}")` : 'none');
  const lvl = strongest(ringing);
  $('alarm').dataset.level = lvl;
  $('stop').textContent = lvl === 'alarm' || lvl === 'alert' ? 'Stop alarm' : 'Dismiss';
  $('alarmList').innerHTML = hits.map(h => `<div class="hit" data-r="${esc(h.rarity || 'Common')}">
    <span class="pic">${pic(h.key, h.type)}</span>
    <div class="info"><div class="nm">${esc(h.name)}</div><div class="sub"><span class="rar">${esc(h.rarity || '')}</span> · ${esc(shopName(h.shop))}</div></div>
    <span class="q num">×${h.stock}</span>${h.test ? '' : buyBtn(h.key)}</div>`).join('');
  const end = Math.max(...hits.map(h => h.deadlineMs || 0));
  $('autoStop').innerHTML = end ? `<span class="num" data-until="${end}" data-prefix="gone in "></span>` : '';
  tick();
}
// the sound follows the loudest item showing: an Alarm item loops until it's gone; quieter ones
// play once (Ping) or three times (Alert) when they arrive; Silent ones make no sound
function updateSound(fresh = []) {
  if (strongest(ringing) === 'alarm') { if (!ringStop) ringStop = startSound(); return; }
  if (ringStop) { ringStop(); ringStop = null; }
  const arrival = fresh.length ? strongest(fresh) : 'silent';
  if (arrival === 'alert' || arrival === 'ping') {
    if (shortSound) shortSound();
    shortSound = playTimes(arrival === 'alert' ? 3 : 1);
  }
}
function ring(hits) {
  const fresh = hits.filter(h => !ringing.some(r => r.key === h.key && r.restockId === h.restockId))
    .map(h => ({ ...h, level: h.level || levelOf(h.key) }));
  ringing.push(...fresh);
  renderAlarm();
  $('alarm').classList.add('show');
  updateSound(fresh);
  // in case the shop can't be seen (connection lost), stop when the last item's restock comes round anyway
  clearTimeout(safetyTimer);
  const end = Math.max(...ringing.map(h => h.deadlineMs || 0));
  safetyTimer = setTimeout(stopRing, end > now() ? end - now() + 3000 : 10 * 60000);
}
function checkRinging() {
  if (!ringing.length) return;
  const before = ringing.length;
  ringing = ringing.filter(stillInShop);
  if (!ringing.length) stopRing();
  else if (ringing.length !== before) { renderAlarm(); updateSound(); } // an Alarm item that left stops the loop
  else renderAlarm();
}
setInterval(checkRinging, 1000);
function stopRing() {
  if (ringStop) ringStop();
  if (shortSound) shortSound();
  ringStop = null; shortSound = null; ringing = [];
  clearTimeout(safetyTimer);
  $('alarm').classList.remove('show');
  mg.stopFlash();
}
$('stop').onclick = stopRing;
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') { if ($('alarm').classList.contains('show')) stopRing(); else closeSettings(); }
});

// ---------- settings ----------
function openSettings() { $('settings').classList.add('show'); $('scrim').classList.add('show'); }
function closeSettings() { $('settings').classList.remove('show'); $('scrim').classList.remove('show'); }
$('openSettings').onclick = openSettings;
$('closeSettings').onclick = closeSettings;
$('scrim').onclick = closeSettings;
function showSettings() {
  $('volume').value = settings.volume; $('volumeVal').textContent = Math.round(settings.volume * 100) + '%';
  $('notify').checked = settings.notify;
  $('popup').checked = settings.popup !== false;
  $('trayOpt').checked = settings.tray !== false;
  $('startup').checked = !!settings.startup;
  $('soundOpts').querySelectorAll('button').forEach(b => b.classList.toggle('active', b.dataset.sound === settings.sound));
  $('defaultLevel').innerHTML = LEVEL_ORDER.map(id => `<button data-dl="${id}" title="${LEVELS[id].desc}"${id === (settings.defaultLevel || 'alarm') ? ' class="active"' : ''}>${LEVELS[id].name}</button>`).join('');
}
$('defaultLevel').onclick = e => {
  const id = e.target.closest('[data-dl]')?.dataset.dl; if (!id) return;
  settings.defaultLevel = id; mg.set('defaultLevel', id); showSettings(); renderMine();
};
$('volume').oninput = e => { settings.volume = Number(e.target.value); mg.set('volume', settings.volume); showSettings(); };
$('notify').onchange = e => { settings.notify = e.target.checked; mg.set('notify', settings.notify); };
// ---------- light / dark / auto (follows Windows) ----------
const darkQuery = matchMedia('(prefers-color-scheme: dark)');
function applyTheme() {
  const t = store.get('theme') || 'auto';
  document.documentElement.dataset.theme = t === 'dark' || (t === 'auto' && darkQuery.matches) ? 'dark' : 'light';
  $('themeOpts').querySelectorAll('button').forEach(b => b.classList.toggle('active', b.dataset.themePick === t));
}
$('themeOpts').onclick = e => { const b = e.target.closest('[data-theme-pick]'); if (!b) return; store.set('theme', b.dataset.themePick); applyTheme(); };
darkQuery.addEventListener('change', applyTheme);
applyTheme();
$('popup').onchange =e => { settings.popup = e.target.checked; mg.set('popup', settings.popup); };
$('trayOpt').onchange = e => { settings.tray = e.target.checked; mg.set('tray', settings.tray); };
$('startup').onchange = e => { settings.startup = e.target.checked; mg.set('startup', settings.startup); };
let preview = null;
$('soundOpts').onclick = e => {
  const b = e.target.closest('[data-sound]'); if (!b) return;
  settings.sound = b.dataset.sound; mg.set('sound', settings.sound); showSettings();
  if (preview) preview();
  const stop = startSound(); preview = stop; setTimeout(() => { stop(); if (preview === stop) preview = null; }, 1400);
};
$('test').onclick = () => {
  closeSettings();
  ring([{ test: true, key: 'Seed:Starweaver', name: 'Starweaver Pod', stock: 1, shop: 'seed', type: 'Seed', rarity: 'Celestial', restockId: 'test', deadlineMs: now() + 10000, level: 'alarm' }]);
};

// ---------- the game, always shown on the left ----------
// (setPlaying is kept so older calls still work; the game is never hidden now)
function setPlaying() {
  document.body.classList.add('playing');
  if (!$('gameArea').firstChild) {
    const wv = document.createElement('webview');
    wv.setAttribute('partition', 'persist:mg-player');
    wv.setAttribute('allowpopups', '');
    wv.setAttribute('webpreferences', 'backgroundThrottling=no');
    wv.src = 'https://magicgarden.gg';
    $('gameArea').appendChild(wv);
  }
}
if (!IS_EXT && !IS_WEB) setPlaying(); // only the desktop app shows the game
// the header's game button: in the app it reloads the game (handy if it gets stuck after an update);
// in the extension it takes you to your Magic Garden tab (or opens one)
$('play').onclick = () => IS_EXT ? mg.focusGame() : document.querySelector('#gameArea webview')?.reload();
if (IS_EXT) $('play').title = 'Go to your Magic Garden tab';

// ---------- buying from the side ----------
// Buy buttons buy through your game on the left, the same way its own Buy button does. One item per press.
const BUY_SAYS = {
  nogame: IS_EXT ? 'Open Magic Garden in a tab first.' : 'The game is still loading.',notsent: 'Join your garden in the game first, then try again.',
  rejected: "The game said no: not enough coins, it's sold out, or you've hit the limit.", timeout: 'No answer from the game. Check your coins and try again.',
  nosender: "Couldn't find the game's Buy button. The game may have updated.", error: 'Something went wrong talking to the game.', baditem: "That item can't be bought here.",
};
let toastTimer = null;
function toast(html, kind = '') {
  let t = $('toast');
  if (!t) { t = document.createElement('div'); t.id = 'toast'; $('shell').appendChild(t); }
  t.className = 'show ' + kind; t.innerHTML = html;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('show'), 3200);
}
function shopOf(key) { for (const [name, s] of Object.entries(shops || {})) if (s.items.some(i => i.key === key && i.stock > 0)) return name; return null; }
async function buy(key, btn) {
  const shop = shopOf(key), name = byKey[key]?.name || key.split(':')[1];
  if (!shop) { toast(`<b>${esc(name)}</b> isn't in the shop right now.`, 'bad'); return; }
  if (btn) { btn.classList.add('busy'); btn.disabled = true; }
  const r = await mg.buy(key, shop).catch(() => ({ ok: false, reason: 'error' }));
  if (btn) { btn.classList.remove('busy'); btn.disabled = false; btn.classList.toggle('done', !!r?.ok); if (r?.ok) setTimeout(() => btn.classList.remove('done'), 1200); }
  if (r?.ok) toast(`${icons[key] ? `<img src="${icons[key]}" alt="">` : '🛒'}<span>Bought <b>${esc(name)}</b>!</span>`, 'good');
  else toast(`<span>${esc(BUY_SAYS[r?.reason] || BUY_SAYS.error)}</span>`, 'bad');
}
const buyBtn = key => `<button class="buy" data-buy="${esc(key)}" title="Buy one in your game"><i class="coin"></i>Buy</button>`;
document.addEventListener('click', e => {
  const b = e.target.closest('[data-buy]'); if (!b) return;
  e.stopPropagation(); e.preventDefault();
  buy(b.dataset.buy, b);
}, true);

// ---------- the main on/off switch ----------
function showPower() {
  const on = settings.enabled !== false;
  $('power').classList.toggle('off', !on);
  $('power').querySelector('.pl').textContent = on ? 'On' : 'Off';
  $('power').title = on ? 'Alarms are on. Click to turn them off' : 'Alarms are off. Click to turn them on';
  $('offNote').classList.toggle('show', !on);
}
function setEnabled(on) {
  settings.enabled = on;
  mg.set('enabled', on);
  if (!on) stopRing();
  showPower();
}
$('power').onclick = () => setEnabled(settings.enabled === false);
$('turnOn').onclick = () => setEnabled(true);

// ---------- connection status ----------
let offlineSince = null, wasWarned = false;
function setStatus(s) {
  const on = s.connected;
  offlineSince = on ? null : s.offlineSince;
  $('status').className = 'status' + (on ? ' live' : '');
  $('status').innerHTML = `<span class="dot"></span>${on ? 'Live' : 'Connecting…'}` + (on ? '' : ' <button id="reconnect" title="Start the connection to the game again">Retry</button>');
  if (!on) $('reconnect').onclick = () => mg.reconnect();
  const warned = !on && s.warned;
  $('offline').classList.toggle('show', warned);
  if (warned && !wasWarned && settings.enabled !== false) warnSound();
  wasWarned = warned;
  tickOffline();
}
function tickOffline() {
  if (!offlineSince) return;
  const m = Math.max(1, Math.floor((Date.now() - offlineSince) / 60000));
  $('offlineFor').textContent = `${m} minute${m === 1 ? '' : 's'}`;
}
setInterval(tickOffline, 10000);

// ---------- wiring ----------
function setCatalog(c) { catalog = c; byKey = Object.fromEntries(c.map(i => [i.key, i])); }
function takeShops(d) {
  shops = d.shops;
  weather = d.weather || null;
  if (d.seen) seen = d.seen;
  if (d.serverNow) clockOffset = d.serverNow - Date.now();
  checkRinging();
  renderAll();
}
mg.on('shops', takeShops);
mg.on('alarm', hits => ring(hits.map(h => ({ ...h, type: h.type || byKey[h.key]?.type }))));
mg.on('status', setStatus);
mg.on('catalog', c => { setCatalog(c); renderAll(); });
mg.on('icons', i => { icons = i || {}; renderAll(); });
mg.on('prices', p => { prices = p || {}; renderShop(); renderCalc(); tick(); });
mg.on('crops', c => { crops = c || {}; renderCalcAll(); });
mg.on('wxart', a => { wxart = a || {}; lastWeatherKey = ''; renderWeather(); });
// the game's UI textures, as CSS variables the shop look uses (--ui-ShopShelfPlank, --ui-InventoryModal-slice, ...)
var uiTex = {}; // var: renderSummary may run before this line
function applyUi(u) {
  uiTex = u || {};
  const st = document.documentElement.style;
  for (const [n, x] of Object.entries(uiTex)) {
    if (!x?.src) continue;
    st.setProperty(`--ui-${n}`, `url("${x.src}")`);
    if (x.slice) st.setProperty(`--ui-${n}-slice`, `${x.slice.t || 1} ${x.slice.r || 1} ${x.slice.b || 1} ${x.slice.l || 1}`);
  }
  document.body.classList.toggle('has-ui', !!uiTex.ShopShelfPlank);
  renderSummary(); if (ringing.length) renderAlarm();
}
mg.on('ui', applyUi);
mg.on('enabled', on => { settings.enabled = on; if (!on) stopRing(); showPower(); }); // switched from the tray

mg.get().then(d => {
  setCatalog(d.catalog); watched = new Set(d.watched); settings = d.settings; icons = d.icons || {}; prices = d.prices || {}; levels = d.levels || {}; crops = d.crops || {}; seen = d.seen || {}; wxart = d.wxart || {}; applyUi(d.ui);
  showSettings();
  showPower();
  setStatus(d);
  if (d.shops) takeShops(d); else renderAll();
});
