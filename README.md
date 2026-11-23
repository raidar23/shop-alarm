# Magic Garden Shop Alarm

Rings when the [Magic Garden](https://magicgarden.gg) shop items you pick are in stock.

**Website:** open the link at the top of this repository (GitHub Pages). Pick the items you want under
**All items**, click **Turn on** once so your browser allows sound and pop-ups, and leave the tab open.
When one of your items is in the shop, the page rings (as gently or loudly as you choose per item) and
shows a notification.

Also on the site: every shop's restock timers, the current and coming weather (with the game's own
weather art), what's in each shop right now, when each item was last seen, and a crop price calculator
(size and mutations).

## What it does and doesn't do

In the spirit of the Magic Garden modding policy (fair, transparent, safe):

- **Read-only.** It only reads what the game's server already sends to every player: what's in each shop
  and the weather. It never plays, harvests, sells or buys for anyone. There's no game on the website and
  no buy button.
- **One watcher for everyone.** A single guest connection (no account) watches the shop on the server
  that feeds the website, instead of every visitor needing the game open.
- **Your choices stay with you.** Your alarm list, levels and sound settings are saved in your own
  browser only. Nothing is collected.
- **Readable code.** Everything is plain, commented JavaScript in this repository. Nothing is minified.

## How it's built

| Part | What it is |
|---|---|
| `main.js` | The desktop app (Electron). It runs the watcher: the game in a hidden window, reading the game's incoming messages through the browser's DevTools protocol. With `--server` it runs without a window as the website's server (`/api/live`, `/api/state`, `/api/assets`, `/api/events`). |
| `icon-extractor.js` | Reads the item pictures, prices, crops, weather art and UI textures from the game's own files. |
| `panel.html` | The whole interface. The same file is the desktop app's panel, the browser extension's side panel and the website. |
| `web-src/mg-web.js` | The website's link to the server; alarms are checked in your browser. |
| `extension-src/` | A Chrome/Edge extension version that reads your own open game tab instead. |
| `server-pack-src/` | Scripts that run the server on a spare PC with a free Cloudflare tunnel, and keep `docs/backend.json` pointing at it. |
| `docs/` | The website, as published on GitHub Pages (built by `build-extension.js`). |

## Running it yourself

1. Install [Node.js](https://nodejs.org), then in this folder: `npm install` and `npm start` (desktop app).
2. `node build-extension.js` builds the website (`web/`, published as `docs/`) and the extension (`extension/`).
3. `powershell -File make-server-pack.ps1` builds a folder to run the website server on another PC.

Not affiliated with Magic Circle. Magic Garden and its art belong to Magic Circle Studio.
