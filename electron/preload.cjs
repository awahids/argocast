// Narrow bridge between the sandboxed UI and the main process.
const { contextBridge, ipcRenderer } = require('electron');

const on = (channel) => (cb) => {
  const listener = (_e, payload) => cb(payload);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
};

contextBridge.exposeInMainWorld('argocast', {
  getSettings: () => ipcRenderer.invoke('settings:get'),
  checkFfmpeg: () => ipcRenderer.invoke('ffmpeg:check'),
  setSettings: (patch) => ipcRenderer.invoke('settings:set', patch),
  discover: () => ipcRenderer.invoke('discover'),
  start: (target) => ipcRenderer.invoke('cast:start', target),
  stop: () => ipcRenderer.invoke('cast:stop'),
  status: () => ipcRenderer.invoke('cast:status'),
  onFound: on('discover:found'),
  onState: on('cast:state'),
  onStats: on('cast:stats'),
  onTouchback: on('cast:touchback'),
  getUpdate: () => ipcRenderer.invoke('update:get'),
  checkUpdate: () => ipcRenderer.invoke('update:check'),
  installUpdate: () => ipcRenderer.invoke('update:install'),
  onUpdate: on('update:state'),
});
