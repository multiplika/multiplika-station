const { app, BrowserWindow, WebContentsView, ipcMain, shell, dialog, session, Menu } = require('electron');
const path = require('path');
const os = require('os');
const store = require('./settings-store');
const creds = require('./credentials-store');
const { startStationServer } = require('./station/server'); // API local (puente con LEIA)
const { crearDescargador } = require('./station/descargador'); // descargador de modelos AEAT (.NET)

// Versión de la app (MST-05): version.json es la fuente de la verdad
// (formato libre + fecha de actualización en AAAAMMDD HH:MM).
let versionInfo = { version: '', date: '' };
try { versionInfo = Object.assign(versionInfo, require('./version.json')); } catch (_) { /* sin archivo */ }

// Altura (px) de la barra de pestañas.
const CHROME_HEIGHT = 44;

// Zoom por defecto de las webs (MST-08): 0.8 = 80 %.
const PAGE_ZOOM = 0.8;

// Ajustes efectivos (valores por defecto de config.js + los guardados por el
// usuario). Se cargan al arrancar, en app.whenReady().
let settings = null;

// Aplicaciones del Panel de control: id fijo -> clave de URL en los ajustes.
const APPS = [
  { id: 'erp', urlKey: 'URL_ERP', showKey: 'SHOW_ERP', name: 'multiplika ERP' },
  { id: 'plus', urlKey: 'URL_PLUS', showKey: 'SHOW_PLUS', name: 'multiplika Plus' },
  { id: 'leia', urlKey: 'URL_LEIA', showKey: 'SHOW_LEIA', name: 'multiplika Leia' }
];

let mainWindow = null;

// API local de la Station: { port, token, baseUrl, workRoot, close }. La arranca
// app.whenReady(); el puente __MULTIPLIKA_STATION__ se entrega a las pestañas de LEIA.
let stationApi = null;

// Descargador de modelos AEAT que Station lleva dentro (resources/descargador). Lo
// enciende al arrancar y lo apaga al cerrarse; sus datos y PDFs van a
// ~/.multiplika/descargador (fuera de la instalación, que cada actualización reemplaza).
const descargador = crearDescargador({
  exe: app.isPackaged
    ? path.join(process.resourcesPath, 'descargador', 'DescargadorModelos.exe')
    : path.join(__dirname, 'vendor', 'descargador', 'DescargadorModelos.exe'),
  carpeta: path.join(os.homedir(), '.multiplika', 'descargador'),
});

// Estado de las pestañas.
const tabs = new Map();      // id -> WebContentsView
let activeTabId = null;
let nextTabId = 1;

// Vistas superpuestas a pantalla completa (panel de control y ajustes).
// No son pestañas normales y solo una puede estar visible a la vez.
let dashboardView = null;
let settingsView = null;
let overlay = null; // 'dashboard' | 'settings' | null

