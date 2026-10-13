const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('nusacut', {
  invoke: (channel, ...args) => ipcRenderer.invoke(channel, ...args),
  onExportProgress: (cb) => {
    const listener = (_e, p) => cb(p);
    ipcRenderer.on('export-progress', listener);
    return () => ipcRenderer.removeListener('export-progress', listener);
  },
});
