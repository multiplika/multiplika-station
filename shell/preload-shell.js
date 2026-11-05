const { contextBridge, ipcRenderer } = require('electron');

// API segura que usa la barra de pestañas (shell.html) para hablar
// con el proceso principal.
contextBridge.exposeInMainWorld('tabsApi', {
  newTab: () => ipcRenderer.send('tab:new'),
  closeTab: (id) => ipcRenderer.send('tab:close', id),
  activateTab: (id) => ipcRenderer.send('tab:activate', id),
  openDashboard: () => ipcRenderer.send('dashboard:open'),
  openSettings: () => ipcRenderer.send('settings:open'),
  back: () => ipcRenderer.send('nav:back'),
  forward: () => ipcRenderer.send('nav:forward'),
  reload: () => ipcRenderer.send('nav:reload'),
  onTabsUpdate: (callback) => {
    // `state` = { tabs: [...], overlay: 'dashboard'|'settings'|null }
    ipcRenderer.on('tabs:update', (event, state) => callback(state));
  }
});
