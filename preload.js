const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('liciAPI', {
  getFolder: () => ipcRenderer.invoke('get-folder'),
  changeFolder: () => ipcRenderer.invoke('change-folder'),
  openFolder: () => ipcRenderer.invoke('open-folder'),
  saveNow: () => ipcRenderer.invoke('save-now')
});