// ---------------------------------------------------------------------------
//  Ventana principal
// ---------------------------------------------------------------------------
function createWindow() {
  mainWindow = new BrowserWindow({
    width: settings.WIDTH,
    height: settings.HEIGHT,
    minWidth: settings.MIN_WIDTH,
    minHeight: settings.MIN_HEIGHT,
    title: settings.WINDOW_TITLE,
    autoHideMenuBar: settings.AUTO_HIDE_MENU_BAR,
    fullscreen: settings.FULLSCREEN,
    icon: path.join(__dirname, 'assets', 'icono-multiplika.png'),
    backgroundColor: '#fafbfc',
    webPreferences: {
      preload: path.join(__dirname, 'shell', 'preload-shell.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  // Mantener nuestro título de ventana como autoritativo (que no lo pise el
  // <title> del documento del shell), para que el ajuste de título funcione.
  mainWindow.webContents.on('page-title-updated', (event) => event.preventDefault());
  mainWindow.setTitle(settings.WINDOW_TITLE);

  // La ventana carga la "cromo" de la app: barra de pestañas.
  mainWindow.loadFile(path.join(__dirname, 'shell', 'shell.html'));

  // Al arrancar no se abre ninguna pestaña (MST-01): se muestra directamente
  // el Panel de control. Las pestañas se abren a demanda (botón "+").
  let didInit = false;
  mainWindow.webContents.on('did-finish-load', () => {
    if (didInit) return;
    didInit = true;
    showOverlay('dashboard');
  });

  registerShortcuts(mainWindow.webContents);

  // Confirmar siempre antes de cerrar la aplicación.
  let allowClose = false;
  mainWindow.on('close', (event) => {
    if (allowClose) return;
    event.preventDefault();
    const choice = dialog.showMessageBoxSync(mainWindow, {
      type: 'question',
      buttons: ['Cancelar', 'Salir'],
      defaultId: 1,
      cancelId: 0,
      noLink: true,
      title: 'Salir de ' + settings.WINDOW_TITLE,
      message: '¿Seguro que quieres cerrar ' + settings.WINDOW_TITLE + '?'
    });
    if (choice === 1) {
      allowClose = true;
      mainWindow.close();
    }
  });

  mainWindow.on('resize', () => layoutCurrentView());

  mainWindow.on('closed', () => {
    mainWindow = null;
    tabs.clear();
    activeTabId = null;
    for (const v of [dashboardView, settingsView]) {
      if (!v) continue;
      try {
        if (typeof v.webContents.destroy === 'function') v.webContents.destroy();
      } catch (_) { /* ignorar */ }
    }
    dashboardView = null;
    settingsView = null;
    overlay = null;
  });
}

// ---------------------------------------------------------------------------
//  Gestión de pestañas
// ---------------------------------------------------------------------------
function createTab(url, appId) {
  const id = nextTabId++;

  const view = new WebContentsView({
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      // El preload corre también dentro de iframes: necesario cuando el
      // formulario de login está incrustado en un marco.
      nodeIntegrationInSubFrames: true,
      autoplayPolicy: 'no-user-gesture-required',
      zoomFactor: PAGE_ZOOM
    }
  });

  // App a la que pertenece la pestaña (para la captura de credenciales) y
  // origen con el que se abrió (para distinguir navegación interna de externa).
  view.__appId = appId || null;
  try { view.__origin = new URL(url).origin; } catch (_) { view.__origin = null; }

  const wc = view.webContents;

  // Enlaces que abren ventana nueva:
  //  - mismo dominio  -> nueva pestaña dentro de la app
  //  - dominio externo -> navegador del sistema
  wc.setWindowOpenHandler(({ url: target }) => {
    if (isInternal(target, view)) {
      createTab(target, view.__appId);
    } else if (settings.OPEN_EXTERNAL_LINKS_IN_BROWSER) {
      shell.openExternal(target);
    } else {
      createTab(target, view.__appId);
    }
    return { action: 'deny' };
  });

  // Navegación a dominio externo en la misma pestaña -> abrir fuera.
  wc.on('will-navigate', (event, target) => {
    if (settings.OPEN_EXTERNAL_LINKS_IN_BROWSER && !isInternal(target, view)) {
      event.preventDefault();
      shell.openExternal(target);
    }
  });

  // Actualizar la barra de pestañas cuando cambian título o navegación.
  wc.on('page-title-updated', () => sendTabsUpdate());
  wc.on('did-navigate', () => {
    view.__favicon = null; // al cambiar de página, esperar su nuevo favicon
    sendTabsUpdate();
  });
  wc.on('did-navigate-in-page', () => sendTabsUpdate());

  // Favicon de la página (MST-10): guardarlo y reflejarlo en la pestaña.
  wc.on('page-favicon-updated', (event, favicons) => {
    view.__favicon = (favicons && favicons.length) ? favicons[0] : null;
    sendTabsUpdate();
  });

  // Zoom al 80 % en cada página (MST-08). Chromium recuerda el zoom por
  // dominio, así que se fija en cada carga para que siempre sea el 80 %.
  wc.on('did-finish-load', () => {
    try { wc.setZoomFactor(PAGE_ZOOM); } catch (_) { /* ignorar */ }
  });

  // Página de error si falla la carga principal.
  wc.on('did-fail-load', (event, errorCode, errorDescription, validatedURL, isMainFrame) => {
    if (isMainFrame && errorCode !== -3) {
      wc.loadFile(path.join(__dirname, 'assets', 'error.html'), {
        query: { code: String(errorCode), desc: errorDescription }
      });
    }
  });

  registerShortcuts(wc);

  tabs.set(id, view);
  wc.loadURL(url);
  activateTab(id);
  sendTabsUpdate();
  return id;
}

function activateTab(id) {
  if (!tabs.has(id) || !mainWindow) return;

  // Si había una superposición visible (panel o ajustes), ocultarla.
  if (overlay) hideOverlay();

  // Quitar la vista activa anterior.
  if (activeTabId !== null && tabs.has(activeTabId)) {
    mainWindow.contentView.removeChildView(tabs.get(activeTabId));
  }

  activeTabId = id;
  const view = tabs.get(id);
  mainWindow.contentView.addChildView(view);
  layoutActiveView();
  view.webContents.focus();
  sendTabsUpdate();
}

function closeTab(id) {
  if (!tabs.has(id)) return;

  // Si es la última pestaña, no se cierra el programa: se destruye la pestaña
  // y se muestra el Panel de control.
  if (tabs.size === 1) {
    destroyTab(id);
    activeTabId = null;
    showOverlay('dashboard');
    return;
  }

  destroyTab(id);

  // Activar otra pestaña si cerramos la activa.
  if (activeTabId === id) {
    const remaining = Array.from(tabs.keys());
    activeTabId = null;
    activateTab(remaining[remaining.length - 1]);
  }
  sendTabsUpdate();
}

// Quitar una pestaña de la ventana y liberar sus recursos.
function destroyTab(id) {
  if (!tabs.has(id)) return;
  const view = tabs.get(id);
  if (activeTabId === id && mainWindow) {
    mainWindow.contentView.removeChildView(view);
  }
  try {
    if (typeof view.webContents.destroy === 'function') view.webContents.destroy();
  } catch (_) { /* ignorar si la versión de Electron no lo soporta */ }
  tabs.delete(id);
}

// Rectángulo disponible justo debajo de la barra de pestañas.
function contentBounds() {
  const [width, height] = mainWindow.getContentSize();
  return { x: 0, y: CHROME_HEIGHT, width: width, height: Math.max(0, height - CHROME_HEIGHT) };
}

// Colocar la vista activa justo debajo de la barra de pestañas.
function layoutActiveView() {
  if (activeTabId === null || !tabs.has(activeTabId) || !mainWindow) return;
  tabs.get(activeTabId).setBounds(contentBounds());
}

// Recolocar lo que esté visible ahora mismo (pestaña o superposición).
function layoutCurrentView() {
  const view = overlayView(overlay);
  if (view) { view.setBounds(contentBounds()); return; }
  layoutActiveView();
}

// ---------------------------------------------------------------------------
//  Superposiciones a pantalla completa: Panel de control y Ajustes
// ---------------------------------------------------------------------------

// Devuelve la vista asociada a un tipo de superposición ('dashboard'|'settings').
function overlayView(kind) {
  if (kind === 'dashboard') return dashboardView;
  if (kind === 'settings') return settingsView;
  return null;
}

// Crear (una sola vez) la vista de una superposición cargando su página local.
function ensureOverlayView(kind) {
  const existing = overlayView(kind);
  if (existing) return existing;

  // Cada superposición usa su puente: Ajustes -> settingsApi, Panel -> dashboardApi.
  const preload = kind === 'settings'
    ? path.join(__dirname, 'preload-settings.js')
    : kind === 'dashboard'
      ? path.join(__dirname, 'preload-dashboard.js')
      : path.join(__dirname, 'preload.js');

  const view = new WebContentsView({
    webPreferences: {
      preload,
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  registerShortcuts(view.webContents);
  const file = kind === 'settings' ? 'settings.html' : 'dashboard.html';
  view.webContents.loadFile(path.join(__dirname, 'assets', file));

  if (kind === 'settings') settingsView = view;
  else dashboardView = view;
  return view;
}

// Mostrar una superposición ocupando el área de contenido.
function showOverlay(kind) {
  if (!mainWindow) return;
  if (overlay === kind) return; // ya está visible

  const view = ensureOverlayView(kind);

  // Quitar lo que estuviera visible: la otra superposición o la pestaña activa.
  const current = overlayView(overlay);
  if (current) {
    mainWindow.contentView.removeChildView(current);
  } else if (activeTabId !== null && tabs.has(activeTabId)) {
    mainWindow.contentView.removeChildView(tabs.get(activeTabId));
  }

  mainWindow.contentView.addChildView(view);
  overlay = kind;
  view.setBounds(contentBounds());
  view.webContents.focus();
  if (kind === 'dashboard') sendDashboardApps();
  sendTabsUpdate();
}

// Ocultar la superposición visible (sin destruirla: se reutiliza).
function hideOverlay() {
  if (!overlay) return;
  const view = overlayView(overlay);
  if (view && mainWindow) mainWindow.contentView.removeChildView(view);
  overlay = null;
}

// ---------------------------------------------------------------------------
//  Ajustes: aplicar cambios en caliente
// ---------------------------------------------------------------------------
// `settings` (APP_URL y OPEN_EXTERNAL_LINKS_IN_BROWSER) se lee de forma
// dinámica en los handlers, así que esos cambios ya surten efecto solos.
// Aquí aplicamos lo que necesita una acción sobre la ventana. El tamaño
// INICIAL (WIDTH/HEIGHT) solo se usa al crear la ventana: se aplica al
// reiniciar.
function applySettings(next, prev) {
  if (!mainWindow || mainWindow.isDestroyed()) return;

  if (next.WINDOW_TITLE !== prev.WINDOW_TITLE) {
    mainWindow.setTitle(next.WINDOW_TITLE);
  }
  if (next.MIN_WIDTH !== prev.MIN_WIDTH || next.MIN_HEIGHT !== prev.MIN_HEIGHT) {
    mainWindow.setMinimumSize(next.MIN_WIDTH, next.MIN_HEIGHT);
  }
  if (next.AUTO_HIDE_MENU_BAR !== prev.AUTO_HIDE_MENU_BAR) {
    mainWindow.setAutoHideMenuBar(next.AUTO_HIDE_MENU_BAR);
    mainWindow.setMenuBarVisibility(!next.AUTO_HIDE_MENU_BAR);
  }
  if (next.FULLSCREEN !== prev.FULLSCREEN) {
    mainWindow.setFullScreen(next.FULLSCREEN);
  }
}

// Enviar el estado de las pestañas a la interfaz.
function sendTabsUpdate() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  const list = Array.from(tabs.entries()).map(([id, view]) => {
    const wc = view.webContents;
    let title = wc.getTitle();
    if (!title || title.trim() === '') title = 'Cargando…';
    return {
      id,
      title,
      favicon: view.__favicon || null,
      // Ninguna pestaña se marca activa mientras se ve una superposición.
      active: id === activeTabId && overlay === null,
      canGoBack: navCanGoBack(wc),
      canGoForward: navCanGoForward(wc)
    };
  });
  mainWindow.webContents.send('tabs:update', { tabs: list, overlay });
}

// ¿La navegación es "interna" (se queda dentro de la app) o externa (al navegador)?
// Interna = mismo origen que: la URL con la que se abrió la pestaña, la página
// actual (para flujos de login en varios dominios) o la URL base de la app.
function isInternal(target, view) {
  let origin;
  try { origin = new URL(target).origin; } catch (_) { return false; }
  if (view && view.__origin && origin === view.__origin) return true;
  try { if (view && origin === new URL(view.webContents.getURL()).origin) return true; } catch (_) { /* ignorar */ }
  try { if (origin === new URL(settings.APP_URL).origin) return true; } catch (_) { /* ignorar */ }
  return false;
}

// Helpers de navegación compatibles con distintas versiones de Electron.
// En unas versiones la API está en webContents.navigationHistory.* y en
// otras directamente en webContents.* (canGoBack/goBack, etc.).
function navCanGoBack(wc) {
  try {
    if (wc.navigationHistory && typeof wc.navigationHistory.canGoBack === 'function') return wc.navigationHistory.canGoBack();
    if (typeof wc.canGoBack === 'function') return wc.canGoBack();
  } catch (_) { /* ignorar */ }
  return false;
}
function navCanGoForward(wc) {
  try {
    if (wc.navigationHistory && typeof wc.navigationHistory.canGoForward === 'function') return wc.navigationHistory.canGoForward();
    if (typeof wc.canGoForward === 'function') return wc.canGoForward();
  } catch (_) { /* ignorar */ }
  return false;
}
function navGoBack(wc) {
  try {
    if (wc.navigationHistory && typeof wc.navigationHistory.goBack === 'function') { wc.navigationHistory.goBack(); return; }
    if (typeof wc.goBack === 'function') wc.goBack();
  } catch (_) { /* ignorar */ }
}
function navGoForward(wc) {
  try {
    if (wc.navigationHistory && typeof wc.navigationHistory.goForward === 'function') { wc.navigationHistory.goForward(); return; }
    if (typeof wc.goForward === 'function') wc.goForward();
  } catch (_) { /* ignorar */ }
}

// ---------------------------------------------------------------------------
//  Navegación (atrás / adelante / recargar) sobre la pestaña activa
// ---------------------------------------------------------------------------
function activeWebContents() {
  if (activeTabId === null || !tabs.has(activeTabId)) return null;
  return tabs.get(activeTabId).webContents;
}

function goBack() {
  const wc = activeWebContents();
  if (wc && navCanGoBack(wc)) navGoBack(wc);
}

function goForward() {
  const wc = activeWebContents();
  if (wc && navCanGoForward(wc)) navGoForward(wc);
}

function reloadActive() {
  const wc = activeWebContents();
  if (wc) wc.reload();
}

// ---------------------------------------------------------------------------
//  Atajos de teclado (funcionan tenga el foco el shell o una pestaña)
// ---------------------------------------------------------------------------
function registerShortcuts(webContents) {
  webContents.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown') return;
    const mod = process.platform === 'darwin' ? input.meta : input.control;
    if (!mod) return;
    const key = input.key.toLowerCase();
    if (key === 't') { event.preventDefault(); createTab(settings.APP_URL); }
    else if (key === 'w') { event.preventDefault(); if (activeTabId !== null) closeTab(activeTabId); }
    else if (key === 'r') { event.preventDefault(); reloadActive(); }
  });
}

// ---------------------------------------------------------------------------
//  IPC desde la interfaz (shell.html)
// ---------------------------------------------------------------------------
ipcMain.on('tab:new', () => createTab(settings.APP_URL));
ipcMain.on('tab:close', (event, id) => closeTab(id));
ipcMain.on('tab:activate', (event, id) => activateTab(id));
ipcMain.on('dashboard:open', () => showOverlay('dashboard'));
ipcMain.on('settings:open', () => showOverlay('settings'));
ipcMain.on('nav:back', () => goBack());
ipcMain.on('nav:forward', () => goForward());
ipcMain.on('nav:reload', () => reloadActive());

// Versión y fecha de la app (para Configuración → Actualizaciones).
ipcMain.handle('app:version', () => versionInfo);

// IPC de la vista de Ajustes (assets/settings.html vía preload-settings.js).
ipcMain.handle('settings:get', () => store.get());
ipcMain.handle('settings:defaults', () => store.getDefaults());
ipcMain.handle('settings:update', (event, patch) => {
  const prev = settings;
  settings = store.update(patch);
  applySettings(settings, prev);
  return settings;
});
ipcMain.handle('settings:reset', () => {
  const prev = settings;
  settings = store.reset();
  applySettings(settings, prev);
  return settings;
});

// A partir de Electron 36, PrinterInfo ya no incluye `isDefault`. Se deduce,
// si está disponible, del mapa `options` (dependiente de plataforma: en CUPS
// suele venir como 'printer-is-default'). Si no aparece, no se marca ninguna.
function isDefaultPrinter(p) {
  const o = p && p.options;
  if (!o || typeof o !== 'object') return false;
  const flag = o['printer-is-default'];
  return flag === 'true' || flag === true;
}

// Listado de impresoras disponibles en el equipo (para los selectores de
// la sección Impresoras). Devuelve [{ name, label, isDefault }].
ipcMain.handle('printers:list', async () => {
  try {
    if (!mainWindow || mainWindow.isDestroyed()) return [];
    const list = await mainWindow.webContents.getPrintersAsync();
    return list.map((p) => ({
      name: p.name,
      label: p.displayName || p.name,
      isDefault: isDefaultPrinter(p)
    }));
  } catch (_) {
    return [];
  }
});

// ---------------------------------------------------------------------------
//  IPC de las aplicaciones del Panel de control (assets/dashboard.html)
// ---------------------------------------------------------------------------
// Lista de apps con su URL configurada y si deben mostrarse en el Panel.
function dashboardApps() {
  return APPS.map((a) => ({ id: a.id, url: settings[a.urlKey] || '', show: settings[a.showKey] !== false }));
}

// Reenviar la lista al Panel de control para reflejar cambios de visibilidad sin
// reiniciar (la vista del panel se crea una vez y se reutiliza).
function sendDashboardApps() {
  if (dashboardView && !dashboardView.webContents.isDestroyed()) {
    dashboardView.webContents.send('apps:update', dashboardApps());
  }
}

ipcMain.handle('apps:list', () => dashboardApps());

// Guardar la URL de una app (cuando se pide al pulsar una sin configurar).
ipcMain.handle('apps:set-url', (event, payload) => {
  const app = APPS.find((a) => a.id === (payload && payload.id));
  if (!app) return null;
  const patch = {};
  patch[app.urlKey] = (payload && payload.url) || '';
  settings = store.update(patch);
  return { id: app.id, url: settings[app.urlKey] };
});

// Abrir la URL de una app en una pestaña nueva.
ipcMain.on('apps:open', (event, id) => {
  const app = APPS.find((a) => a.id === id);
  if (!app) return;
  const url = settings[app.urlKey];
  if (url) createTab(url, app.id);
});

// Credenciales guardadas por app (cifradas con el llavero del sistema).
ipcMain.handle('creds:list', (event, appId) => creds.list(appId));
ipcMain.handle('creds:add', (event, p) => creds.add(p && p.appId, p && p.user, p && p.password));
ipcMain.on('creds:remove', (event, p) => { if (p) creds.remove(p.appId, p.id); });

// Estado del almacenamiento seguro (para el indicador de Ajustes, H-03).
ipcMain.handle('creds:secure-status', () => creds.secureStatus());

// Credenciales de la app dueña de ESTA pestaña (para autocompletar el login).
ipcMain.handle('creds:for-tab', (event) => {
  const view = viewForContents(event.sender);
  if (!view || !view.__appId) return [];
  // Solo el frame principal de la app (o subframes del mismo origen) recibe
  // credenciales; nunca un iframe de terceros incrustado en la página (H-02).
  if (!isTrustedFrame(event.senderFrame, view)) return [];
  return creds.list(view.__appId);
});


// ---------------------------------------------------------------------------
//  Soporte: WhatsApp y descarga de RustDesk
// ---------------------------------------------------------------------------
const SUPPORT_EMAIL = 'soporte@multiplika.es';
const SUPPORT_WHATSAPP = '34955312020'; // 95 531 20 20 (España)

// Abrir el cliente de correo del equipo para redactar directamente a soporte.
ipcMain.on('support:email', () => {
  shell.openExternal('mailto:' + SUPPORT_EMAIL).catch(() => {});
});

// Abrir WhatsApp directamente (app instalada); si no está, la web wa.me.
ipcMain.on('support:whatsapp', () => {
  shell.openExternal('whatsapp://send?phone=' + SUPPORT_WHATSAPP)
    .catch(() => shell.openExternal('https://wa.me/' + SUPPORT_WHATSAPP).catch(() => {}));
});

// Marcador: la próxima descarga la hemos iniciado nosotros (RustDesk) y se
// guarda sola en Descargas; el resto de descargas siguen su curso normal.
let autoDownload = false;

// Descargar el instalador de RustDesk adecuado para este equipo.
// La versión se averigua siguiendo la redirección de "releases/latest"
// (sin usar la API de GitHub, que tiene límite de peticiones).
ipcMain.handle('support:download-rustdesk', async () => {
  try {
    const res = await fetch('https://github.com/rustdesk/rustdesk/releases/latest', { redirect: 'manual' });
    const loc = res.headers.get('location') || '';
    const m = loc.match(/\/tag\/([^/]+)$/);
    if (!m) throw new Error('no se pudo determinar la última versión');
    const ver = m[1];

    let name = null;
    if (process.platform === 'win32') {
      name = `rustdesk-${ver}-x86_64.exe`;
    } else if (process.platform === 'darwin') {
      name = process.arch === 'arm64' ? `rustdesk-${ver}-aarch64.dmg` : `rustdesk-${ver}-x86_64.dmg`;
    } else {
      name = `rustdesk-${ver}-x86_64.AppImage`;
    }
    if (!mainWindow || mainWindow.isDestroyed()) throw new Error('sin ventana');

    const url = `https://github.com/rustdesk/rustdesk/releases/download/${ver}/${name}`;
    autoDownload = true;
    mainWindow.webContents.downloadURL(url);
    return { ok: true, name: name };
  } catch (err) {
    // Respaldo: abrir la página oficial de descargas.
    shell.openExternal('https://rustdesk.com/download').catch(() => {});
    return { ok: false };
  }
});

// Credencial capturada al iniciar sesión en la pestaña de una app.
// Como en los navegadores: si es una cuenta nueva se ofrece guardarla; si el
// usuario ya existe con otra contraseña, se ofrece actualizarla; si ya está
// guardada exactamente igual, no se molesta.
ipcMain.on('creds:captured', (event, payload) => {
  const view = viewForContents(event.sender);
  if (!payload || !payload.password) return;
  if (!view || !view.__appId) return; // solo se captura en pestañas de una app conocida
  // No capturar credenciales tecleadas dentro de un iframe de terceros (H-02).
  if (!isTrustedFrame(event.senderFrame, view)) return;
  processCaptured(view.__appId, payload.user || '', payload.password);
});

// Decidir qué hacer con una credencial capturada (guardar/actualizar/nada).
function processCaptured(appId, user, password) {
  // Comparación tolerante: ignora mayúsculas/minúsculas y espacios sobrantes.
  const norm = (s) => String(s || '').trim().toLowerCase();
  const list = creds.list(appId);
  let existing = list.find((c) => norm(c.user) === norm(user));

  // Si la web no expone el usuario (p. ej. solo pide la contraseña) y hay una
  // única cuenta guardada, se asume que es esa.
  if (!existing && !norm(user) && list.length === 1) {
    existing = list[0];
    user = existing.user;
  }

  if (existing && existing.password === password) return; // ya guardada igual: no preguntar
  promptSaveCredential(appId, existing ? existing.user : user, password, !!existing);
}

// Devuelve la vista (WebContentsView) dueña de un webContents (o null).
function viewForContents(wc) {
  for (const view of tabs.values()) {
    if (view.webContents === wc) return view;
  }
  return null;
}

// ¿El frame que envía el IPC pertenece a un origen de confianza de la app?
// (H-02) El preload de credenciales corre también en los iframes de la página
// (nodeIntegrationInSubFrames). Esto evita que un iframe de OTRO origen
// (anuncios, chats, widgets, un tercero comprometido) reciba las contraseñas
// guardadas o dispare su guardado: solo se confía en el propio origen de la
// app / la pestaña. Si algún flujo de login legítimo vive en un iframe de otro
// dominio (p. ej. SSO), añade ese origen a la lógica de isInternal.
function isTrustedFrame(frame, view) {
  try {
    if (!frame || !frame.url) return false;
    return isInternal(frame.url, view);
  } catch (_) {
    return false;
  }
}

// Preguntar (como Chrome) si se guarda o actualiza la contraseña.
// Si llega otra captura mientras el diálogo está abierto, no se pierde: se
// reevalúa al cerrar (por si el usuario corrigió la contraseña entre medias).
let credPromptOpen = false;
let pendingCapture = null;
async function promptSaveCredential(appId, user, password, isUpdate) {
  if (credPromptOpen) {
    pendingCapture = { appId, user, password };
    return;
  }
  const app = APPS.find((a) => a.id === appId);
  if (!app || !mainWindow || mainWindow.isDestroyed()) return;
  credPromptOpen = true;
  try {
    const { response } = await dialog.showMessageBox(mainWindow, {
      type: 'question',
      buttons: ['Ahora no', isUpdate ? 'Actualizar' : 'Guardar'],
      defaultId: 1,
      cancelId: 0,
      noLink: true,
      title: isUpdate ? 'Actualizar contraseña' : 'Guardar contraseña',
      message: isUpdate
        ? '¿Actualizar la contraseña guardada para ' + app.name + '?'
        : '¿Guardar la contraseña para ' + app.name + '?',
      detail: user ? ('Usuario: ' + user) : ''
    });
    if (response === 1) creds.save(appId, user, password);
  } finally {
    credPromptOpen = false;
    if (pendingCapture) {
      const p = pendingCapture;
      pendingCapture = null;
      // Reevaluar contra el estado ya actualizado (evita preguntar de más).
      processCaptured(p.appId, p.user, p.password);
    }
  }
}

// La página de error (assets/error.html) pide recargar su propia pestaña.
ipcMain.on('retry-load', (event) => {
  for (const view of tabs.values()) {
    if (view.webContents === event.sender) {
      view.webContents.loadURL(settings.APP_URL);
      return;
    }
  }
});

// ---------------------------------------------------------------------------
//  API local de la Station (puente con LEIA + agente Claude Code)
// ---------------------------------------------------------------------------
// Diálogo nativo para elegir la carpeta de trabajo del agente. Lo invoca la
// Station (station/agent.js) a través del callback `elegirCarpeta` del server.
async function elegirCarpetaTrabajo() {
  if (!mainWindow || mainWindow.isDestroyed()) return null;
  const r = await dialog.showOpenDialog(mainWindow, {
    title: 'Carpeta de trabajo del agente',
    properties: ['openDirectory', 'createDirectory']
  });
  if (r.canceled || !r.filePaths || !r.filePaths.length) return null;
  return r.filePaths[0];
}

// El preload de cada pestaña pide este puente por IPC SÍNCRONO (antes del JS de
// la página). Solo se entrega a pestañas de LEIA — nunca a webs de terceros —,
// para no exponer el token de la API local. Ver preload.js.
ipcMain.on('station:bridge-info', (event) => {
  let ok = false;
  try {
    const view = viewForContents(event.sender);
    // El token de la API local solo se entrega al frame PROPIO de una pestaña de
    // LEIA: la pestaña tiene que ser de la app LEIA (__appId) Y, además, el frame
    // que lo pide tiene que ser del mismo origen (isTrustedFrame, igual que la
    // captura de credenciales). Con nodeIntegrationInSubFrames el preload corre
    // también en iframes: sin el chequeo por frame, un iframe de terceros
    // incrustado en LEIA recibiría el token. isTrustedFrame lo impide.
    ok = !!(view && view.__appId === 'leia' && isTrustedFrame(event.senderFrame, view));
  } catch (_) { /* ignore */ }
  event.returnValue = (ok && stationApi)
    ? { baseUrl: stationApi.baseUrl, token: stationApi.token, version: versionInfo.version || '', app: 'leia', equipo: os.hostname() }
    : null;
});

// ---------------------------------------------------------------------------
//  Ciclo de vida de la app
// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------
//  Identidad de la app (MST-09): sin rastro de "Electron"
// ---------------------------------------------------------------------------
function setupAppIdentity() {
  // Panel "Acerca de": nombre, versión propia y fecha de actualización.
  app.setAboutPanelOptions({
    applicationName: 'Multiplika Station',
    applicationVersion: versionInfo.version || app.getVersion(),
    version: versionInfo.date || '',
    copyright: '© Multiplika'
  });

  // Identificador de app en Windows (barra de tareas / notificaciones).
  if (process.platform === 'win32') {
    app.setAppUserModelId('net.multiplika.apiadev');
  }

  // Icono del dock en macOS (útil en desarrollo; el empaquetado ya usa el suyo).
  if (process.platform === 'darwin' && app.dock) {
    try { app.dock.setIcon(path.join(__dirname, 'assets', 'icono-multiplika.png')); } catch (_) { /* ignorar */ }
  }

  // Menú de aplicación propio, en español y sin elementos de "Electron".
  const isMac = process.platform === 'darwin';
  const template = [];
  if (isMac) {
    template.push({
      label: 'Multiplika',
      submenu: [
        { role: 'about', label: 'Acerca de Multiplika' },
        { type: 'separator' },
        { role: 'hide', label: 'Ocultar Multiplika' },
        { role: 'hideOthers', label: 'Ocultar otros' },
        { role: 'unhide', label: 'Mostrar todo' },
        { type: 'separator' },
        { role: 'quit', label: 'Salir de Multiplika' }
      ]
    });
  }
  template.push({
    label: 'Edición',
    submenu: [
      { role: 'undo', label: 'Deshacer' },
      { role: 'redo', label: 'Rehacer' },
      { type: 'separator' },
      { role: 'cut', label: 'Cortar' },
      { role: 'copy', label: 'Copiar' },
      { role: 'paste', label: 'Pegar' },
      { role: 'selectAll', label: 'Seleccionar todo' }
    ]
  });
  template.push({
    label: 'Ver',
    submenu: [
      { role: 'togglefullscreen', label: 'Pantalla completa' }
    ]
  });
  template.push({
    label: 'Ventana',
    submenu: [
      { role: 'minimize', label: 'Minimizar' },
      { role: 'close', label: 'Cerrar ventana' }
    ]
  });
  if (!isMac) {
    template.push({
      label: 'Ayuda',
      submenu: [
        { role: 'about', label: 'Acerca de Multiplika' }
      ]
    });
  }
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// ---------------------------------------------------------------------------
//  Autoactualización (electron-updater · feed propio tipo "generic")  [MST-02]
// ---------------------------------------------------------------------------
// Modelado del cliente de Multiplika Support: electron-updater descarga e instala
// el instalador nuevo desde el feed configurado en package.json (build.publish,
// provider "generic"), que sirve por HTTPS latest.yml + el .exe + su .blockmap.
// El feed se publica con: npm run publish:win (scripts/publish.js). Solo funciona
// en la app instalada (app.isPackaged); en desarrollo no hace nada.
let autoUpdater = null;
// estado: idle | comprobando | descargando | listo | al-dia | error
let updateState = { estado: 'idle', version: '' };

function sendUpdateState() {
  if (settingsView && !settingsView.webContents.isDestroyed()) {
    settingsView.webContents.send('update:state', updateState);
  }
}
function setUpdateState(estado, extra) {
  updateState = Object.assign({ estado, version: updateState.version || '' }, extra || {});
  sendUpdateState();
}

function setupUpdater() {
  if (!app.isPackaged) return; // solo en la app instalada
  try {
    autoUpdater = require('electron-updater').autoUpdater;
    autoUpdater.autoDownload = true;         // descarga sola la versión nueva
    autoUpdater.autoInstallOnAppQuit = true; // y la instala al cerrar la app
    autoUpdater.on('checking-for-update', () => setUpdateState('comprobando'));
    autoUpdater.on('update-available', (info) => setUpdateState('descargando', { version: (info && info.version) || '' }));
    autoUpdater.on('update-not-available', () => setUpdateState('al-dia'));
    autoUpdater.on('download-progress', (p) => setUpdateState('descargando', { porcentaje: Math.round((p && p.percent) || 0) }));
    autoUpdater.on('update-downloaded', (info) => setUpdateState('listo', { version: (info && info.version) || '' }));
    autoUpdater.on('error', (e) => setUpdateState('error', { msg: (e && e.message) || String(e) }));
    autoUpdater.checkForUpdates().catch(() => {});
  } catch (e) {
    console.error('[updater] no se pudo iniciar:', (e && e.message) || e);
  }
}

// IPC de la sección Actualizaciones (assets/settings.html).
ipcMain.handle('update:state', () => updateState);
ipcMain.handle('update:check', async () => {
  if (!app.isPackaged) return { ok: false, msg: 'Las actualizaciones solo funcionan en la app instalada.' };
  if (!autoUpdater) return { ok: false, msg: 'El actualizador no está disponible.' };
  try { await autoUpdater.checkForUpdates(); return { ok: true }; }
  catch (e) { setUpdateState('error', { msg: (e && e.message) || String(e) }); return { ok: false, msg: (e && e.message) || String(e) }; }
});
ipcMain.handle('update:install', async () => {
  if (autoUpdater && updateState.estado === 'listo') {
    // Antes de instalar, apagar el descargador: si siguiera en marcha, el instalador no
    // podría reemplazar sus ficheros y la actualización fallaría.
    await descargador.apagar().catch(() => {});
    setImmediate(() => { try { autoUpdater.quitAndInstall(true, true); } catch (_) {} });
    return { ok: true };
  }
  return { ok: false };
});

app.whenReady().then(async () => {
  settings = store.get(); // cargar ajustes (defaults + guardados) antes de crear la ventana
  setupAppIdentity();

  // Arranca la API local de la Station (loopback HTTPS). Carpeta de trabajo por
  // defecto: ~/.multiplika (el agente y el FS trabajan ahí salvo que se elija otra).
  try {
    stationApi = await startStationServer({
      version: versionInfo.version || '',
      equipo: os.hostname(),
      workRoot: path.join(os.homedir(), '.multiplika'),
      elegirCarpeta: elegirCarpetaTrabajo,
      asegurarDescargador: () => descargador.asegurar()
    });
  } catch (e) {
    console.error('[station] la API local no arrancó:', (e && e.message) || e);
  }

  // Enciende el descargador de modelos ya al arrancar (sin esperar), para que la primera
  // descarga no pague el arranque. Si falla, se reintenta al pedir una descarga.
  descargador.asegurar().then((r) => {
    if (!r.ok) console.warn('[descargador]', r.motivo);
  });

  // El servidor local usa un certificado autofirmado: LEIA (https) lo consume por
  // fetch, así que hay que aceptar el cert SOLO para su host:puerto (loopback).
  app.on('certificate-error', (event, webContents, url, error, cert, callback) => {
    if (stationApi && url.indexOf('https://127.0.0.1:' + stationApi.port) === 0) {
      event.preventDefault();
      callback(true);
    } else {
      callback(false);
    }
  });

  // Descargas iniciadas por la app (RustDesk): guardarlas en Descargas sin
  // preguntar y avisar al terminar. Las demás descargas no se tocan.
  session.defaultSession.on('will-download', (event, item) => {
    if (!autoDownload) return;
    autoDownload = false;
    const dest = path.join(app.getPath('downloads'), item.getFilename());
    item.setSavePath(dest);
    item.once('done', (event2, state) => {
      if (!mainWindow || mainWindow.isDestroyed()) return;
      if (state === 'completed') {
        dialog.showMessageBox(mainWindow, {
          type: 'info',
          buttons: ['Cerrar', 'Mostrar en carpeta', 'Abrir instalador'],
          defaultId: 2,
          cancelId: 0,
          noLink: true,
          title: 'RustDesk descargado',
          message: 'RustDesk se ha descargado en tu carpeta de Descargas.',
          detail: item.getFilename()
        }).then(({ response }) => {
          if (response === 1) shell.showItemInFolder(dest);
          else if (response === 2) shell.openPath(dest).catch(() => {});
        });
      } else {
        dialog.showMessageBox(mainWindow, {
          type: 'error',
          buttons: ['Cerrar'],
          noLink: true,
          title: 'Descarga fallida',
          message: 'No se pudo completar la descarga de RustDesk.'
        });
      }
    });
  });

  createWindow();
  setupUpdater();
  // Reintentar la comprobación cada 6 h (es barato; si no hay novedad, nada cambia).
  setInterval(() => { if (autoUpdater) autoUpdater.checkForUpdates().catch(() => {}); }, 6 * 60 * 60 * 1000);
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  try { if (stationApi) stationApi.close(); } catch (_) { /* ignore */ }
  if (process.platform !== 'darwin') app.quit();
});

// Al salir, apagar el descargador que encendió Station (Windows no cierra los procesos
// hijos con el padre). Se retiene la salida hasta que termine (máx. ~4 s) y se reanuda.
let descargadorApagado = false;
app.on('before-quit', (event) => {
  if (descargadorApagado || !descargador.propio) return;
  event.preventDefault();
  descargador.apagar().catch(() => {}).finally(() => {
    descargadorApagado = true;
    app.quit();
  });
});
