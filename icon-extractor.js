// Runs inside the hidden game page (same site as the game, so it can read the game's files).
// Finds each shop item's picture in the game's sprite sheets and returns it as a small PNG.
// The sheets are GPU-compressed (KTX2, BC7), so they're decoded with WebGL and drawn out one sprite at a time.
// The value of this file is an expression: an async function taking the icon size, returning
// { version, icons: { "Seed:Carrot": "data:image/png;base64,...", ... }, missing: [...], prices: { "Seed:Carrot": 10, ... } }.
(async function extractIcons(SIZE = 96) {
  // The game's files. The page's list of loaded files doesn't always have the art (the game keeps it in a
  // browser cache, or loads it in the background), so also read the game's own art list, which the page's
  // HTML points at (runtime-assets/manifest.bc7.<hash>.json) and which names every sprite sheet.
  const fromManifest = [];
  try {
    const mm = document.documentElement.outerHTML.match(/\/?runtime-assets\/manifest\.bc7\.[\w]+\.json/);
    if (mm) {
      const man = await fetch(new URL('/' + mm[0].replace(/^\//, ''), location.href)).then(r => r.json());
      for (const b of man.bundles || []) for (const a of b.assets || []) for (const s of a.src || []) if (s?.src) fromManifest.push(new URL(s.src, location.href).href);
    }
  } catch {}
  const resources = () => [...performance.getEntriesByType('resource').map(e => e.name), ...fromManifest];
  const version = (location.href.match(/\/version\/(\d+)/) || resources().join(' ').match(/\/version\/(\d+)\//) || [])[1] || 'unknown';

  // ---- the item list: which sprite each shop item uses ----
  // the item lists are in the game's data modules: tools-*.js (eggs, tools, decor) and, since version 2071,
  // flora-*.js (seeds and crops). Read every such module the game has already loaded, so a future split still works.
  // The game keeps moving them between files (tools-*.js, then flora-*.js, then RoomConnection-*.js), so go by
  // what's inside: any of the game's loaded modules that mentions shop items. They're already loaded, so
  // importing them again just hands back the same module (nothing runs twice).
  const jsUrls = [...new Set(resources().filter(n => /\/assets\/[\w-]+\.js(\?|$)/.test(n)))];
  const dataUrls = [];
  await Promise.all(jsUrls.map(async u => { try { if ((await fetch(u).then(r => r.text())).includes('eligibleShops')) dataUrls.push(u); } catch {} }));
  if (!dataUrls.length) throw new Error('could not find the game\'s item list');
  const mod = {};
  for (const u of dataUrls) { try { for (const [k, v] of Object.entries(await import(u))) mod[`${u}#${k}`] = v; } catch {} }
  const TYPE_BY_FOLDER = { seed: 'Seed', pet: 'Egg', item: 'Tool', decor: 'Decor' };
  const wanted = {}; // item key -> sprite name (or an artboard name for animated decor)
  const prices = {}; // item key -> coin price in the shop
  const crops = {};  // seed key -> what the plant gives: sell price, size, slots, how long it takes to grow up
  for (const group of Object.values(mod)) {
    if (!group || typeof group !== 'object' || Array.isArray(group)) continue;
    const entries = [];
    for (const [id, v] of Object.entries(group)) {
      // every crop, including rare variants (Four-Leaf Clover...) that have no seed of their own
      if (v?.plant && v?.crop && typeof v.crop.baseSellPrice === 'number') {
        const p = v.plant;
        crops[`Seed:${id}`] = {
          sell: v.crop.baseSellPrice, maxScale: v.crop.maxSizeMultiplier || 1, harvest: p.harvestType || 'Single',
          slots: Array.isArray(p.growSlots) ? p.growSlots.length : 1, slotMin: p.slotCountMin, slotMax: p.slotCountMax,
          matureSec: p.secondsToMature || 0, needsWeather: (p.growSlots || []).find(s => s?.requiredWeather)?.requiredWeather || null,
          name: v.crop.name || v.name || id,
        };
      }
      const def = v?.eligibleShops ? v : v?.seed?.eligibleShops ? v.seed : null;
      if (!def) continue;
      const art = def.sprite ?? def.art;
      entries.push([id, typeof art === 'string' ? art : null, art?.artboardName || null, def.coinPrice]);
    }
    if (!entries.length) continue;
    // the group's type is whatever its sprites' folders say most
    const votes = {};
    for (const [, s] of entries) { const t = s && TYPE_BY_FOLDER[s.split('/')[1]]; if (t) votes[t] = (votes[t] || 0) + 1; }
    const type = Object.entries(votes).sort((a, b) => b[1] - a[1])[0]?.[0];
    if (!type) continue;
    for (const [id, sprite, artboard, price] of entries) {
      wanted[`${type}:${id}`] = sprite || (artboard ? `artboard:${artboard}` : null);
      if (typeof price === 'number') prices[`${type}:${id}`] = price;
    }
  }

  // ---- the sprite sheets ----
  // the sheets used to be at /atlases/sprites-N.bc7.json; since late 2026 they're /runtime-assets/sprites-N.bc7.<hash>.json
  let atlasUrls = resources().filter(n => /\/sprites-\d+\.bc7(\.[\w]+)?\.json/.test(n));
  // the game's weather icons, keyed "Weather:<name>"
  for (const n of ['Rain', 'Frost', 'Thunderstorm', 'Dawn', 'AmberMoon', 'Lunar', 'Sunny']) wanted[`Weather:${n}`] = `sprite/ui/${n}Icon`;
  atlasUrls = [...new Set(atlasUrls.map(u => u.split('?')[0]))];
  const atlases = await Promise.all(atlasUrls.map(async u => ({ url: u, json: await fetch(u).then(r => r.json()) })));
  const frameOf = {};
  for (const a of atlases) for (const [name, f] of Object.entries(a.json.frames)) frameOf[name] = { atlas: a, f };
  // animated decor has no still sprite name; use a sprite with the same name if there is one
  const lower = Object.fromEntries(Object.keys(frameOf).map(k => [k.toLowerCase(), k]));
  for (const [key, s] of Object.entries(wanted)) {
    if (!s?.startsWith('artboard:')) continue;
    const n = s.slice(9).toLowerCase();
    wanted[key] = lower[`sprite/decor/${n}`] || Object.keys(frameOf).find(k => k.toLowerCase().startsWith(`sprite/decor/${n}`)) || null;
  }

  // ---- WebGL decoder ----
  const cv = document.createElement('canvas');
  const gl = cv.getContext('webgl2', { premultipliedAlpha: false, preserveDrawingBuffer: true, alpha: true, antialias: false });
  if (!gl) throw new Error('no WebGL2');
  const bptc = gl.getExtension('EXT_texture_compression_bptc');
  if (!bptc) throw new Error('this GPU cannot read BC7 textures');
  const sh = (type, src) => { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); return s; };
  const prog = gl.createProgram();
  gl.attachShader(prog, sh(gl.VERTEX_SHADER, `#version 300 es
    in vec2 p; uniform vec4 r; uniform bool rot; out vec2 uv;
    void main() {
      vec2 s = vec2(p.x * 0.5 + 0.5, 0.5 - p.y * 0.5);         // 0..1 across the sprite, top-left origin
      vec2 a = rot ? vec2(1.0 - s.y, s.x) : s;                 // sprites packed sideways are turned back
      uv = r.xy + a * r.zw;
      gl_Position = vec4(p, 0.0, 1.0);
    }`));
  gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, `#version 300 es
    precision highp float; uniform sampler2D t; in vec2 uv; out vec4 o;
    void main() { o = texture(t, uv); }`));
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error('shader: ' + gl.getProgramInfoLog(prog));
  gl.useProgram(prog);
  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
  const loc = gl.getAttribLocation(prog, 'p');
  gl.enableVertexAttribArray(loc);
  gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
  const uR = gl.getUniformLocation(prog, 'r'), uRot = gl.getUniformLocation(prog, 'rot');

  async function loadSheet(atlas) {
    const meta = atlas.json.meta;
    const file = meta.halfSizeImage || meta.image || meta.fullSizeImage;
    const b = new Uint8Array(await fetch(new URL(file, atlas.url)).then(r => r.arrayBuffer()));
    const dv = new DataView(b.buffer);
    const vk = dv.getUint32(12, true), w = dv.getUint32(20, true), h = dv.getUint32(24, true), sc = dv.getUint32(44, true);
    if (vk !== 145 && vk !== 146) throw new Error('sheet format ' + vk);
    if (sc !== 0) throw new Error('sheet is supercompressed');
    const off = Number(dv.getBigUint64(80, true)), len = Number(dv.getBigUint64(88, true));
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    // read it as plain (not sRGB) so the colours come out exactly as stored
    gl.compressedTexImage2D(gl.TEXTURE_2D, 0, bptc.COMPRESSED_RGBA_BPTC_UNORM_EXT, w, h, 0, b.subarray(off, off + len));
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return { tex, scale: w / meta.size.w, W: meta.size.w, H: meta.size.h };
  }

  const out = document.createElement('canvas');
  out.width = out.height = SIZE;
  const o2d = out.getContext('2d');
  o2d.imageSmoothingQuality = 'high';

  const icons = {}, missing = [], errors = [];
  const byAtlas = new Map();
  for (const [key, sprite] of Object.entries(wanted)) {
    const fr = sprite && frameOf[sprite];
    if (!fr) { missing.push(key); continue; }
    if (!byAtlas.has(fr.atlas)) byAtlas.set(fr.atlas, []);
    byAtlas.get(fr.atlas).push([key, fr.f]);
  }
  for (const [atlas, list] of byAtlas) {
    let sheet;
    try { sheet = await loadSheet(atlas); } catch (e) { errors.push(`${atlas.url.split('/').pop()}: ${e.message}`); for (const [k] of list) missing.push(k); continue; }
    for (const [key, f] of list) {
      const { x, y, w, h } = f.frame;
      const rot = !!f.rotated;
      const aw = rot ? h : w, ah = rot ? w : h;           // the space it takes in the sheet
      cv.width = Math.max(1, Math.round(w * sheet.scale));
      cv.height = Math.max(1, Math.round(h * sheet.scale));
      gl.viewport(0, 0, cv.width, cv.height);
      gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
      gl.bindTexture(gl.TEXTURE_2D, sheet.tex);
      gl.uniform4f(uR, x / sheet.W, y / sheet.H, aw / sheet.W, ah / sheet.H);
      gl.uniform1i(uRot, rot);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      // fit it into a square, centred, a little padding
      const pad = SIZE * 0.06, box = SIZE - pad * 2, k = Math.min(box / cv.width, box / cv.height);
      const dw = cv.width * k, dh = cv.height * k;
      o2d.clearRect(0, 0, SIZE, SIZE);
      o2d.drawImage(cv, (SIZE - dw) / 2, (SIZE - dh) / 2, dw, dh);
      icons[key] = out.toDataURL('image/png');
    }
    gl.deleteTexture(sheet.tex);
  }
  // ---- the game's UI textures (panels, boards, shelves, buttons, badges), at their own size, so the app can
  // dress itself like the game's shop. Nine-slice ones also report how far in their corners go.
  const UI_NAMES = ['ShopShelfPlank', 'WeatherStation9Slice', 'WeatherStationTopper', 'ToastBoardBase9Slice', 'ToastBoardAccent9Slice',
    'InventoryModal', 'StorageModal', 'BigButton9Slice', 'Coin', 'CloseButton', 'NotifierBellOn', 'NotifierBellOff',
    'SeedsRestocked', 'EggsRestocked', 'ToolsRestocked', 'DecorRestocked', 'CheckboxChecked', 'CheckboxUnchecked', 'SliderThumb', 'Thumbtack',
    'RarityCommon', 'RarityUncommon', 'RarityRare', 'RarityLegendary', 'RarityMythic', 'RarityDivine', 'RarityCelestial', 'MoneyBag',
    'ToastIllustrationSeeds', 'ToastIllustrationEggs', 'ToastIllustrationTools', 'ToastIllustrationAllShops', 'ToastIllustrationSnowShop',
    'ToastIllustrationThunderShop', 'ToastIllustrationDawnShop', 'ToastIllustrationAmberShop', 'ToastIllustrationSpookyShop'];
  const ui = {};
  try {
    const uiByAtlas = new Map();
    for (const n of UI_NAMES) { const fr = frameOf[`sprite/ui/${n}`]; if (!fr) continue; if (!uiByAtlas.has(fr.atlas)) uiByAtlas.set(fr.atlas, []); uiByAtlas.get(fr.atlas).push([n, fr.f]); }
    const raw = document.createElement('canvas');
    for (const [atlas, list] of uiByAtlas) {
      const sheet = await loadSheet(atlas);
      for (const [n, f] of list) {
        const { x, y, w, h } = f.frame, rot = !!f.rotated;
        cv.width = Math.max(1, Math.round(w * sheet.scale)); cv.height = Math.max(1, Math.round(h * sheet.scale));
        gl.viewport(0, 0, cv.width, cv.height); gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
        gl.bindTexture(gl.TEXTURE_2D, sheet.tex);
        gl.uniform4f(uR, x / sheet.W, y / sheet.H, (rot ? h : w) / sheet.W, (rot ? w : h) / sheet.H);
        gl.uniform1i(uRot, rot);
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
        raw.width = cv.width; raw.height = cv.height;
        const r2 = raw.getContext('2d'); r2.clearRect(0, 0, raw.width, raw.height); r2.drawImage(cv, 0, 0);
        // the nine-slice parts tell where the corners end
        const part = p => frameOf[`sprite/ui/${n}/nine-slice/${p}`]?.f.frame;
        const k = sheet.scale, px = v => v ? Math.round(v * k) : 0;
        const tl = part('topLeft'), br = part('bottomRight');
        const slice = (tl || part('left') || part('top')) ? {
          t: px((tl || part('top') || part('topRight'))?.h), l: px((tl || part('left') || part('bottomLeft'))?.w),
          b: px((br || part('bottom') || part('bottomLeft'))?.h), r: px((br || part('right') || part('topRight'))?.w),
        } : null;
        ui[n] = { src: raw.toDataURL('image/png'), w: raw.width, h: raw.height, slice };
      }
      gl.deleteTexture(sheet.tex);
    }
  } catch (e) { ui.error = String(e.message || e); }

  // ---- the weather animations: the game's weather sheet has a strip of frames for each weather
  // (rain, snowflakes, dawn shimmer, amber shimmer: tiles the game repeats across the screen; thunderstorm: a lightning strike)
  const weather = {};
  try {
    const wjUrl = resources().find(n => /\/weather\.bc7(\.[\w]+)?\.json/.test(n));
    if (wjUrl) {
      const wj = await fetch(wjUrl).then(r => r.json());
      const atlas = { url: wjUrl, json: { ...wj, meta: { ...wj.meta, halfSizeImage: wj.meta.halfSizeImage, image: wj.meta.halfSizeImage || wj.meta.image } } };
      const sheet = await loadSheet(atlas);
      const strip = document.createElement('canvas');
      for (const [name, f] of Object.entries(wj.frames)) {
        const m = name.match(/^weather\/(\w+)Animation$/); if (!m) continue;
        const { x, y, w, h } = f.frame;
        cv.width = Math.round(w * sheet.scale); cv.height = Math.round(h * sheet.scale);
        gl.viewport(0, 0, cv.width, cv.height); gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
        gl.bindTexture(gl.TEXTURE_2D, sheet.tex);
        gl.uniform4f(uR, x / sheet.W, y / sheet.H, w / sheet.W, h / sheet.H);
        gl.uniform1i(uRot, false);
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
        strip.width = cv.width; strip.height = cv.height;
        const s2 = strip.getContext('2d'); s2.clearRect(0, 0, strip.width, strip.height); s2.drawImage(cv, 0, 0);
        const frames = h <= w / 3 ? Math.round(w / h) : 9; // square frames in a row; the lightning strip has 9 tall ones
        weather[m[1]] = { src: strip.toDataURL('image/png'), frames, fw: strip.width / frames, fh: strip.height };
      }
      gl.deleteTexture(sheet.tex);
    }
  } catch (e) { weather.error = String(e.message || e); }
  gl.getExtension('WEBGL_lose_context')?.loseContext();
  return { version, icons, missing, prices, crops, weather, ui, errors };
})
