// Magic Garden Shop Alarm: runs inside the Magic Garden page itself (the page's own "world"), because only
// from there can it see the game's connection and use the game's own functions. It does three things:
//   1. passes on the messages the game RECEIVES from its server (to read the shops and weather). It never
//      changes them and never sends anything to the server itself.
//   2. when you press Buy in the side panel, buys that one item through the game's own command sender,
//      exactly like the game's Buy button does.
//   3. reads the item pictures, prices and textures from the game's files (icon-extractor.js).
// It talks to the extension's content script with window.postMessage, tagged "mga-page" / "mga-content".
(() => {
  if (window.__mgaHooked) return;
  window.__mgaHooked = true;
  // the browser only remembers the first 250 files a page loads; the game loads more than that, and the
  // picture reader finds the game's sprite sheets in that list, so let it remember them all
  try { performance.setResourceTimingBufferSize(20000); } catch {}

  // the shared item/texture reader (from icon-extractor.js, put in here by build-extension.js)
  const EXTRACT = /*__EXTRACTOR__*/null;

  const post = msg => window.postMessage({ source: 'mga-page', ...msg }, location.origin);

  // ---- 1. read what the game receives ----
  const NativeWS = window.WebSocket;
  window.WebSocket = new Proxy(NativeWS, {
    construct(target, args, newTarget) {
      const ws = Reflect.construct(target, args, newTarget);
      try {
        if (/\/api\/rooms\/[^/]+\/connect/.test(String(args[0]))) {
          ws.addEventListener('message', e => { if (typeof e.data === 'string' && e.data[0] === '{') post({ type: 'frame', data: e.data }); });
          ws.addEventListener('close', () => post({ type: 'closed' }));
        }
      } catch {}
      return ws;
    },
  });

  // ---- 2. buying, through the game's own command sender ----
  // found by what it does (the game's file and function names change with every update)
  async function findSender() {
    if (window.__mgaSendCommand) return window.__mgaSendCommand;
    const urls = [...new Set(performance.getEntriesByType('resource').map(e => e.name).filter(n => /\/assets\/[\w-]+\.js(\?|$)/.test(n)))];
    for (const u of urls) {
      let text; try { text = await fetch(u).then(r => r.text()); } catch { continue; }
      if (!text.includes('admission') || !text.includes('didSend')) continue;
      let mod; try { mod = await import(u); } catch { continue; }
      const f = Object.values(mod).find(f => typeof f === 'function' && /admission/.test(String(f)) && /didSend/.test(String(f)) && /requestId/.test(String(f)));
      if (f) return (window.__mgaSendCommand = f);
    }
    return null;
  }
  async function buy(shop, item) {
    const send = await findSender();
    if (!send) return { ok: false, reason: 'nosender' };
    const r = send({ type: 'PurchaseShopItem', shop, viewMode: 'grid', item });
    if (!r || r.admission !== 'admitted' || !r.didSend) return { ok: false, reason: 'notsent' };
    const res = await Promise.race([r.resolution, new Promise(ok => setTimeout(() => ok({ outcome: 'timeout' }), 10000))]);
    return { ok: res?.outcome === 'accepted', reason: res?.outcome || 'unknown' };
  }

  // ---- requests from the content script ----
  window.addEventListener('message', async e => {
    const m = e.data;
    if (e.source !== window || m?.source !== 'mga-content') return;
    let result;
    try {
      if (m.type === 'buy') result = await buy(m.shop, m.item);
      else if (m.type === 'extract') result = EXTRACT ? await EXTRACT(96) : null;
      else if (m.type === 'version') result = (performance.getEntriesByType('resource').map(e => e.name).join(' ').match(/\/version\/(\d+)\//) || [])[1] || null;
    } catch (err) { result = { ok: false, reason: 'error', detail: String(err?.message || err) }; }
    post({ type: 'reply', id: m.id, result });
  });
})();
