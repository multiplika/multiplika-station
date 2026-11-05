const { contextBridge, ipcRenderer } = require('electron');

// API segura que usa el Panel de control (assets/dashboard.html) para conocer
// las URLs de las aplicaciones, guardarlas y abrirlas en una pestaña.
contextBridge.exposeInMainWorld('dashboardApi', {
  // [{ id, url }] con la URL configurada de cada app (vacía si no tiene).
  getApps: () => ipcRenderer.invoke('apps:list'),
  // Guardar la URL de una app; devuelve { id, url }.
  setAppUrl: (id, url) => ipcRenderer.invoke('apps:set-url', { id, url }),
  // Abrir la app (su URL) en una pestaña nueva.
  openApp: (id) => ipcRenderer.send('apps:open', id),
  // El proceso principal reenvía la lista (con visibilidad) al mostrar el panel.
  onApps: (cb) => ipcRenderer.on('apps:update', (_e, apps) => cb(apps))
});
