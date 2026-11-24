const { app, BrowserWindow, Menu, ipcMain, Notification, shell, screen, Tray, nativeImage } = require('electron');
const path = require('path');
const fs = require('fs');

// Magic Garden Shop Alarm: a small window where you tick the shop items you want. The app keeps the game
// open in a hidden window (see "the hidden watcher") and reads what every shop has after each restock from
// the game's own connection to its server (through the page's DevTools protocol; nothing is injected into
// the game). When a ticked item is in stock, the alarm rings, a Windows notification pops up and the
// taskbar button flashes. You play wherever you like; the app doesn't touch your own game.

const GAME_URL = 'https://magicgarden.gg';
// --server: runs as the website's server (e.g. on a spare PC): no window, no game, no sounds or pop-ups,
// just the hidden watcher and the website. The tray icon opens the website and quits.
const SERVER_MODE = process.argv.includes('--server');
const ICON = path.join(__dirname, 'icon.png');
const SETTINGS = () => path.join(app.getPath('userData'), 'settings.json');

// Every item each shop can sell (read from the game's own item list, with the names the game shows), so
// you can tick items before they ever turn up — including the weather shops, which only open while their
// weather is on. Each entry is Type:Id=Name. The game adds any newer items it lists, and those are remembered.
const STARTER = {
  seed: 'Seed:Carrot=Carrot Seed|Seed:Cabbage=Cabbage Seed|Seed:Strawberry=Strawberry Seed|Seed:Aloe=Aloe Seed|Seed:Beet=Beet Seed|Seed:Rose=Rose Seed|Seed:FavaBean=Fava Bean|Seed:Blueberry=Blueberry Seed|Seed:Apple=Apple Seed|Seed:OrangeTulip=Tulip Seed|Seed:Tomato=Tomato Seed|Seed:Daffodil=Daffodil Seed|Seed:Corn=Corn Kernel|Seed:Watermelon=Watermelon Seed|Seed:Echeveria=Echeveria Cutting|Seed:Pumpkin=Pumpkin Seed|Seed:Pear=Pear Seed|Seed:Gentian=Gentian Seed|Seed:Coconut=Coconut Seed|Seed:Banana=Banana Seed|Seed:Lily=Lily Seed|Seed:Camellia=Camellia Seed|Seed:Peach=Peach Seed|Seed:BurrosTail=Burro\'s Tail Cutting|Seed:Cactus=Cactus Seed|Seed:Bamboo=Bamboo Seed|Seed:Chrysanthemum=Chrysanthemum Seed|Seed:Date=Date Seed|Seed:Grape=Grape Seed|Seed:Pepper=Pepper Seed|Seed:Lemon=Lemon Seed|Seed:PassionFruit=Passion Fruit Seed|Seed:DragonFruit=Dragon Fruit Seed|Seed:Cacao=Cacao Bean|Seed:Lychee=Lychee Pit|Seed:Sunflower=Sunflower Seed|Seed:Starweaver=Starweaver Pod',
  egg: 'Egg:CommonEgg=Common Egg|Egg:UncommonEgg=Uncommon Egg|Egg:RareEgg=Rare Egg|Egg:LegendaryEgg=Legendary Egg|Egg:HorseEgg=Horse Egg|Egg:MythicalEgg=Mythical Egg|Egg:WinterEgg=Winter Egg',
  tool: 'Tool:WateringCan=Watering Can|Tool:PlanterPot=Planter Pot|Tool:CropCleanser=Crop Cleanser|Tool:Shovel=Garden Shovel|Tool:ReplenishPotion=Hunger Potion|Tool:XPPotion=XP Potion|Decor:FeedingTrough=Feeding Trough|Decor:DecorShed=Decor Shed|Decor:PetHutch=Pet Hutch|Decor:SeedSilo=Seed Silo|Decor:ToolShack=Tool Shack',
  decor: 'Decor:SmallRock=Small Rock|Decor:MediumRock=Medium Rock|Decor:LargeRock=Large Rock|Decor:HayBale=Hay Bale|Decor:StringLights=String Lights|Decor:PaperLantern=Paper Lantern|Decor:FanousLantern=Fanous Lantern|Decor:WoodBench=Wood Bench|Decor:WoodStoolShort=Short Wood Stool|Decor:WoodStool=Tall Wood Stool|Decor:WoodArch=Wood Arch|Decor:WoodPergola=Wood Pergola|Decor:WoodBridge=Wood Bridge|Decor:WoodLampPost=Wood Lamp Post|Decor:WoodOwl=Wood Owl|Decor:WoodBirdhouse=Wood Birdhouse|Decor:WoodWindmill=Wood Windmill|Decor:StoneBench=Stone Bench|Decor:StoneArch=Stone Arch|Decor:StoneBridge=Stone Bridge|Decor:StoneLampPost=Stone Lamp Post|Decor:StoneGnome=Stone Gnome|Decor:StoneGnomess=Stone Gnomess|Decor:StonePedestal=Stone Pedestal|Decor:MarbleBench=Marble Bench|Decor:MarbleArch=Marble Arch|Decor:MarbleBridge=Marble Bridge|Decor:MarblePedestal=Marble Pedestal|Decor:MarbleLampPost=Marble Lamp Post|Decor:MarbleBlobling=Marble Blobling|Decor:MarbleKnight=Marble Knight|Decor:MiniFairyCottage=Mini Fairy Cottage|Decor:StrawScarecrow=Straw Scarecrow|Decor:MiniFairyForge=Mini Fairy Forge|Decor:MiniFairyKeep=Mini Fairy Keep|Decor:MiniWizardTower=Mini Wizard Tower|Decor:MiniFairyCastle=Mini Fairy Castle',
  rain: 'Seed:Clover=Clover Seed|Seed:Delphinium=Delphinium Seed|Seed:Mushroom=Mushroom Spore|Seed:VioletCort=Violet Cort Spore|Tool:RainWardShard=Rain Ward|Decor:WoodFrog=Wood Frog|Decor:StoneBirdbath=Stone Birdbath|Decor:MarbleFountain=Marble Fountain',
  snow: 'Seed:Snowdrop=Snowdrop Seed|Seed:PineTree=Pinecone|Seed:Leek=Leek Seed|Seed:Squash=Squash Seed|Seed:Poinsettia=Poinsettia Seed|Egg:SnowEgg=Snow Egg|Tool:ChilledPotion=Chilled Potion|Tool:FrozenPotion=Frozen Potion|Tool:SnowWardShard=Snow Ward|Decor:ColoredStringLights=Colored String Lights|Decor:WoodCaribou=Wood Caribou|Decor:StoneCaribou=Stone Caribou|Decor:MarbleCaribou=Marble Caribou',
  thunder: 'Seed:Cattail=Cattail Seed|Seed:Cardoon=Cardoon Seed|Seed:PricklyPear=Prickly Pear Seed|Seed:Milkcap=Milkcap Spore|Seed:ThunderCelestial=Thunderspire Pod|Egg:ThunderEgg=Thunder Egg|Tool:ThunderWardShard=Thunder Ward|Decor:SmallGravestone=Small Gravestone|Decor:MediumGravestone=Medium Gravestone|Decor:LargeGravestone=Large Gravestone|Decor:Cauldron=Cauldron|Decor:WindchimeMoon=Moon Windchime|Decor:WindchimeStar=Star Windchime|Decor:WindSpinner=Wind Spinner|Decor:WindTurner=Wind Turner',
  dawn: 'Seed:Daisy=Daisy Seed|Seed:Lavender=Lavender Seed|Seed:Saffron=Saffron Seed|Seed:Eggplant=Eggplant Seed|Seed:Ube=Ube Seed|Seed:Dawnbreaker=Dawnbreaker Spore|Seed:DawnCelestial=Dawnbinder Pod|Egg:DawnEgg=Dawn Egg',
  amber: 'Seed:Persimmon=Persimmon Seed|Seed:Habanero=Habanero Seed|Seed:Marigold=Marigold Seed|Seed:Emberbloom=Emberbloom Pod|Seed:MoonCelestial=Moonbinder Pod|Egg:AmberEgg=Amber Egg|Tool:HungerShard=Hunger Shard|Tool:XPShard=XP Shard|Tool:StrengthShard=Strength Shard|Decor:StoneMoonGate=Stone Moon Gate|Decor:StoneTorch=Stone Torch|Decor:StoneFirepit=Stone Firepit',
  spooky: 'Seed:GhostPlant=Ghost Plant Cutting|Seed:Foxfire=Foxfire Spore|Seed:DeadlyNightshade=Deadly Nightshade Seed|Egg:SpookyEgg=Spooky Egg|Tool:CarvingKnife=Carving Knife|Decor:HauntLamp=Haunt Lamp|Decor:CroakwardenLamp=Croakwarden Lamp|Decor:HaySheave=Hay Sheaf|Decor:Spiderweb=Spiderweb|Decor:StoneGargoyle=Stone Gargoyle',
};
// each item's rarity, from the game's item list (colours the items like the game does)
const RARITY = Object.fromEntries('Decor:SmallRock=Common|Decor:MediumRock=Common|Decor:LargeRock=Common|Decor:HayBale=Common|Decor:StringLights=Common|Decor:ColoredStringLights=Uncommon|Decor:PaperLantern=Common|Decor:FanousLantern=Common|Decor:SmallGravestone=Common|Decor:WoodCaribou=Common|Decor:WoodBench=Common|Decor:WoodStoolShort=Common|Decor:WoodStool=Common|Decor:WoodArch=Common|Decor:WoodPergola=Common|Decor:WoodBridge=Common|Decor:WoodLampPost=Common|Decor:WoodOwl=Common|Decor:WoodFrog=Common|Decor:WoodBirdhouse=Common|Decor:WoodWindmill=Common|Decor:MediumGravestone=Uncommon|Decor:StoneCaribou=Uncommon|Decor:StoneBench=Uncommon|Decor:StoneArch=Uncommon|Decor:StoneBridge=Uncommon|Decor:StoneLampPost=Uncommon|Decor:StoneGnome=Uncommon|Decor:StoneGnomess=Uncommon|Decor:StoneBirdbath=Uncommon|Decor:StonePedestal=Uncommon|Decor:LargeGravestone=Rare|Decor:MarbleCaribou=Rare|Decor:MarbleBench=Rare|Decor:MarbleArch=Rare|Decor:MarbleBridge=Rare|Decor:MarblePedestal=Rare|Decor:MarbleLampPost=Rare|Decor:MarbleBlobling=Rare|Decor:MarbleKnight=Rare|Decor:MarbleFountain=Rare|Decor:StoneMoonGate=Legendary|Decor:StoneTorch=Mythical|Decor:StoneFirepit=Divine|Decor:MiniFairyCottage=Rare|Decor:Cauldron=Legendary|Decor:HauntLamp=Uncommon|Decor:CroakwardenLamp=Mythical|Decor:HaySheave=Rare|Decor:Spiderweb=Legendary|Decor:StoneGargoyle=Mythical|Decor:WindchimeMoon=Rare|Decor:WindchimeStar=Rare|Decor:WindSpinner=Mythical|Decor:WindTurner=Divine|Decor:StrawScarecrow=Legendary|Decor:MiniFairyForge=Legendary|Decor:MiniFairyKeep=Mythical|Decor:MiniWizardTower=Mythical|Decor:MiniFairyCastle=Divine|Decor:FeedingTrough=Rare|Decor:DecorShed=Divine|Decor:PetHutch=Divine|Decor:SeedSilo=Divine|Decor:ToolShack=Divine|Egg:CommonEgg=Common|Egg:UncommonEgg=Uncommon|Egg:RareEgg=Rare|Egg:LegendaryEgg=Legendary|Egg:SnowEgg=Legendary|Egg:DawnEgg=Legendary|Egg:ThunderEgg=Legendary|Egg:AmberEgg=Mythical|Egg:HorseEgg=Legendary|Egg:MythicalEgg=Mythical|Egg:SpookyEgg=Mythical|Egg:WinterEgg=Legendary|Tool:WateringCan=Common|Tool:PlanterPot=Common|Tool:CropCleanser=Common|Tool:ChilledPotion=Legendary|Tool:Shovel=Uncommon|Tool:CarvingKnife=Common|Tool:FrozenPotion=Mythical|Tool:ReplenishPotion=Rare|Tool:XPPotion=Legendary|Tool:RainWardShard=Rare|Tool:SnowWardShard=Rare|Tool:ThunderWardShard=Rare|Tool:HungerShard=Rare|Tool:XPShard=Legendary|Tool:StrengthShard=Mythical|Seed:Carrot=Common|Seed:Cabbage=Common|Seed:Strawberry=Common|Seed:Aloe=Common|Seed:Beet=Common|Seed:Daisy=Uncommon|Seed:Clover=Uncommon|Seed:Rose=Uncommon|Seed:FavaBean=Uncommon|Seed:Delphinium=Uncommon|Seed:Snowdrop=Uncommon|Seed:Blueberry=Uncommon|Seed:Apple=Uncommon|Seed:OrangeTulip=Uncommon|Seed:Tomato=Uncommon|Seed:Daffodil=Rare|Seed:Corn=Rare|Seed:Watermelon=Rare|Seed:Echeveria=Rare|Seed:Pumpkin=Rare|Seed:Cattail=Rare|Seed:Pear=Rare|Seed:Gentian=Rare|Seed:Lavender=Rare|Seed:Coconut=Legendary|Seed:PineTree=Legendary|Seed:Banana=Legendary|Seed:Leek=Legendary|Seed:Lily=Legendary|Seed:Saffron=Legendary|Seed:Cardoon=Legendary|Seed:Camellia=Legendary|Seed:Squash=Legendary|Seed:Peach=Legendary|Seed:BurrosTail=Legendary|Seed:Persimmon=Legendary|Seed:Mushroom=Mythical|Seed:Cactus=Mythical|Seed:Bamboo=Mythical|Seed:Eggplant=Mythical|Seed:PricklyPear=Mythical|Seed:VioletCort=Mythical|Seed:Chrysanthemum=Mythical|Seed:Date=Mythical|Seed:Grape=Mythical|Seed:Poinsettia=Mythical|Seed:Habanero=Mythical|Seed:Pepper=Divine|Seed:Ube=Divine|Seed:Milkcap=Divine|Seed:Lemon=Divine|Seed:PassionFruit=Divine|Seed:DragonFruit=Divine|Seed:Cacao=Divine|Seed:Lychee=Divine|Seed:Sunflower=Divine|Seed:Marigold=Divine|Seed:Dawnbreaker=Celestial|Seed:Emberbloom=Celestial|Seed:Starweaver=Celestial|Seed:ThunderCelestial=Celestial|Seed:DawnCelestial=Celestial|Seed:MoonCelestial=Celestial|Seed:GhostPlant=Legendary|Seed:Foxfire=Mythical|Seed:DeadlyNightshade=Divine'
  .split('|').map(e => e.split('=')));
