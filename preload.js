const { contextBridge, ipcRenderer } = require('electron');

// Puente mínimo y seguro entre la interfaz y el proceso principal.
// Solo se expone lo estrictamente necesario para la página de error.
contextBridge.exposeInMainWorld('appBridge', {
  retry: () => ipcRenderer.send('retry-load')
});

// ---------------------------------------------------------------------------
//  Puente con la API local de la Station (solo en pestañas de LEIA).
//  main.js decide si esta pestaña es de LEIA y, en tal caso, devuelve los datos
//  de la API local (baseUrl + token). Se expone como window.__MULTIPLIKA_STATION__
//  ANTES del JS de la página (el preload corre antes que los scripts), que es lo
//  que LEIA espera (src/api/services/stationService.js).
// ---------------------------------------------------------------------------
try {
  const st = ipcRenderer.sendSync('station:bridge-info');
  if (st && st.baseUrl) {
    contextBridge.exposeInMainWorld('__MULTIPLIKA_STATION__', {
      baseUrl: st.baseUrl,
      token: st.token,
      version: st.version,
      app: st.app,
      equipo: st.equipo
    });
  }
} catch (_) { /* sin Station: LEIA degrada a navegador normal */ }

// ===========================================================================
//  Gestor de credenciales (estilo navegador)
//
//  Guardar/actualizar:
//   - Se recuerda lo que el usuario teclea en los campos de login.
//   - Al enviar (submit/Enter/clic) o al navegar la página tras el login,
//     se manda al proceso principal, que compara con lo guardado y pregunta
//     "¿Guardar?" o "¿Actualizar?" solo cuando procede.
//
//  Sugerencias:
//   - Al enfocar el campo de usuario o contraseña se muestra un desplegable
//     con las cuentas guardadas; al elegir una se rellenan ambos campos.
//
//  Robustez:
//   - Busca campos también dentro de shadow DOM (web components).
//   - Sondea la página de forma continua (webs SPA que pintan tarde).
//   - El menú se estila solo con estilos en línea vía JS (ninguna CSP lo bloquea).
// ===========================================================================

// ---------------------------------------------------------------------------
//  Utilidades de búsqueda (documento + shadow DOM abiertos)
// ---------------------------------------------------------------------------
function allInputsDeep() {
  const out = [];
  const seen = new Set();
  function walk(root) {
    if (!root || seen.has(root)) return;
    seen.add(root);
    let inputs = [];
    try { inputs = root.querySelectorAll('input'); } catch (_) { return; }
    inputs.forEach((el) => out.push(el));
    let hosts = [];
    try { hosts = root.querySelectorAll('*'); } catch (_) { return; }
    hosts.forEach((el) => { if (el.shadowRoot) walk(el.shadowRoot); });
  }
  walk(document);
  return out;
}

function passwordInputs() {
  // Rápido primero; si no hay, búsqueda profunda (shadow DOM).
  const shallow = Array.from(document.querySelectorAll('input[type="password"]'));
  if (shallow.length) return shallow;
  return allInputsDeep().filter((el) => (el.type || '').toLowerCase() === 'password');
}

const isUserField = (el) => {
  const t = (el.type || 'text').toLowerCase();
  return t === 'text' || t === 'email' || t === 'tel';
};

// Inputs del mismo ámbito que `el` (su formulario o su raíz shadow/documento).
function scopeInputs(el) {
  if (el.form) return Array.from(el.form.querySelectorAll('input'));
  const root = typeof el.getRootNode === 'function' ? el.getRootNode() : document;
  try { return Array.from(root.querySelectorAll('input')); } catch (_) { return []; }
}

// Campo de usuario asociado a un campo de contraseña.
function userFieldFor(pw) {
  const inputs = scopeInputs(pw);
  const idx = inputs.indexOf(pw);
  for (let i = idx - 1; i >= 0; i--) {
    if (isUserField(inputs[i])) return inputs[i];
  }
  return inputs.find(isUserField) || null;
}

// Campo de contraseña asociado a un campo de usuario.
function passwordFieldFor(userEl) {
  const inputs = scopeInputs(userEl);
  const idx = inputs.indexOf(userEl);
  for (let i = idx + 1; i < inputs.length; i++) {
    if ((inputs[i].type || '').toLowerCase() === 'password') return inputs[i];
  }
  return inputs.find((el) => (el.type || '').toLowerCase() === 'password') || null;
}

