const { contextBridge, ipcRenderer } = require('electron')
contextBridge.exposeInMainWorld('benchmarkBridge', {
  prepare: () => ipcRenderer.invoke('fixture:prepare'),
  push: (count, done) => ipcRenderer.invoke('fixture:push', count, done),
  stats: () => ipcRenderer.invoke('fixture:stats'),
})
if (process.argv.includes('--fixture-desktop')) contextBridge.exposeInMainWorld('cnoteDesktop', {
  network: {
    request: () => Promise.reject(new Error('Only the local streaming fixture is allowed')),
    openStream: options => ipcRenderer.invoke('fixture:open', options),
    readStream: requestId => ipcRenderer.invoke('fixture:read', requestId),
    abort: requestId => ipcRenderer.invoke('fixture:abort', requestId),
  },
})