// which shop opens with which weather (the game's forecast names the weather)
const WEATHER_SHOP = { Rain: 'rain', Frost: 'snow', Thunderstorm: 'thunder', Dawn: 'dawn', AmberMoon: 'amber' };

const settings = {
  watched: [],        // item keys, e.g. "Seed:Starweaver"
  catalog: {},        // key -> { shop, type, id, order }
  volume: 0.7,
  notify: true,
  sound: 'chime',     // chime | beep | siren
  // how hard each ticked item's alert is: silent (just shows it) | ping (one sound) | alert (a few rings,
  // flashes the taskbar) | alarm (rings until it leaves the shop)
  levels: {},
  defaultLevel: 'alarm',
  enabled: true,      // the main switch: off = no sounds, banner, pop-ups or flashing at all
  popup: true,        // bring the window up in front when an Alarm-level item comes in
  tray: true,         // closing the window keeps the app watching from the system tray
  startup: false,     // start with Windows (in the tray)
  seen: {},           // item key -> { at: when its last restock started, n: how many restocks it's been in, r: that restock's id }
};
const LEVELS = ['silent', 'ping', 'alert', 'alarm'];
const levelOf = key => settings.levels[key] || settings.defaultLevel || 'alarm';

function load() {
  try { Object.assign(settings, JSON.parse(fs.readFileSync(SETTINGS(), 'utf8'))); } catch {}
  let order = 0;
  for (const [shop, list] of Object.entries(STARTER)) {
    for (const entry of list.split('|')) {
      const [key, name] = entry.split('=');
      const [type, id] = key.split(':');
      settings.catalog[key] = { ...settings.catalog[key], shop, type, id, name, order: order++ };
    }
  }
}
let saveTimer = null;
function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => { try { fs.writeFileSync(SETTINGS(), JSON.stringify(settings, null, 2)); } catch {} }, 300);
}

