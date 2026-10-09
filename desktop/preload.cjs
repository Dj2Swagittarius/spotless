// Gives the bundled setup page its buttons. Server pages get nothing: the bridge is only exposed on
// the local setup page, and the main process checks the sender again before acting.
const { contextBridge, ipcRenderer } = require('electron');

if (location.protocol === 'file:') {
  contextBridge.exposeInMainWorld('spotlessDesktop', {
    connect: (url) => ipcRenderer.invoke('setup:connect', url),
    scan: () => ipcRenderer.invoke('setup:scan'),
    cancel: () => ipcRenderer.invoke('setup:cancel'),
  });
}