// Asignar valor avisando a la página (React/Vue lo requieren).
function setNativeValue(el, value) {
  try {
    const desc = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), 'value');
    if (desc && desc.set) desc.set.call(el, value);
    else el.value = value;
  } catch (_) {
    el.value = value;
  }
  el.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
  el.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
}

// Objetivo real de un evento (atraviesa shadow DOM).
function realTarget(event) {
  try {
    if (typeof event.composedPath === 'function') {
      const p = event.composedPath();
      if (p && p.length) return p[0];
    }
  } catch (_) { /* ignorar */ }
  return event.target;
}

// ---------------------------------------------------------------------------
//  Captura: recordar lo tecleado y enviarlo al confirmar/navegar
// ---------------------------------------------------------------------------
let typed = { user: '', password: '' };
let lastSent = '';
let lastSentAt = 0;

document.addEventListener('input', (event) => {
  const t = realTarget(event);
  if (!t || t.tagName !== 'INPUT') return;
  const type = (t.type || 'text').toLowerCase();
  if (type === 'password') {
    typed.password = t.value;
    const u = userFieldFor(t);
    if (u && u.value) typed.user = u.value;
  } else if (isUserField(t) && t.value) {
    // Solo tomarlo como usuario si hay un campo de contraseña en su ámbito.
    if (passwordFieldFor(t)) typed.user = t.value;
  }
}, true);

function currentCredentials() {
  // Preferir lo que haya AHORA en el DOM; si no, lo último tecleado.
  const pws = passwordInputs();
  const pw = pws.find((p) => p.value) || null;
  if (pw) {
    const u = userFieldFor(pw);
    return { user: (u && u.value) || typed.user || '', password: pw.value };
  }
  if (typed.password) return { user: typed.user || '', password: typed.password };
  return null;
}

function sendCapture(reason) {
  try {
    const cred = currentCredentials();
    if (!cred || !cred.password) return;
    const key = cred.user + ' ' + cred.password;
    const now = Date.now();
    // Amortiguar solo la rafaga del mismo envio (clic + submit + navegacion):
    // pasados 3 s, el mismo par puede volver a enviarse (como en Chrome, que
    // re-pregunta en cada intento de login).
    if (key === lastSent && (now - lastSentAt) < 3000) return;
    lastSent = key;
    lastSentAt = now;
    ipcRenderer.send('creds:captured', cred);
  } catch (_) { /* nunca interrumpir la página */ }
}

document.addEventListener('submit', () => sendCapture('submit'), true);
document.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') setTimeout(() => sendCapture('enter'), 50);
}, true);
document.addEventListener('click', (event) => {
  const t = realTarget(event);
  const btn = t && typeof t.closest === 'function'
    ? t.closest('button, input[type="submit"], input[type="button"], [role="button"], a')
    : null;
  if (btn) setTimeout(() => sendCapture('clic'), 50);
}, true);
// Al navegar tras el login (el caso típico): capturar lo tecleado.
window.addEventListener('pagehide', () => sendCapture('navegacion'), true);

// ---------------------------------------------------------------------------
//  Desplegable de cuentas guardadas (estilos 100% en línea: inmune a CSP)
// ---------------------------------------------------------------------------
let menuEl = null;
let menuAnchor = null;

function isDark() {
  try { return window.matchMedia('(prefers-color-scheme: dark)').matches; } catch (_) { return false; }
}

function buildMenu() {
  if (menuEl) return menuEl;
  menuEl = document.createElement('div');
  const s = menuEl.style;
  s.position = 'fixed';
  s.zIndex = '2147483647';
  s.display = 'none';
  s.fontFamily = '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif';
  s.borderRadius = '10px';
  s.padding = '4px';
  s.maxHeight = '260px';
  s.overflowY = 'auto';
  s.minWidth = '200px';
  (document.body || document.documentElement).appendChild(menuEl);

  document.addEventListener('mousedown', (event) => {
    const t = realTarget(event);
    if (t !== menuAnchor && menuEl && !menuEl.contains(t)) hideMenu();
  }, true);
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') hideMenu();
  }, true);
  window.addEventListener('scroll', repositionMenu, true);
  window.addEventListener('resize', repositionMenu, true);
  return menuEl;
}