const itemId = it => it.species ?? it.toolId ?? it.eggId ?? it.decorId ?? it.petSpecies ?? it.id ?? '?';
const itemKey = it => `${it.itemType}:${itemId(it)}`;
const pretty = s => String(s).replace(/([a-z])([A-Z])/g, '$1 $2').replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2');

// ---------- the game's room state, kept up to date from its messages ----------
let room = null;          // the room's full state (the Welcome message, then its patches applied)
let connected = false;
let lastShopsJson = '';
let lastGoodAt = Date.now(); // the last time the app could read the shops
let offlineWarned = false;
const WARN_AFTER_MS = Number(process.env.MG_WARN_AFTER_MS) || 5 * 60000;
const alerted = new Set(); // "restockId|itemKey" already rung for

function applyPatches(doc, patches) {
  for (const p of patches) {
    const parts = p.path === '' ? [] : p.path.split('/').slice(1).map(s => s.replace(/~1/g, '/').replace(/~0/g, '~'));
    if (parts.length === 0) { if (p.op === 'replace' || p.op === 'add') doc = p.value; continue; }
    const value = p.op === 'copy' || p.op === 'move' ? getAt(doc, p.from) : p.value;
    if (p.op === 'move') removeAt(doc, p.from);
    if (p.op === 'test') continue;
    const last = parts.pop();
    const parent = parts.reduce((o, k) => (o == null ? o : o[k]), doc);
    if (parent == null) throw new Error('missing parent ' + p.path);
    if (p.op === 'remove') {
      if (Array.isArray(parent)) parent.splice(Number(last), 1); else delete parent[last];
    } else if (p.op === 'add' || p.op === 'copy' || p.op === 'move') {
      if (Array.isArray(parent)) parent.splice(last === '-' ? parent.length : Number(last), 0, value);
      else parent[last] = value;
    } else if (p.op === 'replace') {
      parent[last] = value;
    }
  }
  return doc;
}
function getAt(doc, ptr) {
  return ptr.split('/').slice(1).map(s => s.replace(/~1/g, '/').replace(/~0/g, '~')).reduce((o, k) => o?.[k], doc);
}
function removeAt(doc, ptr) { applyPatches(doc, [{ op: 'remove', path: ptr }]); }

function onFrame(text) {
  if (typeof text !== 'string' || text[0] !== '{') return;
  let msg;
  try { msg = JSON.parse(text); } catch { return; }
  if (msg.type === 'Welcome' && msg.fullState) {
    room = msg.fullState;
  } else if (room && msg.state?.patches) {
    try { room = applyPatches(room, msg.state.patches); }
    catch { room = null; setConnected(false); return; } // out of step: wait for a fresh Welcome (or the watchdog restarts the game)
  } else return;
  // only count it as watching when the shops are really there (a game update could move them)
  if (!room?.child?.data?.shops) { setConnected(false); return; }
  lastGoodAt = Date.now();
  setConnected(true);
  shopsMaybeChanged();
  // once the game has settled, take the item pictures if they're missing or the game was updated
  if (msg.type === 'Welcome') setTimeout(refreshIcons, 6000);
}

function currentShops() {
  const shops = room?.child?.data?.shops;
  if (!shops) return null;
  const out = {};
  for (const [name, s] of Object.entries(shops)) {
    out[name] = {
      restockId: s.restockId,
      startedAtMs: s.startedAtMs,
      deadlineMs: s.deadlineMs,
      items: (s.inventory || []).map(it => {
        const key = itemKey(it);
        return { key, name: settings.catalog[key]?.name || pretty(itemId(it)), type: it.itemType, rarity: RARITY[key] || null, stock: it.initialStock ?? 0 };
      }),
    };
  }
  return out;
}

// the weather now and coming up, with the shop each one opens
function currentWeather() {
  const d = room?.child?.data;
  if (!d) return null;
  const tag = w => (w ? { weather: w, shop: WEATHER_SHOP[w] || null } : {});
  return {
    now: d.weather ? { ...tag(d.weather), startsAtMs: d.weatherWindow?.startsAtMs ?? null, endsAtMs: d.weatherWindow?.endsAtMs ?? null } : null,
    forecast: (d.weatherForecast || []).map(f => ({ ...tag(f.weatherId), group: f.groupId, startsAtMs: f.startsAtMs, endsAtMs: f.endsAtMs })),
  };
}

function shopsMaybeChanged() {
  const shops = currentShops();
  if (!shops) return;
  const weather = currentWeather();
  const json = JSON.stringify([shops, weather]);
  if (json === lastShopsJson) return;
  lastShopsJson = json;

  // remember every item the game lists, so it can be picked even while it's not in stock
  let learned = false;
  for (const [shop, s] of Object.entries(shops)) {
    s.items.forEach((it, i) => {
      const c = settings.catalog[it.key];
      if (!c) { settings.catalog[it.key] = { shop, type: it.type, id: it.key.split(':')[1], name: it.name, order: 1000 + i }; learned = true; }
    });
  }
  if (learned) { save(); send('catalog', catalogList()); }

  // remember when each item was last in the shop (and how many restocks it has turned up in)
  let saw = false;
  for (const s of Object.values(shops)) {
    for (const it of s.items) {
      if (it.stock <= 0) continue;
      const prev = settings.seen[it.key];
      if (prev?.r === s.restockId) continue;
      settings.seen[it.key] = { at: s.startedAtMs || Date.now(), n: (prev?.n || 0) + 1, r: s.restockId };
      saw = true;
    }
  }
  if (saw) save();

  send('shops', { shops, weather, seen: settings.seen, serverNow: room?.child?.data?.currentTime ?? Date.now(), at: Date.now() });
  checkAlarms(shops);
}

