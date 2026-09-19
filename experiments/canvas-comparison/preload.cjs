const { contextBridge, ipcRenderer } = require('electron')

ipcRenderer.on('bench:port', (event, metadata) => {
  window.postMessage({ type: 'bench:port', id: metadata.id }, '*', event.ports)
})

contextBridge.exposeInMainWorld('benchHost', {
  prepare: input => ipcRenderer.invoke('bench:prepare', input),
  read: id => ipcRenderer.invoke('bench:read', id),
  cancel: id => ipcRenderer.invoke('bench:cancel', id),
  utility: entities => ipcRenderer.invoke('bench:utility', entities),
  metrics: () => ipcRenderer.invoke('bench:metrics'),
  click: point => ipcRenderer.invoke('bench:click', point),
  versions: process.versions,
})
