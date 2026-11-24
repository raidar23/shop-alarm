// Magic Garden Shop Alarm, website version: gives the panel the same `mg` interface the desktop app's
// preload.js does, backed by the website's server instead. The server watches the shop (one watcher for
// everyone) and streams it here; everything personal (your alarms, levels, sound, volume) is kept in this
// browser only, and the alarms are checked right here. There's no game and no buying on the website.
(() => {
  const { RARITY } = globalThis.MGA_CATALOG;
  const KEY = 'mga-settings';
  const DEFAULTS = { watched: [], volume: 0.7, notify: true, sound: 'chime', levels: {}, defaultLevel: 'alarm', enabled: true };
  const LEVELS = ['silent', 'ping', 'alert', 'alarm'];
  const load = () => { try { return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) || '{}') }; } catch { return { ...DEFAULTS }; } };
  const save = s => { try { localStorage.setItem(KEY, JSON.stringify(s)); } catch {} };
  const levelOf = (s, key) => s.levels[key] || s.defaultLevel || 'alarm';

  // Where the server is. Served by the server itself, that's right here. Served from GitHub Pages (a fixed
  // address), backend.json next to the page says where the server is right now (the spare PC updates it).
  let API = '';
  async function findServer() {
    try {
      const b = await fetch('backend.json', { cache: 'no-store' }).then(r => (r.ok ? r.json() : null));
      if (b?.api) API = b.api.endsWith('/') ? b.api : b.api + '/';
    } catch {}
  }
  // if the server moves while the page is open (the spare PC restarted), look it up again
  setInterval(async () => { const before = API; await findServer(); if (API !== before) location.reload(); }, 120000);

  const handlers = {};
  const emit = (ch, data) => (handlers[ch] || []).forEach(cb => { try { cb(data); } catch (e) { console.error(e); } });

  // ---- alarms, checked in this browser ----
  const alerted = new Set(); // "restockId|item" already rung for
  let lastShops = null, primed = false;
  function checkAlarms(shops) {
    const s = load(), watched = new Set(s.watched), hits = [];
    for (const [shop, sh] of Object.entries(shops || {})) for (const it of sh.items) {
      if (it.stock <= 0 || !watched.has(it.key)) continue;
      const tag = `${sh.restockId}|${it.key}`;
      if (alerted.has(tag)) continue;
      alerted.add(tag);
      hits.push({ ...it, shop, restockId: sh.restockId, deadlineMs: sh.deadlineMs, level: levelOf(s, it.key) });
    }
    if (!primed) { primed = true; } // what's already in the shop when you open the page still shows, below
    if (!hits.length || s.enabled === false) return;
    emit('alarm', hits);
    if (s.notify !== false && 'Notification' in window && Notification.permission === 'granted' && hits.some(h => h.level !== 'silent')) {
      try { const n = new Notification('In the shop now!', { body: hits.map(h => `${h.name} ×${h.stock}`).join(', '), icon: 'icons/icon128.png', requireInteraction: hits.some(h => h.level === 'alarm'), tag: 'mga' }); n.onclick = () => { window.focus(); n.close(); }; } catch {}
    }
  }
  function markCurrent(key) {
    for (const sh of Object.values(lastShops || {})) for (const it of sh.items) if (it.key === key && it.stock > 0) alerted.add(`${sh.restockId}|${key}`);
  }

  // ---- the live feed from the server ----
  // Two ways at once: a live stream (instant, but some tunnels and proxies hold it back) and a small check
  // every few seconds (always gets through). Whichever brings a change first, the page updates once.
  let lastKey = '', lastConnected = null, catalogCount = 0, bootedWithData = false;
  function takeShops(d) {
    const key = JSON.stringify([d.shops, d.weather]);
    if (key === lastKey) return;
    lastKey = key; lastShops = d.shops;
    emit('shops', d); checkAlarms(d.shops);
  }
  function takeStatus(d) {
    if (d.connected === lastConnected && !d.warned) return;
    lastConnected = d.connected;
    emit('status', { connected: !!d.connected, offlineSince: d.offlineSince ?? Date.now(), warned: !!d.warned });
  }
  async function poll() {
    try {
      const d = await fetch(API + 'api/live', { cache: 'no-store' }).then(r => r.json());
      // the page opened before the server could be reached (e.g. right after it restarted): start over now it can
      if (!bootedWithData && d.shops) { location.reload(); return; }
      takeStatus(d);
      if (d.shops) takeShops(d);
      if (d.assetsVersion && d.assetsVersion !== assetsVersion) loadAssets(true);
      if (d.catalogCount && d.catalogCount !== catalogCount) {
        catalogCount = d.catalogCount;
        const s = await fetch(API + 'api/state', { cache: 'no-store' }).then(r => r.json());
        emit('catalog', (s.catalog || []).map(c => ({ ...c, rarity: c.rarity || RARITY[c.key] || null })));
      }
    } catch { takeStatus({ connected: false, offlineSince: Date.now() }); }
  }
  function listen() {
    try {
      const es = new EventSource(API + 'api/events');
      es.addEventListener('shops', e => takeShops(JSON.parse(e.data)));
      es.addEventListener('status', e => takeStatus(JSON.parse(e.data)));
      es.addEventListener('assets', () => loadAssets(true));
    } catch {}
    setInterval(poll, 4000);
  }
  let assetsVersion = null;
  async function loadAssets(force) {
    const a = await fetch(API + 'api/assets', { cache: force ? 'reload' : 'default' }).then(r => r.json()).catch(() => null);
    if (!a || (a.version === assetsVersion && !force)) return a;
    assetsVersion = a.version;
    if (force) { emit('icons', a.icons); emit('prices', a.prices); emit('crops', a.crops); emit('wxart', a.wxart); emit('ui', a.ui); }
    return a;
  }

  // ---- "turn on sound and pop-ups": browsers only allow them after you click once ----
  addEventListener('DOMContentLoaded', () => {
    const bar = document.getElementById('enableNotes'), btn = document.getElementById('enableNotesBtn');
    if (!bar || !btn) return;
    const done = () => ('Notification' in window ? Notification.permission !== 'default' : true) && sessionStorage.getItem('mga-unlocked');
    if (done()) bar.classList.add('hide');
    btn.onclick = async () => {
      try { const c = new AudioContext(); await c.resume(); c.close(); } catch {}
      try { if ('Notification' in window && Notification.permission === 'default') await Notification.requestPermission(); } catch {}
      try { sessionStorage.setItem('mga-unlocked', '1'); } catch {}
      bar.classList.add('hide');
    };
  });

  window.mg = {
    platform: 'web',
    async get() {
      await findServer();
      const s = load();
      const [state, assets] = await Promise.all([fetch(API + 'api/state').then(r => r.json()).catch(() => ({})), loadAssets(false)]);
      lastShops = state.shops || null;
      bootedWithData = !!state.shops; // (pictures that arrive later come in through the regular checks)
      // if it's not reachable yet, the regular checks (listen, below) keep trying, and reload once it answers
      lastKey =JSON.stringify([state.shops, state.weather]); lastConnected = !!state.connected; catalogCount = (state.catalog || []).length;
      // what's in the shop when you open the page doesn't ring (it still shows as "in the shop")
      for (const k of s.watched) markCurrent(k);
      setTimeout(listen, 0);
      return {
        settings: { volume: s.volume, notify: s.notify, sound: s.sound, defaultLevel: s.defaultLevel, enabled: s.enabled !== false },
        levels: s.levels, watched: s.watched,
        catalog: (state.catalog || []).map(c => ({ ...c, rarity: c.rarity || RARITY[c.key] || null })), seen: state.seen || {},
        shops: state.shops || null, weather: state.weather || null, serverNow: state.serverNow || Date.now(),
        connected: !!state.connected, offlineSince: state.offlineSince ?? Date.now(), warned: !!state.warned,
        icons: assets?.icons || {}, prices: assets?.prices || {}, crops: assets?.crops || {}, wxart: assets?.wxart || {}, ui: assets?.ui || {},
      };
    },
    async watch(key, on) {
      const s = load(), set = new Set(s.watched);
      if (on) { set.add(key); markCurrent(key); } else { set.delete(key); const { [key]: _gone, ...rest } = s.levels; s.levels = rest; }
      s.watched = [...set]; save(s);
      return s.watched;
    },
    async set(name, value) {
      const s = load();
      if (name === 'volume') s.volume = Math.min(1, Math.max(0, Number(value) || 0));
      if (name === 'notify') { s.notify = !!value; if (value && 'Notification' in window && Notification.permission === 'default') Notification.requestPermission().catch(() => {}); }
      if (name === 'sound' && ['chime', 'beep', 'siren'].includes(value)) s.sound = value;
      if (name === 'defaultLevel' && LEVELS.includes(value)) s.defaultLevel = value;
      if (name === 'enabled') s.enabled = !!value;
      save(s);
    },
    async setLevel(key, level) {
      const s = load();
      if (LEVELS.includes(level) && typeof key === 'string') { s.levels = { ...s.levels, [key]: level }; save(s); }
      return s.levels;
    },
    async buy() { return { ok: false, reason: 'baditem' }; }, // no buying on the website
    async reconnect() { location.reload(); },
    focusGame: () => {},
    stopFlash: async () => {},
    setPlaying: async () => {},
    on(ch, cb) { (handlers[ch] ||= []).push(cb); },
  };
})();