function checkAlarms(shops) {
  const watched = new Set(settings.watched);
  const hits = [];
  for (const [shop, s] of Object.entries(shops)) {
    for (const it of s.items) {
      if (it.stock <= 0 || !watched.has(it.key)) continue;
      const tag = `${s.restockId}|${it.key}`;
      if (alerted.has(tag)) continue;
      alerted.add(tag);
      hits.push({ ...it, shop, restockId: s.restockId, deadlineMs: s.deadlineMs, level: levelOf(it.key) });
    }
  }
  if (!hits.length) return;
  // alarms switched off: these count as seen, so switching back on doesn't ring for what's already there
  if (settings.enabled === false) return;
  send('alarm', hits);
  // the taskbar only flashes for the louder levels
  if (win && !win.isFocused() && hits.some(h => h.level === 'alert' || h.level === 'alarm')) win.flashFrame(true);
  // an Alarm-level item: bring the window up in front (without taking the keyboard from what you're doing)
  if (win && settings.popup !== false && hits.some(h => h.level === 'alarm')) {
    if (win.isMinimized()) win.restore();
    if (!win.isVisible()) win.showInactive();
    win.setAlwaysOnTop(true);
    win.moveTop();
    setTimeout(() => { if (win && !win.isDestroyed()) win.setAlwaysOnTop(false); }, 1500);
  }
  notify('In the shop now!', hits.map(h => `${h.name} ×${h.stock}`).join(', '));
}

// mark what's in stock right now as already rung for (used when you tick an item that's already there)
function markCurrentAlerted(key) {
  const shops = currentShops();
  if (!shops) return;
  for (const s of Object.values(shops)) for (const it of s.items) if (it.key === key && it.stock > 0) alerted.add(`${s.restockId}|${key}`);
}

function setConnected(on) {
  if (on && offlineWarned) {
    offlineWarned = false;
    if (settings.enabled !== false) notify('Shop alarm is watching again', 'It can see the shop again.');
  }
  if (connected === on) return;
  connected = on;
  updateTray();
  send('status', { connected, offlineSince: on ? null : lastGoodAt, warned: offlineWarned });
}

function notify(title, body) {
  if (SERVER_MODE || !settings.notify || !Notification.isSupported()) return;
  const n = new Notification({ title, body, icon: ICON, silent: true }); // the app plays its own sounds
  n.on('click', () => showWindow());
  n.show();
}

// Warn once when the shop has been out of sight for a while (game down for an update, no internet, or the
// game changed in a way the app doesn't understand), so you know the alarm isn't covering you.
setInterval(() => {
  if (offlineWarned || Date.now() - lastGoodAt < WARN_AFTER_MS) return;
  offlineWarned = true;
  const mins = Math.round((Date.now() - lastGoodAt) / 60000);
  send('status', { connected: false, offlineSince: lastGoodAt, warned: true });
  if (settings.enabled === false) return; // alarms are off, so there's nothing to miss: just the note in the window
  if (win && !win.isFocused()) win.flashFrame(true);
  notify('Shop alarm can’t see the shop', `It hasn’t been able to read the shop for ${mins} minute${mins === 1 ? '' : 's'}, so it won’t ring until it reconnects. It keeps trying by itself.`);
}, 5000);

function catalogList() {
  return Object.entries(settings.catalog)
    .map(([key, c]) => ({ key, shop: c.shop, type: c.type, name: c.name || pretty(c.id), rarity: RARITY[key] || null, order: c.order ?? 9999 }))
    .sort((a, b) => a.order - b.order);
}

// ---------- item pictures ----------
// Taken from the game's own sprite sheets by icon-extractor.js (run inside the hidden game page), saved in
// icons.json, and taken again whenever the game's version changes.
const ICONS_FILE = () => path.join(app.getPath('userData'), 'icons.json');
let iconCache = { version: null, icons: {} };
let iconsBusy = false, iconsDoneFor = null;
function loadIcons() { try { iconCache = JSON.parse(fs.readFileSync(ICONS_FILE(), 'utf8')); } catch {} }

async function refreshIcons() {
  if (iconsBusy || !watcher || watcher.isDestroyed()) return;
  const wc = watcher.webContents;
  iconsBusy = true;
  try {
    const version = await wc.executeJavaScript(`(performance.getEntriesByType('resource').map(e => e.name).join(' ').match(/\\/version\\/(\\d+)\\//) || [])[1] || null`);
    if (version && version === iconsDoneFor) return;
    if (version && version === iconCache.version && Object.keys(iconCache.icons || {}).length && iconCache.prices && iconCache.crops && Object.values(iconCache.crops)[0]?.name && iconCache.weatherArt?.Rain && iconCache.icons['Weather:Rain'] && iconCache.ui?.ShopShelfPlank) { iconsDoneFor = version; return; }
    const code = fs.readFileSync(path.join(__dirname, 'icon-extractor.js'), 'utf8');
    const res = await wc.executeJavaScript(`${code}(96)`, true);
    if (res && Object.keys(res.icons).length) {
      iconCache = { version: res.version, icons: res.icons, missing: res.missing, prices: res.prices || {}, crops: res.crops || {}, weatherArt: res.weather || {}, ui: res.ui || {} };
      iconsDoneFor = res.version;
      try { fs.writeFileSync(ICONS_FILE(), JSON.stringify(iconCache)); } catch {}
      send('icons', iconCache.icons);
      send('prices', iconCache.prices);
      send('crops', iconCache.crops);
      send('wxart', iconCache.weatherArt);
      send('ui', iconCache.ui);
      selftestLog?.(`icons: ${Object.keys(res.icons).length} taken, prices: ${Object.keys(res.prices || {}).length}, missing ${res.missing.join(' ') || 'none'} (game version ${res.version})`);
    }
  } catch (e) {
    selftestLog?.('icons failed: ' + e.message);
  } finally {
    iconsBusy = false;
  }
}
let selftestLog = null;

// ---------- the hidden watcher ----------
// The game runs in an invisible, muted window as its own guest player in its own room (its own storage,
// never your sign-in: the game lets an account play in only one place, so sharing yours would kick you out
// of your real game). It draws once a second at most; the app only reads its connection.
let watcher = null;
let lastFrameAt = 0;

function startWatcher() {
  watcher = new BrowserWindow({
    show: false,
    width: 1280,
    height: 720,
    webPreferences: { partition: 'persist:mg-watcher', offscreen: true, backgroundThrottling: false },
  });
  const wc = watcher.webContents;
  wc.setAudioMuted(true);
  wc.setFrameRate(1);
  wc.setWindowOpenHandler(() => ({ action: 'deny' }));

  const dbg = wc.debugger;
  try { dbg.attach('1.3'); } catch (e) { console.warn('could not attach to the game', e.message); }
  dbg.on('message', (_e, method, params) => {
    if (method === 'Network.webSocketFrameReceived' && params.response?.opcode === 1) {
      lastFrameAt = Date.now();
      onFrame(params.response.payloadData);
    } else if (method === 'Network.webSocketClosed') setConnected(false);
  });
  // tiny buffers: the game downloads big textures and the app never needs their bodies
  dbg.sendCommand('Network.enable', { maxTotalBufferSize: 64 * 1024, maxResourceBufferSize: 1024 }).catch(() => {});

  wc.on('render-process-gone', () => restartWatcher());
  watcher.on('closed', () => { watcher = null; });
  lastFrameAt = Date.now();
  watcher.loadURL(GAME_URL).catch(() => {});
}
function restartWatcher() {
  setConnected(false);
  room = null;
  if (watcher && !watcher.isDestroyed()) watcher.destroy();
  watcher = null;
  startWatcher();
}
// the game sends a message every second; if it goes quiet for a minute, or the shops can't be read for two,
// start it again (after an update this also loads the game's new version)
let lastRestartAt = Date.now();
setInterval(() => {
  if (!watcher) return;
  const now = Date.now();
  if (now - lastFrameAt > 60000 || (now - lastGoodAt > 120000 && now - lastRestartAt > 120000)) {
    lastRestartAt = now;
    restartWatcher();
  }
}, 15000);

