'use strict';
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronTestPlay', {
  readRomFile: (filePath) => ipcRenderer.invoke('fs:readRomFile', filePath),
  openDebugWindow: (options) => ipcRenderer.invoke('window:openDebug', options),
  openSettingsWindow: () => ipcRenderer.invoke('window:openTestPlaySettings'),
  getSettings: () => ipcRenderer.invoke('testplay:getSettings'),
  onSettingsChanged: (callback) => {
    ipcRenderer.on('testplay:settings-changed', (_event, payload) => callback(payload));
  },
});
