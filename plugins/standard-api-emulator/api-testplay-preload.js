'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('apiTestPlay', {
  stopApiServer: () => ipcRenderer.invoke('api:stopServer'),
  isApiServerRunning: () => ipcRenderer.invoke('api:isRunning'),
  onApiLog: (callback) => {
    ipcRenderer.on('api-log', (_event, payload) => callback(payload));
  },
  onApiExit: (callback) => {
    ipcRenderer.on('api-exit', (_event, payload) => callback(payload));
  },
});
