const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('dw', {
  call: (ch, ...args) => ipcRenderer.invoke(ch, ...args),
  on: (ch, cb) => ipcRenderer.on(ch, (_, payload) => cb(payload)),
});