// ---------- playing the game ----------
// "Play" shows Magic Garden inside this window, on the left of the alarm panel (a <webview> in panel.html).
// It has its own storage (persist:mg-player), so your sign-in is kept between runs and is never the hidden
// watcher's guest: the game lets one account play in only one place, and keeping them apart means neither
// kicks the other out. The window widens to make room for the game, and goes back when you close it.
const PANEL_W = 460, GAME_W = 1100;
let playing = true, gameWc = null; // the game is always shown beside the panel
function setPlaying(on) {
  if (!win || on === playing) return;
  playing = on;
  const b = win.getBounds();
  const area = screen.getDisplayMatching(b).workArea;
  if (on) {
    win.setMinimumSize(PANEL_W + 520, 520);
    // grow to the left so the alarm panel stays where it was, as far as the screen allows
    const width = Math.min(area.width, b.width + GAME_W);
    const x = Math.max(area.x, Math.min(b.x - (width - b.width), area.x + area.width - width));
    win.setBounds({ x, y: b.y, width, height: b.height });
  } else {
    win.setMinimumSize(380, 520);
    const width = Math.max(380, Math.min(b.width, PANEL_W));
    win.setBounds({ x: b.x + (b.width - width), y: b.y, width, height: b.height });
  }
}
// the game is always shown now, so the window starts wide (see createWindow) and this has nothing to do
ipcMain.handle('set-playing', () => {});

// ---------- buying from the side panel ----------
// Runs inside the game you're playing in this window, and buys through the game's own command sender: the same
// one its Buy button uses (so the purchase goes out exactly as if you'd clicked Buy in the shop). It finds that
// sender by what it does, since the game's file and function names change with every update. Nothing else in
// the game is touched, and the app never buys anything on its own: only when you press Buy.
const BUY_IN_GAME = `(async (shop, item) => {
  if (!window.__mgSendCommand) {
    const urls = [...new Set(performance.getEntriesByType('resource').map(e => e.name).filter(n => /\\/assets\\/[\\w-]+\\.js(\\?|$)/.test(n)))];
    for (const u of urls) {
      let text; try { text = await fetch(u).then(r => r.text()); } catch { continue; }
      if (!text.includes('admission') || !text.includes('didSend')) continue;
      let mod; try { mod = await import(u); } catch { continue; }
      const f = Object.values(mod).find(f => typeof f === 'function' && /admission/.test(String(f)) && /didSend/.test(String(f)) && /requestId/.test(String(f)));
      if (f) { window.__mgSendCommand = f; break; }
    }
  }
  if (!window.__mgSendCommand) return { ok: false, reason: 'nosender' };
  const r = window.__mgSendCommand({ type: 'PurchaseShopItem', shop, viewMode: 'grid', item });
  if (!r || r.admission !== 'admitted' || !r.didSend) return { ok: false, reason: 'notsent' };
  const res = await Promise.race([r.resolution, new Promise(ok => setTimeout(() => ok({ outcome: 'timeout' }), 10000))]);
  return { ok: res?.outcome === 'accepted', reason: res?.outcome || 'unknown' };
})`;
ipcMain.handle('buy', async (_e, key, shop) => {
  if (!gameWc || gameWc.isDestroyed()) return { ok: false, reason: 'nogame' };
  const [type, id] = String(key).split(':');
  const field = { Seed: 'species', Egg: 'eggId', Tool: 'toolId', Decor: 'decorId' }[type];
  if (!field || !id || typeof shop !== 'string') return { ok: false, reason: 'baditem' };
  try { return await gameWc.executeJavaScript(`${BUY_IN_GAME}(${JSON.stringify(shop)}, ${JSON.stringify({ itemType: type, [field]: id })})`, true); }
  catch (e) { return { ok: false, reason: 'error', detail: e.message }; }
});

