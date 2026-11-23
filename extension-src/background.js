// Magic Garden Shop Alarm, background worker.
// Opens the side panel from the toolbar button, shows Windows notifications for alarms (so you're told even
// with the side panel closed), and finds or opens your Magic Garden tab.

const GAME_URL = 'https://magicgarden.gg/';
const ICON = 'icons/icon128.png';

function setup() { chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {}); }
chrome.runtime.onInstalled.addListener(setup);
chrome.runtime.onStartup.addListener(setup);
setup();

// the Magic Garden tab to use: the active one if you're on it, else the most recent
async function gameTab() {
  const tabs = await chrome.tabs.query({ url: 'https://magicgarden.gg/*' });
  if (!tabs.length) return null;
  return tabs.find(t => t.active) || tabs.sort((a, b) => (b.lastAccessed || 0) - (a.lastAccessed || 0))[0];
}
async function focusGame() {
  const t = await gameTab();
  if (t) { await chrome.tabs.update(t.id, { active: true }); await chrome.windows.update(t.windowId, { focused: true }); return t.id; }
  const n = await chrome.tabs.create({ url: GAME_URL });
  return n.id;
}

chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  if (msg?.to !== 'bg') return;
  if (msg.type === 'notify') {
    chrome.notifications.create(`mga-${Date.now()}`, {
      type: 'basic', iconUrl: ICON, title: msg.title, message: msg.body || '',
      priority: 2, requireInteraction: !!msg.sticky, silent: false,
    }, () => void chrome.runtime.lastError);
    return;
  }
  if (msg.type === 'gameTab') { gameTab().then(t => reply(t ? t.id : null)); return true; }
  if (msg.type === 'focusGame') { focusGame().then(id => reply(id)); return true; }
});

chrome.notifications.onClicked.addListener(id => {
  chrome.notifications.clear(id);
  focusGame().then(async () => {
    // open the side panel too, if the browser allows it from a notification click
    try { const w = await chrome.windows.getLastFocused(); await chrome.sidePanel.open({ windowId: w.id }); } catch {}
  });
});
