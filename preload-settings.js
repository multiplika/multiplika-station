const { contextBridge, ipcRenderer } = require('electron');

// API segura que usa la vista de Ajustes (assets/settings.html) para leer y
// escribir la configuración a través del proceso principal.
contextBridge.exposeInMainWorld('settingsApi', {
  // Devuelven promesas con el objeto de ajustes resultante.
  get: () => ipcRenderer.invoke('settings:get'),
  getDefaults: () => ipcRenderer.invoke('settings:defaults'),
  update: (patch) => ipcRenderer.invoke('settings:update', patch),
  reset: () => ipcRenderer.invoke('settings:reset'),
  // Impresoras disponibles en el equipo: [{ name, label, isDefault }].
  listPrinters: () => ipcRenderer.invoke('printers:list'),
  // Credenciales guardadas por app.
  listCredentials: (appId) => ipcRenderer.invoke('creds:list', appId),
  addCredential: (appId, user, password) => ipcRenderer.invoke('creds:add', { appId, user, password }),
  removeCredential: (appId, id) => ipcRenderer.send('creds:remove', { appId, id }),
  // Soporte.
  openEmail: () => ipcRenderer.send('support:email'),
  openWhatsApp: () => ipcRenderer.send('support:whatsapp'),
  downloadRustdesk: () => ipcRenderer.invoke('support:download-rustdesk'),
  // Estado del almacenamiento seguro: { available, platform, backend }.
  getSecureStorageStatus: () => ipcRenderer.invoke('creds:secure-status'),
  // Versión de la app: { version, date } (date en AAAAMMDD HH:MM).
  getVersion: () => ipcRenderer.invoke('app:version'),
  // Actualización automática (MST-02).
  getUpdateState: () => ipcRenderer.invoke('update:state'),
  checkUpdate: () => ipcRenderer.invoke('update:check'),
  installUpdate: () => ipcRenderer.invoke('update:install'),
  onUpdateState: (cb) => ipcRenderer.on('update:state', (_e, s) => cb(s))
});