// lock down the game view: its own storage, no access to the app
function guardWebview(_e, webPreferences, params) {
  delete webPreferences.preload;
  webPreferences.nodeIntegration = false;
  webPreferences.contextIsolation = true;
  webPreferences.partition = 'persist:mg-player';
  if (!/^https:\/\/magicgarden\.gg(\/|$)/.test(params.src || '')) params.src = GAME_URL;
}
function onGameAttached(_e, wc) {
  gameWc = wc;
  // sign-in pages (Discord, Google, Apple) open in a small window so the game gets the sign-in;
  // any other link opens in your normal browser
  wc.setWindowOpenHandler(({ url }) => {
    if (/^https:\/\/([a-z0-9-]+\.)*(magicgarden\.gg|discord\.com|google\.com|apple\.com)(\/|$)/i.test(url)) {
      return { action: 'allow', overrideBrowserWindowOptions: { width: 520, height: 760, autoHideMenuBar: true, parent: win } };
    }
    if (/^https?:\/\//i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  wc.on('destroyed', () => { if (gameWc === wc) gameWc = null; });
}

// ---------- the window ----------
let win = null;
const send = (ch, data) => { if (win && !win.isDestroyed()) win.webContents.send(ch, data); webSend(ch, data); };

// ---------- the Shop Alarm website ----------
// Serves the website version of the panel (built into ./web by build-extension.js) and a live feed of the
// shop to every visitor. One watcher (the hidden one above) feeds them all. The site is read-only: there's
// no game on it and no buying, and each visitor's alarms and settings stay in their own browser.
//   GET /                -> the site       GET /api/state  -> shops, weather, catalogue, status
//   GET /api/assets      -> item pictures, prices, crops, weather art, game textures (big; cached by version)
//   GET /api/events      -> live updates (Server-Sent Events): shops, status, catalog, assets
//   GET /api/live        -> shops, weather and status without the catalogue (the site checks it every few seconds)
const http = require('http');
const WEB_PORT = Number(process.env.MG_WEB_PORT) || 8787;
const WEB_DIR = path.join(__dirname, 'web');
const webClients = new Set();
const WEB_LIVE = new Set(['shops', 'status', 'catalog']);
function webSend(ch, data) {
  if (!webClients.size) return;
  const line = WEB_LIVE.has(ch) ? `event: ${ch}\ndata: ${JSON.stringify(data)}\n\n`
    : ['icons', 'prices', 'crops', 'wxart', 'ui'].includes(ch) ? `event: assets\ndata: ${JSON.stringify({ version: iconCache.version })}\n\n` : null;
  if (line) for (const res of webClients) res.write(line);
}
const webState = () => ({
  catalog: catalogList(), shops: currentShops(), weather: currentWeather(), seen: settings.seen,
  serverNow: room?.child?.data?.currentTime ?? Date.now(), connected, offlineSince: connected ? null : lastGoodAt, warned: offlineWarned,
  assetsVersion: iconCache.version || null,
});
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.json': 'application/json', '.ico': 'image/x-icon' };
let webServer = null;
function startWebServer() {
  if (webServer || process.env.MG_NO_WEB) return;
  webServer = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    // the site may also be served from elsewhere (GitHub Pages) and read this server's data: the data is
    // public and read-only, so any page may read it
    const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS' };
    if (req.method === 'OPTIONS') { res.writeHead(204, CORS); res.end(); return; }
    const json = (obj, cache) => { res.writeHead(200, { ...CORS, 'Content-Type': 'application/json', 'Cache-Control': cache || 'no-store' }); res.end(JSON.stringify(obj)); };
    if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405, CORS); res.end(); return; }
    if (url.pathname === '/api/state') return json(webState());
    // the light version, checked every few seconds by the site (live streams don't always get through tunnels)
    if (url.pathname === '/api/live') {
      const { catalog, ...rest } = webState();
      return json({ ...rest, catalogCount: catalog.length });
    }
    if (url.pathname === '/api/assets') return json({ version: iconCache.version || null, icons: iconCache.icons || {}, prices: iconCache.prices || {}, crops: iconCache.crops || {}, wxart: iconCache.weatherArt || {}, ui: iconCache.ui || {} }, 'public, max-age=300');
    if (url.pathname === '/api/events') {
      res.writeHead(200, { ...CORS, 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
      res.write(`retry: 3000\n\n`);
      webClients.add(res);
      const keep = setInterval(() => res.write(`: keep-alive\n\n`), 20000);
      req.on('close', () => { clearInterval(keep); webClients.delete(res); });
      return;
    }
    // the site's own files
    const rel = url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname).replace(/^\/+/, '');
    const file = path.normalize(path.join(WEB_DIR, rel));
    if (!file.startsWith(WEB_DIR + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) { res.writeHead(404, { 'Content-Type': 'text/plain' }); res.end('Not found'); return; }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache', 'X-Content-Type-Options': 'nosniff' });
    fs.createReadStream(file).pipe(res);
  });
  webServer.on('error', e => selftestLog?.('web server: ' + e.message));
  webServer.listen(WEB_PORT, '127.0.0.1', () => selftestLog?.(`website at http://localhost:${WEB_PORT}`));
}

ipcMain.handle('get', () => ({
  settings: { volume: settings.volume, notify: settings.notify, sound: settings.sound, defaultLevel: settings.defaultLevel, enabled: settings.enabled !== false,
    popup: settings.popup !== false, tray: settings.tray !== false, startup: !!settings.startup },
  seen: settings.seen,
  levels: settings.levels,
  watched: settings.watched,
  catalog: catalogList(),
  shops: currentShops(),
  weather: currentWeather(),
  serverNow: room?.child?.data?.currentTime ?? Date.now(),
  connected,
  icons: iconCache.icons || {},
  prices: iconCache.prices || {},
  crops: iconCache.crops || {},
  wxart: iconCache.weatherArt || {},
  ui: iconCache.ui || {},
  offlineSince: connected ? null : lastGoodAt,
  warned: offlineWarned,
}));
ipcMain.handle('reconnect', () => restartWatcher());
ipcMain.handle('watch', (_e, key, on) => {
  const set = new Set(settings.watched);
  if (on) { set.add(key); markCurrentAlerted(key); }
  else { set.delete(key); const { [key]: _gone, ...rest } = settings.levels; settings.levels = rest; }
  settings.watched = [...set];
  save();
  return settings.watched;
});
ipcMain.handle('set', (_e, name, value) => {
  if (name === 'volume') settings.volume = Math.min(1, Math.max(0, Number(value) || 0));
  if (name === 'notify') settings.notify = !!value;
  if (name === 'sound' && ['chime', 'beep', 'siren'].includes(value)) settings.sound = value;
  if (name === 'defaultLevel' && LEVELS.includes(value)) settings.defaultLevel = value;
  if (name === 'enabled') { settings.enabled = !!value; if (!value && win) win.flashFrame(false); updateTray(); }
  if (name === 'popup') settings.popup = !!value;
  if (name === 'tray') settings.tray = !!value;
  if (name === 'startup') { settings.startup = !!value; applyStartup(); }
  save();
});

// ---------- system tray + start with Windows ----------
let tray = null, quitting = false, trayHintShown = false;
function updateTray() {
  if (!tray) return;
  const on = settings.enabled !== false;
  if (SERVER_MODE) {
    tray.setToolTip(`Shop Alarm server · ${connected ? 'watching the shop' : 'connecting…'} · website on port ${WEB_PORT}`);
    tray.setContextMenu(Menu.buildFromTemplate([
      { label: 'Open the website', click: () => shell.openExternal(`http://localhost:${WEB_PORT}`) },
      { type: 'separator' },
      { label: 'Stop the server', click: () => { quitting = true; app.quit(); } },
    ]));
    return;
  }
  tray.setToolTip(`Shop Alarm · ${on ? (connected ? 'watching the shop' : 'connecting…') : 'alarms off'}`);
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Open Shop Alarm', click: showWindow },
    { label: on ? 'Turn alarms off' : 'Turn alarms on', click: () => { settings.enabled = !on; save(); send('enabled', settings.enabled); updateTray(); } },
    { type: 'separator' },
    { label: 'Quit', click: () => { quitting = true; app.quit(); } },
  ]));
}
function createTray() {
  if (tray) return;
  // (a Linux server has no tray to put an icon in: then it simply runs without one)
  try { tray = new Tray(nativeImage.createFromPath(ICON).resize({ width: 16, height: 16 })); } catch { tray = null; return; }
  tray.on('click', showWindow);
  updateTray();
}
function showWindow() {
  if (!win) return;
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
}
// "Start with Windows": runs this app (hidden in the tray) when you sign in
function applyStartup() {
  if (process.env.MG_SELFTEST || SERVER_MODE) return; // the server pack starts itself (see its scripts)
  try {
    app.setLoginItemSettings({ openAtLogin: !!settings.startup, path: process.execPath, args: [path.resolve(__dirname), '--hidden'] });
  } catch {}
}
ipcMain.handle('set-level', (_e, key, level) => {
  if (!LEVELS.includes(level) || typeof key !== 'string') return settings.levels;
  settings.levels = { ...settings.levels, [key]: level };
  save();
  return settings.levels;
});
ipcMain.handle('stop-flash', () => { if (win) win.flashFrame(false); });

function createWindow() {
  // wide enough for the game on the left and the panel on the right, as far as the screen allows
  const area = screen.getPrimaryDisplay().workArea;
  const width = Math.min(area.width, PANEL_W + GAME_W), height = Math.min(area.height, 860);
  win = new BrowserWindow({
    width,
    height,
    x: area.x + Math.round((area.width - width) / 2),
    y: area.y + Math.round((area.height - height) / 2),
    minWidth: PANEL_W + 520,
    minHeight: 520,
    title: 'Magic Garden Shop Alarm',
    icon: ICON,
    show: !process.argv.includes('--hidden'), // started with Windows: stay in the tray
    backgroundColor: '#f7f0de',
    titleBarStyle: 'hidden', // the page draws its own title bar; Windows keeps its buttons on the right
    titleBarOverlay: { color: '#00000000', symbolColor: '#ffffff', height: 44 },
    // keep the alarm sound and countdowns running at full speed while the window is hidden in the tray
    webPreferences: { preload: path.join(__dirname, 'preload.js'), webviewTag: true, backgroundThrottling: false },
  });
  win.loadFile(path.join(__dirname, 'panel.html'));
  win.webContents.on('will-attach-webview', guardWebview);
  win.webContents.on('did-attach-webview', onGameAttached);
  win.on('focus', () => win.flashFrame(false));
  // closing the window hides it to the tray (it keeps watching), unless that's switched off or you chose Quit
  win.on('close', e => {
    if (quitting || settings.tray === false || !tray) return;
    e.preventDefault();
    win.hide();
    if (!trayHintShown) {
      trayHintShown = true;
      notify('Shop Alarm is still watching', 'It’s in the system tray by the clock. Right-click it to quit.');
    }
  });
  win.on('closed', () => {
    win = null;
    if (watcher && !watcher.isDestroyed()) watcher.destroy();
    app.quit();
  });
}

if (process.env.MG_SELFTEST) app.setPath('userData', path.join(process.env.MG_SELFTEST, 'userdata'));
// the server keeps its own settings and pictures, so it can run beside the normal app on one PC
else if (SERVER_MODE) app.setPath('userData', path.join(app.getPath('appData'), 'Magic Garden Shop Alarm Server'));
if (!app.requestSingleInstanceLock()) app.quit();
app.on('second-instance', () => showWindow());
app.on('before-quit', () => { quitting = true; });