function applyMenuTheme() {
  const dark = isDark();
  const s = menuEl.style;
  s.background = dark ? '#26282c' : '#ffffff';
  s.color = dark ? '#f5f6f7' : '#1a1c1e';
  s.border = '1px solid ' + (dark ? 'rgba(255,255,255,0.14)' : 'rgba(0,0,0,0.12)');
  s.boxShadow = dark ? '0 8px 24px rgba(0,0,0,0.6)' : '0 8px 24px rgba(0,0,0,0.18)';
}

function repositionMenu() {
  if (!menuEl || menuEl.style.display === 'none' || !menuAnchor) return;
  const r = menuAnchor.getBoundingClientRect();
  menuEl.style.top = (r.bottom + 2) + 'px';
  menuEl.style.left = r.left + 'px';
  menuEl.style.minWidth = Math.max(200, r.width) + 'px';
}

function hideMenu() {
  if (menuEl) menuEl.style.display = 'none';
  menuAnchor = null;
}

function showMenu(anchor, userEl, pwEl, list) {
  buildMenu();
  applyMenuTheme();
  menuAnchor = anchor;
  menuEl.textContent = '';
  const dark = isDark();

  const hdr = document.createElement('div');
  hdr.textContent = 'Contraseñas guardadas';
  const hs = hdr.style;
  hs.fontSize = '11px'; hs.fontWeight = '700'; hs.letterSpacing = '0.5px';
  hs.textTransform = 'uppercase'; hs.padding = '6px 10px 4px';
  hs.color = dark ? '#9aa0a6' : '#8a9098';
  menuEl.appendChild(hdr);

  list.forEach((c) => {
    const item = document.createElement('div');
    const is = item.style;
    is.display = 'flex'; is.flexDirection = 'column'; is.gap = '1px';
    is.padding = '8px 10px'; is.borderRadius = '7px'; is.cursor = 'pointer';

    const u = document.createElement('div');
    u.textContent = c.user || '(sin usuario)';
    u.style.fontSize = '13px'; u.style.fontWeight = '600'; u.style.whiteSpace = 'nowrap';

    const p = document.createElement('div');
    p.textContent = '••••••••';
    p.style.fontSize = '12px'; p.style.letterSpacing = '1px';
    p.style.color = dark ? '#9aa0a6' : '#6a7078';

    item.appendChild(u);
    item.appendChild(p);
    item.addEventListener('mouseenter', () => { is.background = dark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)'; });
    item.addEventListener('mouseleave', () => { is.background = 'transparent'; });
    item.addEventListener('mousedown', (e) => e.preventDefault());
    item.addEventListener('click', () => {
      if (userEl && c.user) setNativeValue(userEl, c.user);
      if (pwEl && c.password) setNativeValue(pwEl, c.password);
      hideMenu();
    });
    menuEl.appendChild(item);
  });

  menuEl.style.display = 'block';
  repositionMenu();
}

// ---------------------------------------------------------------------------
//  Enganche: al enfocar un campo de login, ofrecer las cuentas guardadas
// ---------------------------------------------------------------------------
async function fetchCreds() {
  try { return (await ipcRenderer.invoke('creds:for-tab')) || []; } catch (_) { return []; }
}

async function maybeOffer(field) {
  const type = (field.type || 'text').toLowerCase();
  let userEl = null, pwEl = null;
  if (type === 'password') {
    pwEl = field;
    userEl = userFieldFor(field);
  } else if (isUserField(field)) {
    pwEl = passwordFieldFor(field);
    if (!pwEl) return; // no es un campo de login
    userEl = field;
  } else {
    return;
  }
  const list = await fetchCreds();
  if (!list.length) return;
  if (document.activeElement !== field && !fieldHasFocusDeep(field)) return; // el foco cambió mientras tanto
  showMenu(field, userEl, pwEl, list);
}

// activeElement con shadow DOM: bajar hasta el elemento realmente enfocado.
function fieldHasFocusDeep(field) {
  let a = document.activeElement;
  const hops = 10;
  for (let i = 0; i < hops && a && a.shadowRoot && a.shadowRoot.activeElement; i++) {
    a = a.shadowRoot.activeElement;
  }
  return a === field;
}

document.addEventListener('focusin', (event) => {
  const t = realTarget(event);
  if (t && t.tagName === 'INPUT') maybeOffer(t);
}, true);
document.addEventListener('click', (event) => {
  const t = realTarget(event);
  if (t && t.tagName === 'INPUT') maybeOffer(t);
}, true);

