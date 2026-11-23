// Magic Garden Shop Alarm: the extension's core, running alongside your Magic Garden tab.
// It gets the game's incoming messages from page.js, keeps the room's state up to date, works out what each
// shop has, checks your alarms (and asks the background for a Windows notification), remembers when items were
// last in the shop, and answers the side panel. Settings live in chrome.storage.local, shared with the panel.
// The same logic as the desktop app's main.js (the "hidden watcher" isn't needed: it reads your own game).
(() => {
  const { STARTER, RARITY, WEATHER_SHOP } = globalThis.MGA_CATALOG;
  const DEFAULTS = { watched: [], catalog: {}, volume: 0.7, notify: true, sound: 'chime', levels: {}, defaultLevel: 'alarm', enabled: true, seen: {} };
  let settings = { ...DEFAULTS };
  let iconCache = {};
  const levelOf = key => settings.levels[key] || settings.defaultLevel || 'alarm';

  // ---- talking to the panel, the background and the page ----
  const toPanel = (ch, data) => chrome.runtime.sendMessage({ to: 'panel', ch, data }).catch(() => {});
  const toBg = msg => chrome.runtime.sendMessage({ to: 'bg', ...msg }).catch(() => {});
  let reqId = 0;
  const waiting = new Map();
  function askPage(type, extra = {}, timeoutMs = 60000) {
    const id = ++reqId;
    return new Promise(resolve => {
      waiting.set(id, resolve);
      setTimeout(() => { if (waiting.delete(id)) resolve(null); }, timeoutMs);
      window.postMessage({ source: 'mga-content', type, id, ...extra }, location.origin);
    });
  }

  // ---- settings (shared with the panel through storage) ----
  let saveTimer = null;
  function save() { clearTimeout(saveTimer); saveTimer = setTimeout(() => chrome.storage.local.set({ settings }), 300); }
  function seedCatalog() {
    let order = 0;
    for (const [shop, list] of Object.entries(STARTER)) for (const entry of list.split('|')) {
      const [key, name] = entry.split('='), [type, id] = key.split(':');
      settings.catalog[key] = { ...settings.catalog[key], shop, type, id, name, order: order++ };
    }
  }
  const ready = chrome.storage.local.get(['settings', 'iconCache']).then(s => {
    settings = { ...DEFAULTS, ...(s.settings || {}) };
    iconCache = s.iconCache || {};
    seedCatalog();
  });
  chrome.storage.onChanged.addListener((ch, area) => {
    if (area !== 'local' || !ch.settings?.newValue) return;
    const before = new Set(settings.watched);
    settings = { ...DEFAULTS, ...ch.settings.newValue };
    // ticking an item that's already in the shop doesn't ring for it
    for (const k of settings.watched) if (!before.has(k)) markCurrentAlerted(k);
  });

  // ---- the room's state, from the game's messages ----
  let room = null, connected = false, lastShopsJson = '', lastGoodAt = Date.now(), offlineWarned = false;
  const alerted = new Set();
  const WARN_AFTER_MS = 5 * 60000;
  const itemId = it => it.species ?? it.toolId ?? it.eggId ?? it.decorId ?? it.petSpecies ?? it.id ?? '?';
  const itemKey = it => `${it.itemType}:${itemId(it)}`;
  const pretty = s => String(s).replace(/([a-z])([A-Z])/g, '$1 $2').replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2');

  function applyPatches(doc, patches) {
    for (const p of patches) {
      const parts = p.path === '' ? [] : p.path.split('/').slice(1).map(s => s.replace(/~1/g, '/').replace(/~0/g, '~'));
      if (parts.length === 0) { if (p.op === 'replace' || p.op === 'add') doc = p.value; continue; }
      const value = p.op === 'copy' || p.op === 'move' ? getAt(doc, p.from) : p.value;
      if (p.op === 'move') applyPatches(doc, [{ op: 'remove', path: p.from }]);
      if (p.op === 'test') continue;
      const last = parts.pop();
      const parent = parts.reduce((o, k) => (o == null ? o : o[k]), doc);
      if (parent == null) throw new Error('missing parent ' + p.path);
      if (p.op === 'remove') { if (Array.isArray(parent)) parent.splice(Number(last), 1); else delete parent[last]; }
      else if (p.op === 'add' || p.op === 'copy' || p.op === 'move') { if (Array.isArray(parent)) parent.splice(last === '-' ? parent.length : Number(last), 0, value); else parent[last] = value; }
      else if (p.op === 'replace') parent[last] = value;
    }
    return doc;
  }
  const getAt = (doc, ptr) => ptr.split('/').slice(1).map(s => s.replace(/~1/g, '/').replace(/~0/g, '~')).reduce((o, k) => o?.[k], doc);

  function onFrame(text) {
    let msg; try { msg = JSON.parse(text); } catch { return; }
    if (msg.type === 'Welcome' && msg.fullState) room = msg.fullState;
    else if (room && msg.state?.patches) { try { room = applyPatches(room, msg.state.patches); } catch { room = null; setConnected(false); return; } }
    else return;
    if (!room?.child?.data?.shops) { setConnected(false); return; }
    lastGoodAt = Date.now();
    setConnected(true);
    shopsMaybeChanged();
    if (msg.type === 'Welcome') setTimeout(refreshIcons, 6000);
  }

  function currentShops() {
    const shops = room?.child?.data?.shops;
    if (!shops) return null;
    const out = {};
    for (const [name, s] of Object.entries(shops)) out[name] = {
      restockId: s.restockId, startedAtMs: s.startedAtMs, deadlineMs: s.deadlineMs,
      items: (s.inventory || []).map(it => { const key = itemKey(it); return { key, name: settings.catalog[key]?.name || pretty(itemId(it)), type: it.itemType, rarity: RARITY[key] || null, stock: it.initialStock ?? 0 }; }),
    };
    return out;
  }
  function currentWeather() {
    const d = room?.child?.data;
    if (!d) return null;
    const tag = w => (w ? { weather: w, shop: WEATHER_SHOP[w] || null } : {});
    return {
      now: d.weather ? { ...tag(d.weather), startsAtMs: d.weatherWindow?.startsAtMs ?? null, endsAtMs: d.weatherWindow?.endsAtMs ?? null } : null,
      forecast: (d.weatherForecast || []).map(f => ({ ...tag(f.weatherId), group: f.groupId, startsAtMs: f.startsAtMs, endsAtMs: f.endsAtMs })),
    };
  }
  const shopsPayload = () => ({ shops: currentShops(), weather: currentWeather(), seen: settings.seen, serverNow: room?.child?.data?.currentTime ?? Date.now(), at: Date.now() });

  function shopsMaybeChanged() {
    const shops = currentShops(); if (!shops) return;
    const json = JSON.stringify([shops, currentWeather()]);
    if (json === lastShopsJson) return;
    lastShopsJson = json;
    let changed = false;
    // remember every item the game lists, and when each was last in the shop
    for (const [shop, s] of Object.entries(shops)) s.items.forEach((it, i) => {
      if (!settings.catalog[it.key]) { settings.catalog[it.key] = { shop, type: it.type, id: it.key.split(':')[1], name: it.name, order: 1000 + i }; changed = true; }
      if (it.stock > 0) { const prev = settings.seen[it.key]; if (prev?.r !== s.restockId) { settings.seen[it.key] = { at: s.startedAtMs || Date.now(), n: (prev?.n || 0) + 1, r: s.restockId }; changed = true; } }
    });
    if (changed) save();
    toPanel('shops', shopsPayload());
    checkAlarms(shops);
  }

  function checkAlarms(shops) {
    const watched = new Set(settings.watched), hits = [];
    for (const [shop, s] of Object.entries(shops)) for (const it of s.items) {
      if (it.stock <= 0 || !watched.has(it.key)) continue;
      const tag = `${s.restockId}|${it.key}`;
      if (alerted.has(tag)) continue;
      alerted.add(tag);
      hits.push({ ...it, shop, restockId: s.restockId, deadlineMs: s.deadlineMs, level: levelOf(it.key) });
    }
    if (!hits.length || settings.enabled === false) return;
    toPanel('alarm', hits);
    if (settings.notify !== false && hits.some(h => h.level !== 'silent'))
      toBg({ type: 'notify', title: 'In the shop now!', body: hits.map(h => `${h.name} ×${h.stock}`).join(', '), sticky: hits.some(h => h.level === 'alarm') });
  }
  function markCurrentAlerted(key) {
    const shops = currentShops(); if (!shops) return;
    for (const s of Object.values(shops)) for (const it of s.items) if (it.key === key && it.stock > 0) alerted.add(`${s.restockId}|${key}`);
  }

  let pausedNotified = false;
  function setConnected(on) {
    if (on) pausedNotified = false;
    if (on && offlineWarned) offlineWarned = false;
    if (connected === on) return;
    connected = on;
    toPanel('status', { connected, offlineSince: on ? null : lastGoodAt, warned: offlineWarned });
  }
  setInterval(() => {
    if (offlineWarned || Date.now() - lastGoodAt < WARN_AFTER_MS) return;
    offlineWarned = true;
    toPanel('status', { connected: false, offlineSince: lastGoodAt, warned: true });
    if (settings.enabled !== false && settings.notify !== false) toBg({ type: 'notify', title: 'Shop Alarm can’t see the shop', body: 'It hasn’t been able to read the shop for a few minutes. The game may be updating.' });
  }, 5000);

  // ---- item pictures, prices, crops, weather art, textures: read from the game, kept per game version ----
  let iconsBusy = false;
  async function refreshIcons() {
    if (iconsBusy) return;
    iconsBusy = true;
    try {
      const version = await askPage('version', {}, 5000);
      if (version && version === iconCache.version && iconCache.ui?.ShopShelfPlank && iconCache.crops) return;
      const res = await askPage('extract', {}, 120000);
      if (res && res.icons && Object.keys(res.icons).length) {
        iconCache = { version: res.version, icons: res.icons, missing: res.missing, prices: res.prices || {}, crops: res.crops || {}, weatherArt: res.weather || {}, ui: res.ui || {} };
        await chrome.storage.local.set({ iconCache });
        toPanel('icons', iconCache.icons); toPanel('prices', iconCache.prices); toPanel('crops', iconCache.crops);
        toPanel('wxart', iconCache.weatherArt); toPanel('ui', iconCache.ui);
      }
    } finally { iconsBusy = false; }
  }

  // ---- messages from page.js ----
  window.addEventListener('message', e => {
    const m = e.data;
    if (e.source !== window || m?.source !== 'mga-page') return;
    if (m.type === 'frame') ready.then(() => onFrame(m.data));
    else if (m.type === 'closed') {
      setConnected(false);
      // Magic Garden stops answering its server while its tab is in the background (on purpose), so the server
      // disconnects it and it reconnects when you come back. Say so straight away, since alarms pause meanwhile.
      if (document.hidden && settings.enabled !== false && !pausedNotified) {
        pausedNotified = true;
        toBg({ type: 'notify', title: 'Shop Alarm is paused', body: 'Magic Garden disconnects when its tab is in the background. Click to go back to it and the alarms carry on.' });
      }
    }
    else if (m.type === 'reply' && waiting.has(m.id)) { waiting.get(m.id)(m.result); waiting.delete(m.id); }
  });

  // ---- requests from the side panel ----
  chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
    if (msg?.to !== 'game') return;
    if (msg.type === 'live') { reply({ ...shopsPayload(), connected, offlineSince: connected ? null : lastGoodAt, warned: offlineWarned }); return; }
    if (msg.type === 'buy') {
      const [type, id] = String(msg.key).split(':');
      const field = { Seed: 'species', Egg: 'eggId', Tool: 'toolId', Decor: 'decorId' }[type];
      if (!field || !id) { reply({ ok: false, reason: 'baditem' }); return; }
      askPage('buy', { shop: msg.shop, item: { itemType: type, [field]: id } }, 15000).then(r => reply(r || { ok: false, reason: 'timeout' }));
      return true;
    }
    if (msg.type === 'reconnect') { location.reload(); reply(true); return; }
  });
})();