app.whenReady().then(() => {
  app.setAppUserModelId('Magic Garden Shop Alarm'); // lets Windows show the notifications
  Menu.setApplicationMenu(null);
  load();
  loadIcons();
  if (!SERVER_MODE) createWindow();
  createTray();
  applyStartup();
  startWatcher();
  startWebServer();
  // MG_SELFTEST=<folder>: logs what the app sees and saves screenshots there (for checking the app works)
  const dir = process.env.MG_SELFTEST;
  if (dir) {
    const log = s => fs.appendFileSync(path.join(dir, 'selftest.log'), `${new Date().toISOString()} ${s}\n`);
    selftestLog = log;
    win.webContents.on('console-message', (_e, level, message) => { if (level >= 2) log('panel console: ' + message); });
    const shot = n => win?.webContents.capturePage().then(img => fs.writeFileSync(path.join(dir, `shot${n}.png`), img.toPNG()));
    setInterval(() => {
      const s = currentShops();
      log(`connected=${connected} room=${room?.data?.roomId} ` + (s ? ['seed', 'egg', 'tool', 'decor'].map(k => s[k].restockId + ':' + s[k].items.map(i => i.stock).join(',')).join(' | ') : ''));
    }, 5000);
    setTimeout(() => shot(1), 25000);
    // MG_SELFTEST_THEME=dark|light: check the app in that look
    if (process.env.MG_SELFTEST_THEME) win.webContents.once('did-finish-load', () => win.webContents.executeJavaScript(`store.set('theme', '${process.env.MG_SELFTEST_THEME === 'dark' ? 'dark' : 'light'}'); applyTheme();`).catch(() => {}));
    if (process.env.MG_SELFTEST_EXTRA) {
      // tray, bring-to-front, last seen, and clicking Shop now tiles
      const js = code => win.webContents.executeJavaScript(code).catch(e => log('js error: ' + e.message));
      const steps = [
        [26000, () => { log(`tray=${!!tray} seen entries=${Object.keys(settings.seen).length}`); js(`showTab('mine'); [...document.querySelectorAll('#mineList .sub')].map(s => s.textContent).join(' | ')`).then(v => log('my alarms: ' + v)); }],
        [26500, () => { win.minimize(); }],
        [27500, () => {
          settings.watched = [...new Set([...settings.watched, 'Seed:Mushroom'])];
          onFrame(JSON.stringify({ type: 'RoomFrame', state: { patches: [
            { op: 'replace', path: '/child/data/shops/rain', value: { restockId: 'rain:extra', startedAtMs: Date.now(), deadlineMs: Date.now() + 600000, inventory: [{ itemType: 'Seed', species: 'Mushroom', initialStock: 1 }] } }] } }));
        }],
        [28500, () => log(`after alarm: minimized=${win.isMinimized()} visible=${win.isVisible()}`)],
        [29000, () => js(`stopRing(); showTab('mine'); ''`)],
        [29500, () => shot(1)],
        [30000, () => js(`showTab('shop'); const t = document.querySelector('#shopList .tile:not(.mine)'); const k = t.dataset.tkey; t.click(); k`).then(k => setTimeout(() => js(`watched.has('${k}') + ' gold=' + !!document.querySelector('#shopList .tile.mine[data-tkey="${k}"]')`).then(v => log(`clicked tile ${k}: watched=${v}`)), 800))],
        [31500, () => shot(2)],
        [32000, () => js(`showTab('pick'); [...document.querySelectorAll('#pickList .seen')].slice(0, 4).map(s => s.textContent).join(' | ')`).then(v => log('all items seen: ' + v))],
        [32500, () => js(`openSettings()`)], [33300, () => shot(3)],
        [33600, () => { js(`closeSettings()`); win.close(); }],
        [34500, () => log(`after close: window exists=${!!win && !win.isDestroyed()} visible=${win?.isVisible()} watcher=${!!watcher}`)],
        [35000, () => { showWindow(); log(`shown again: visible=${win.isVisible()}`); }],
      ];
      for (const [t, f] of steps) setTimeout(f, t);
      return;
    }
    if (process.env.MG_SELFTEST_IDLE) return; // just run (e.g. to try the website), no scripted steps
    if (process.env.MG_SELFTEST_BUY) {
      // press Buy on a seed that's in stock (the test guest has no coins, so the game should say no)
      const js = code => win.webContents.executeJavaScript(code).catch(e => log('js error: ' + e.message));
      setTimeout(() => js(`(async () => { const it = shops.seed.items.find(i => i.stock > 0); const r = await mg.buy(it.key, 'seed'); return it.key + ' -> ' + JSON.stringify(r); })()`).then(v => log('buy: ' + v)), 50000);
      setTimeout(() => js(`showTab('shop'); document.querySelector('#shopList [data-buy]').click(); ''`), 62000);
      setTimeout(() => { shot(20); js(`$('toast')?.textContent`).then(v => log('toast: ' + v)); }, 66000);
      return;
    }
    if (process.env.MG_SELFTEST_WEATHER) {
      // each weather scene, one after another
      const js = code => win.webContents.executeJavaScript(code).catch(e => log('js error: ' + e.message));
      const scenes = ['Rain', 'Frost', 'Thunderstorm', 'Dawn', 'AmberMoon', null];
      scenes.forEach((wx, i) => {
        setTimeout(() => js(`weather = { now: ${wx ? `{ weather: '${wx}', shop: ${JSON.stringify(WEATHER_SHOP[wx] || null)}, startsAtMs: now() - 120000, endsAtMs: now() + 180000 }` : 'null'},
          forecast: [{ weather: 'Frost', shop: 'snow', startsAtMs: now() + 900000, endsAtMs: now() + 1200000 }, { group: 'Lunar', startsAtMs: now() + 3600000, endsAtMs: now() + 3900000 }, { weather: 'Thunderstorm', shop: 'thunder', startsAtMs: now() + 7200000, endsAtMs: now() + 7500000 }] };
          lastWeatherKey = ''; renderWeather(); tick(); $('weather').querySelectorAll('.wscene i').length`).then(v => log(`${wx || 'clear'}: ${v} scene bits`)), 26000 + i * 1500);
        if (wx === 'Thunderstorm') setTimeout(() => js(`wxStrike = { x: 250, start: performance.now() - 240 }; ''`), 26000 + i * 1500 + 900); // catch a lightning strike
        setTimeout(() => shot(10 + i), 26000 + i * 1500 + 1100);
      });
      return;
    }
    if (process.env.MG_SELFTEST_CALC) {
      // the crop calculator: max-size Rainbow + Frozen + Amberlit Pumpkin, three of them = 3 × 3700 × 3 × 550
      const js = code => win.webContents.executeJavaScript(code).catch(e => log('js error: ' + e.message));
      const read = `$('calcResult').querySelector('.nm')?.textContent + ' = ' + $('calcResult').querySelector('.calc-price b')?.textContent + ' (' + $('calcResult').querySelector('.calc-price small')?.textContent + ')'`;
      const steps = [
        [30000, () => { log(`crops: ${Object.keys(iconCache.crops || {}).length}, icons ${Object.keys(iconCache.icons || {}).length}, missing ${(iconCache.missing || []).join(' ')}`); js(`showTab('calc'); ${read}`).then(v => log('default: ' + v)); }],
        [30800, () => shot(1)],
        [31200, () => js(`document.querySelector('[data-crop="Seed:Pumpkin"]').click(); document.querySelector('[data-size="100"]').click();
          for (const m of ['Rainbow', 'Frozen', 'Amberlit']) document.querySelector('.mut[data-m="' + m + '"]').click();
          $('calcQty').value = 3; $('calcQty').oninput(); ${read}`).then(v => log('pumpkin: ' + v))],
        [32000, () => shot(2)],
        [32300, () => js(`$('calcSearch').value = 'clover'; $('calcSearch').oninput(); [...document.querySelectorAll('.cg span')].map(s => s.textContent).join(', ')`).then(v => log('search clover: ' + v))],
        [32800, () => js(`for (const m of ['Rainbow', 'Frozen', 'Amberlit']) document.querySelector('.mut[data-m="' + m + '"]').click(); $('calcQty').value = 1; $('calcQty').oninput(); document.querySelector('[data-size="75"]').click(); $('calcSearch').value = ''; $('calcSearch').oninput(); document.querySelector('[data-crop="Seed:Carrot"]').click(); ${read}`).then(v => log('reset: ' + v))],
      ];
      for (const [t, f] of steps) setTimeout(f, t);
      return;
    }
    if (process.env.MG_SELFTEST_OFFLINE) {
      // pretend the game is down: block its site, check the warning shows, then let it back and check it recovers
      const ses = require('electron').session.fromPartition('persist:mg-watcher');
      setTimeout(() => {
        log('blocking the game');
        ses.webRequest.onBeforeRequest({ urls: ['*://magicgarden.gg/*', '*://*.magicgarden.gg/*'] }, (_d, cb) => cb({ cancel: true }));
        restartWatcher();
      }, 26000);
      const panelState = tag => win.webContents.executeJavaScript(`$('status').textContent + ' | offline banner: ' + $('offline').className + ' | ' + $('offline').textContent.trim().replace(/\\s+/g,' ')`)
        .then(s => log(`${tag} panel: ${s}`), e => log(`${tag} panel error: ${e.message}`));
      setTimeout(() => { log(`warned=${offlineWarned}`); panelState('offline'); shot(2); }, 26000 + WARN_AFTER_MS + 8000);
      setTimeout(() => panelState('recovered'), 26000 + WARN_AFTER_MS + 39000);
      setTimeout(() => { log('unblocking the game'); ses.webRequest.onBeforeRequest(null); restartWatcher(); }, 26000 + WARN_AFTER_MS + 10000);
      setTimeout(() => { log(`after recovery connected=${connected} warned=${offlineWarned}`); shot(3); }, 26000 + WARN_AFTER_MS + 40000);
      return;
    }
    setTimeout(() => {
      // tick a Rain Shop item, pretend the rain started and the Rain Shop opened, and check the alarm fires
      if (!room) { log('no game state'); return; }
      settings.watched = [...new Set([...settings.watched, 'Seed:Mushroom'])];
      log('weather=' + JSON.stringify(currentWeather()));
      onFrame(JSON.stringify({ type: 'RoomFrame', state: { patches: [
        { op: 'replace', path: '/child/data/weather', value: 'Rain' },
        { op: 'replace', path: '/child/data/shops/rain', value: { restockId: 'rain:selftest', startedAtMs: Date.now(), deadlineMs: Date.now() + 600000,
          inventory: [{ itemType: 'Seed', species: 'Clover', initialStock: 3 }, { itemType: 'Seed', species: 'Mushroom', initialStock: 1 }, { itemType: 'Decor', decorId: 'WoodFrog', initialStock: 0 }] } },
      ] } }));
      log('alerted entries: ' + [...alerted].join(' '));
      const js = code => win.webContents.executeJavaScript(code).catch(e => log('js error: ' + e.message));
      js(`watched.add('Seed:Mushroom'); watched.add('Egg:MythicalEgg'); watched.add('Seed:Starweaver'); renderAll();`);
      const steps = [
        [1500, () => shot(2)],                                                    // the alarm
        [2500, () => js(`stopRing(); showTab('mine')`)], [3300, () => shot(3)],   // my alarms
        [3600, () => js(`showTab('pick')`)], [4300, () => shot(4)],               // all items
        [4600, () => js(`showTab('shop')`)], [5300, () => shot(5)],               // shop now
        [5400, () => js(`[...document.querySelectorAll('#shopList .shophead .label')].map(e => e.textContent).join(' > ')`).then(v => log('shop order: ' + v))],
        [5600, () => js(`openSettings()`)], [6400, () => shot(6)],                // settings
        // a new Rain Shop restock with the item: rings; then it sells out: the alarm should stop by itself
        [7000, () => { js(`closeSettings()`); settings.watched = [...new Set([...settings.watched, 'Seed:Mushroom'])];
          onFrame(JSON.stringify({ type: 'RoomFrame', state: { patches: [{ op: 'replace', path: '/child/data/shops/rain/restockId', value: 'rain:selftest2' }] } })); }],
        [8500, () => js(`$('alarm').classList.contains('show') + ' level=' + $('alarm').dataset.level + ' looping=' + !!ringStop`).then(v => log('ringing after restock: ' + v))],
        [9000, () => onFrame(JSON.stringify({ type: 'RoomFrame', state: { patches: [{ op: 'replace', path: '/child/data/shops/rain/inventory/1/initialStock', value: 0 }] } }))],
        [11000, () => js(`$('alarm').classList.contains('show')`).then(v => log('ringing after it left the shop: ' + v))],
        // the same item set to Ping: shows the banner and plays once, no looping alarm
        [12000, () => { settings.levels = { ...settings.levels, 'Seed:Mushroom': 'ping' };
          onFrame(JSON.stringify({ type: 'RoomFrame', state: { patches: [
            { op: 'replace', path: '/child/data/shops/rain/inventory/1/initialStock', value: 2 },
            { op: 'replace', path: '/child/data/shops/rain/restockId', value: 'rain:selftest3' }] } })); }],
        [13000, () => js(`$('alarm').classList.contains('show') + ' level=' + $('alarm').dataset.level + ' looping=' + !!ringStop + ' button=' + $('stop').textContent`).then(v => log('ping item: ' + v))],
        [13200, () => shot(7)],
        [14000, () => js(`stopRing(); levels = { 'Seed:Mushroom': 'ping', 'Egg:MythicalEgg': 'alert' }; showTab('mine'); renderMine(); openLevelMenu(document.querySelector('[data-level-for="Seed:Starweaver"]'))`)],
        [14800, () => shot(8)],
        // alarms switched off: a restock with a ticked item must not ring
        [15500, () => js(`closeLevelMenu(); setEnabled(false)`)],
        [16000, () => onFrame(JSON.stringify({ type: 'RoomFrame', state: { patches: [
          { op: 'replace', path: '/child/data/shops/rain/restockId', value: 'rain:selftest4' }] } }))],
        [17000, () => js(`$('alarm').classList.contains('show')`).then(v => log(`alarms off (main enabled=${settings.enabled}): ringing=${v}`))],
        [17200, () => shot(9)],
        [17800, () => js(`setEnabled(true)`)],
        [18300, () => js(`$('offNote').classList.contains('show')`).then(v => log(`alarms back on (main enabled=${settings.enabled}): off note showing=${v}`))],
        // Play: the game shows in this window beside the panel, and the hidden watcher stays connected alongside it
        [19000, () => { log(`window before play: ${JSON.stringify(win.getBounds())}`); js(`showTab('mine'); setPlaying(true)`); }],
        [40000, () => {
          log(`playing: window ${JSON.stringify(win.getBounds())}, game url=${gameWc?.getURL()}; watcher connected=${connected}, last shop data ${Math.round((Date.now() - lastGoodAt) / 1000)}s ago`);
          shot(10);
        }],
        [42000, () => js(`setPlaying(false)`)],
        [43500, () => js(`!!document.querySelector('webview')`).then(v => log(`closed game: webview still there=${v}, window ${JSON.stringify(win.getBounds())}`))],
      ];
      for (const [t, f] of steps) setTimeout(f, t);
    }, 30000);
  }
});
// the server has no window of its own, and the hidden watcher is briefly gone while it restarts: keep running
app.on('window-all-closed', () => { if (!SERVER_MODE) app.quit(); });
