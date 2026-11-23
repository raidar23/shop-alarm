const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('mg', {
  get: () => ipcRenderer.invoke('get'),
  watch: (key, on) => ipcRenderer.invoke('watch', key, on),
  set: (name, value) => ipcRenderer.invoke('set', name, value),
  stopFlash: () => ipcRenderer.invoke('stop-flash'),
  reconnect: () => ipcRenderer.invoke('reconnect'),
  setLevel: (key, level) => ipcRenderer.invoke('set-level', key, level),
  setPlaying: on => ipcRenderer.invoke('set-playing', on),
  buy: (key, shop) => ipcRenderer.invoke('buy', key, shop),
  on: (channel, cb) => {
    if (['shops', 'alarm', 'status', 'catalog', 'icons', 'prices', 'crops', 'enabled', 'wxart', 'ui'].includes(channel)) ipcRenderer.on(channel, (_e, data) => cb(data));
  },
});
