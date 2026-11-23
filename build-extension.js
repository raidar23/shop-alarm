// Builds the Chrome/Edge extension (in ./extension) from the desktop app's own files, so both stay the same:
//   panel.html        -> the side panel (its inline scripts moved to files, since extensions don't allow inline scripts)
//   icon-extractor.js -> put inside page.js (reads item pictures, prices and textures from the game)
//   main.js           -> its item catalogue (STARTER, RARITY, WEATHER_SHOP) becomes catalog.js
//   extension-src/    -> the extension's own files (manifest, background, content script, page hook, mg shim, icons)
// Run:  node build-extension.js
const fs = require('fs');
const path = require('path');

const here = __dirname;
const src = path.join(here, 'extension-src');
const out = path.join(here, 'extension');
const read = f => fs.readFileSync(path.join(here, f), 'utf8');
const write = (f, text) => { fs.mkdirSync(path.dirname(path.join(out, f)), { recursive: true }); fs.writeFileSync(path.join(out, f), text); };

fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });

// 1. the extension's own files, as they are
(function copy(from, to) {
  for (const e of fs.readdirSync(from, { withFileTypes: true })) {
    const a = path.join(from, e.name), b = path.join(to, e.name);
    if (e.isDirectory()) { fs.mkdirSync(b, { recursive: true }); copy(a, b); }
    else if (e.name !== 'page-hook.js') fs.copyFileSync(a, b);
  }
})(src, out);

// 2. the item catalogue, lifted out of main.js
const main = read('main.js');
const grab = (re, what) => { const m = main.match(re); if (!m) throw new Error(`couldn't find ${what} in main.js`); return m[0]; };
const starter = grab(/const STARTER = \{[\s\S]*?\n\};/, 'STARTER');
const rarity = grab(/const RARITY = Object\.fromEntries\([\s\S]*?\.split\('\|'\)\.map\(e => e\.split\('='\)\)\);/, 'RARITY');
const weatherShop = grab(/const WEATHER_SHOP = \{[^\n]*\};/, 'WEATHER_SHOP');
write('catalog.js', `// Every item each shop can sell, each item's rarity, and which weather opens which shop.\n// Generated from main.js by build-extension.js.\nglobalThis.MGA_CATALOG = (() => {\n${starter}\n${rarity}\n${weatherShop}\nreturn { STARTER, RARITY, WEATHER_SHOP };\n})();\n`);

// 3. page.js: the page hook with the item/texture reader inside
const extractor = read('icon-extractor.js').trim();
const hook = fs.readFileSync(path.join(src, 'page-hook.js'), 'utf8');
if (!hook.includes('/*__EXTRACTOR__*/null')) throw new Error('page-hook.js is missing the extractor marker');
write('page.js', hook.replace('/*__EXTRACTOR__*/null', `\n${extractor}\n`));

// 4. the side panel
let panel = read('panel.html');
panel = panel.replace(/<meta http-equiv="Content-Security-Policy"[^>]*>\n?/, '');
panel = panel.replace('src="icon.png"', 'src="icons/icon128.png"');
const scripts = [...panel.matchAll(/<script>([\s\S]*?)<\/script>/g)];
if (scripts.length !== 2) throw new Error(`expected 2 inline scripts in panel.html, found ${scripts.length}`);
write('theme-init.js', scripts[0][1].trim() + '\n');
write('panel-main.js', scripts[1][1].trim() + '\n');
panel = panel.replace(scripts[0][0], '<script src="theme-init.js"></script>');
panel = panel.replace(scripts[1][0], '<script src="catalog.js"></script>\n<script src="mg-shim.js"></script>\n<script src="panel-main.js"></script>');
write('panel.html', panel);

console.log('Built the extension in', out);
for (const f of fs.readdirSync(out)) console.log('  ', f);

// ---- the website (./web): the same panel, fed by the app's web server, with mg-web.js instead ----
const web = path.join(here, 'web');
fs.rmSync(web, { recursive: true, force: true });
fs.mkdirSync(path.join(web, 'icons'), { recursive: true });
for (const f of fs.readdirSync(path.join(src, 'icons'))) fs.copyFileSync(path.join(src, 'icons', f), path.join(web, 'icons', f));
fs.copyFileSync(path.join(out, 'catalog.js'), path.join(web, 'catalog.js'));
fs.copyFileSync(path.join(out, 'theme-init.js'), path.join(web, 'theme-init.js'));
fs.copyFileSync(path.join(out, 'panel-main.js'), path.join(web, 'panel-main.js'));
fs.copyFileSync(path.join(here, 'web-src', 'mg-web.js'), path.join(web, 'mg-web.js'));
let site = fs.readFileSync(path.join(out, 'panel.html'), 'utf8')
  .replace('<script src="mg-shim.js"></script>', '<script src="mg-web.js"></script>')
  .replace('<title>Shop Alarm</title>', '<title>Magic Garden Shop Alarm</title>\n<meta name="viewport" content="width=device-width, initial-scale=1">\n<meta name="description" content="Rings when the Magic Garden shop items you pick are in stock.">\n<link rel="icon" href="icons/icon32.png">');
fs.writeFileSync(path.join(web, 'index.html'), site);
console.log('Built the website in', web);
