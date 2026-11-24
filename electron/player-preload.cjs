// Bridge for the player window (receive mode).
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('player', {
  ready: () => ipcRenderer.invoke('rx:player-ready'),
  onFrame: (cb) => ipcRenderer.on('rx:frame', (_e, f) => cb(f)),
  onInfo: (cb) => ipcRenderer.on('rx:info', (_e, i) => cb(i)),
  touch: (action, x, y) => ipcRenderer.send('rx:touch', { action, x, y }),
  key: (code) => ipcRenderer.send('rx:key', code),
  fullscreen: () => ipcRenderer.send('rx:fullscreen'),
  disconnect: () => ipcRenderer.send('rx:disconnect'),
});
