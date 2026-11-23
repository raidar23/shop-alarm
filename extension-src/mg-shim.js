// Magic Garden Shop Alarm: gives the side panel the same `mg` interface the desktop app's preload.js does,
// backed by the extension instead: settings in chrome.storage.local, live shop data from the content script
// in your Magic Garden tab, and notifications through the background worker.
(() => {
  const { STARTER, RARITY } = globalThis.MGA_CATALOG;
  const DEFAULTS = { watched: [], catalog: {}, volume: 0.7, notify: true, sound: 'chime', levels: {}, defaultLevel: 'alarm', enabled: true, seen: {} };
  const LEVELS = ['silent', 'ping', 'alert', 'alarm'];
  const pretty = s => String(s).replace(/([a-z])([A-Z])/g, '$1 $2').replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2');

  async function loadSettings() {
    const s = (await chrome.storage.local.get('settings')).settings || {};
    const settings = { ...DEFAULTS, ...s, catalog: { ...(s.catalog || {}) } };
    let order = 0;
    for (const [shop, list] of Object.entries(STARTER)) for (const entry of list.split('|')) {
      const [key, name] = entry.split('='), [type, id] = key.split(':');
      settings.catalog[key] = { ...settings.catalog[key], shop, type, id, name, order: order++ };
    }
    return settings;
  }
  const saveSettings = settings => chrome.storage.local.set({ settings });
  const catalogList = catalog => Object.entries(catalog)
    .map(([key, c]) => ({ key, shop: c.shop, type: c.type, name: c.name || pretty(c.id), rarity: RARITY[key] || null, order: c.order ?? 9999 }))
    .sort((a, b) => a.order - b.order);

  const bg = msg => chrome.runtime.sendMessage({ to: 'bg', ...msg }).catch(() => null);
  async function toGame(msg) {
    const tabId = await bg({ type: 'gameTab' });
    if (!tabId) return undefined;
    return chrome.tabs.sendMessage(tabId, { to: 'game', ...msg }).catch(() => undefined);
  }

  // events from the content script
  const handlers = {};
  chrome.runtime.onMessage.addListener(msg => { if (msg?.to === 'panel') (handlers[msg.ch] || []).forEach(cb => cb(msg.data)); });
  // new items the game listed show up in "All items"
  let catalogSize = 0;
  chrome.storage.onChanged.addListener(async (ch, area) => {
    if (area !== 'local' || !ch.settings) return;
    const n = Object.keys(ch.settings.newValue?.catalog || {}).length;
    if (n !== catalogSize) { catalogSize = n; const s = await loadSettings(); (handlers.catalog || []).forEach(cb => cb(catalogList(s.catalog))); }
  });

  window.mg = {
    platform: 'extension',
    async get() {
      const settings = await loadSettings();
      catalogSize = Object.keys(settings.catalog).length;
      const icons = (await chrome.storage.local.get('iconCache')).iconCache || {};
      const live = await toGame({ type: 'live' });
      return {
        settings: { volume: settings.volume, notify: settings.notify, sound: settings.sound, defaultLevel: settings.defaultLevel, enabled: settings.enabled !== false },
        levels: settings.levels, watched: settings.watched, catalog: catalogList(settings.catalog), seen: settings.seen,
        shops: live?.shops || null, weather: live?.weather || null, serverNow: live?.serverNow || Date.now(),
        connected: !!live?.connected, offlineSince: live ? live.offlineSince : Date.now(), warned: !!live?.warned,
        icons: icons.icons || {}, prices: icons.prices || {}, crops: icons.crops || {}, wxart: icons.weatherArt || {}, ui: icons.ui || {},
      };
    },
    async watch(key, on) {
      const s = await loadSettings();
      const set = new Set(s.watched);
      if (on) set.add(key); else { set.delete(key); const { [key]: _gone, ...rest } = s.levels; s.levels = rest; }
      s.watched = [...set];
      await saveSettings(s);
      return s.watched;
    },
    async set(name, value) {
      const s = await loadSettings();
      if (name === 'volume') s.volume = Math.min(1, Math.max(0, Number(value) || 0));
      if (name === 'notify') s.notify = !!value;
      if (name === 'sound' && ['chime', 'beep', 'siren'].includes(value)) s.sound = value;
      if (name === 'defaultLevel' && LEVELS.includes(value)) s.defaultLevel = value;
      if (name === 'enabled') s.enabled = !!value;
      await saveSettings(s);
    },
    async setLevel(key, level) {
      const s = await loadSettings();
      if (LEVELS.includes(level) && typeof key === 'string') { s.levels = { ...s.levels, [key]: level }; await saveSettings(s); }
      return s.levels;
    },
    async buy(key, shop) {
      const r = await toGame({ type: 'buy', key, shop });
      return r === undefined ? { ok: false, reason: 'nogame' } : r;
    },
    async reconnect() { const r = await toGame({ type: 'reconnect' }); if (r === undefined) await bg({ type: 'focusGame' }); },
    focusGame: () => bg({ type: 'focusGame' }),
    stopFlash: async () => {},
    setPlaying: async () => {},
    on(ch, cb) { (handlers[ch] ||= []).push(cb); },
  };
})();
