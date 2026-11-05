// Lógica de la vista de Ajustes. Habla con el proceso principal a través de
// window.settingsApi (definido en preload-settings.js).

// Claves con campo en esta pantalla (deben coincidir con los id de los
// elementos). El resto de ajustes existen en el almacén pero no se editan aquí.
const KEYS = ['FULLSCREEN', 'PRINTER_DOCUMENTS', 'PRINTER_TICKETS', 'SHOW_ERP', 'SHOW_PLUS', 'SHOW_LEIA'];
const BOOLEAN = ['FULLSCREEN', 'SHOW_ERP', 'SHOW_PLUS', 'SHOW_LEIA'];
const NUMERIC = [];
const PRINTER_SELECTS = ['PRINTER_DOCUMENTS', 'PRINTER_TICKETS'];

const el = {};
KEYS.forEach((k) => { el[k] = document.getElementById(k); });

const saveBtn = document.getElementById('saveBtn');
const statusEl = document.getElementById('status');

// ---------------------------------------------------------------------------
//  Menú lateral: navegación por secciones + resaltado según scroll
// ---------------------------------------------------------------------------
const content = document.getElementById('content');
const navItems = Array.from(document.querySelectorAll('.nav-item'));
const sections = navItems
  .map((a) => document.getElementById(a.dataset.target))
  .filter(Boolean);

function setActive(id) {
  navItems.forEach((a) => a.classList.toggle('active', a.dataset.target === id));
}

navItems.forEach((a) => {
  a.addEventListener('click', (e) => {
    e.preventDefault();
    const target = document.getElementById(a.dataset.target);
    if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
    setActive(a.dataset.target);
  });
});

function updateActiveOnScroll() {
  if (!sections.length) return;
  if (content.scrollTop + content.clientHeight >= content.scrollHeight - 4) {
    setActive(sections[sections.length - 1].id);
    return;
  }
  const reference = content.scrollTop + 80;
  let currentId = sections[0].id;
  for (const s of sections) {
    if (s.offsetTop <= reference) currentId = s.id;
  }
  setActive(currentId);
}
content.addEventListener('scroll', updateActiveOnScroll);

// ---------------------------------------------------------------------------
//  Impresoras
// ---------------------------------------------------------------------------
function optionEl(value, label) {
  const o = document.createElement('option');
  o.value = value;
  o.textContent = label;
  return o;
}

// Rellenar los desplegables con las impresoras del equipo.
function populatePrinters(printers) {
  PRINTER_SELECTS.forEach((k) => {
    const sel = el[k];
    if (!sel) return;
    sel.innerHTML = '';
    sel.appendChild(optionEl('', 'Predeterminada del sistema'));
    (printers || []).forEach((p) => {
      const label = p.label + (p.isDefault ? ' (predeterminada)' : '');
      sel.appendChild(optionEl(p.name, label));
    });
  });
}

// Si la impresora guardada ya no está disponible, añadir su opción para no
// perder la selección (marcada como no disponible).
function ensureSavedOption(k, value) {
  const sel = el[k];
  if (!sel || !value) return;
  const exists = Array.from(sel.options).some((o) => o.value === value);
  if (!exists) sel.appendChild(optionEl(value, value + ' (no disponible)'));
}

// ---------------------------------------------------------------------------
//  Campos <-> ajustes
// ---------------------------------------------------------------------------
function fill(s) {
  if (!s) return;
  KEYS.forEach((k) => {
    const node = el[k];
    if (!node) return;
    if (BOOLEAN.includes(k)) node.checked = !!s[k];
    else node.value = s[k] == null ? '' : s[k];
  });
}

function collect() {
  const patch = {};
  KEYS.forEach((k) => {
    const node = el[k];
    if (!node) return;
    if (BOOLEAN.includes(k)) patch[k] = node.checked;
    else if (NUMERIC.includes(k)) patch[k] = parseInt(node.value, 10);
    else patch[k] = node.value;
  });
  return patch;
}

let statusTimer = null;
function setStatus(msg, kind) {
  statusEl.textContent = msg;
  statusEl.className = 'status show' + (kind ? ' ' + kind : '');
  if (statusTimer) clearTimeout(statusTimer);
  statusTimer = setTimeout(() => { statusEl.className = 'status'; }, 2200);
}

async function persist(reflect) {
  try {
    const s = await window.settingsApi.update(collect());
    if (reflect) fill(s);
    setStatus('Guardado', 'ok');
  } catch (_) {
    setStatus('No se pudo guardar', 'err');
  }
}

saveBtn.addEventListener('click', async () => {
  saveBtn.disabled = true;
  try { await persist(true); }
  finally { saveBtn.disabled = false; }
});

let saveTimer = null;
function scheduleAutosave() {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => persist(false), 450);
}
KEYS.forEach((k) => {
  const node = el[k];
  if (!node) return;
  node.addEventListener('input', scheduleAutosave);
  node.addEventListener('change', scheduleAutosave);
});

// ---------------------------------------------------------------------------
//  Carga inicial
// ---------------------------------------------------------------------------
async function init() {
  // Versión de la app (sección Actualizaciones).
  try {
    const vi = await window.settingsApi.getVersion();
    if (vi && vi.version) document.getElementById('versionValue').textContent = vi.version;
    if (vi && vi.date) document.getElementById('versionDate').textContent = vi.date;
  } catch (_) { /* se quedan los guiones */ }

  let printers = [];
  try { printers = await window.settingsApi.listPrinters(); } catch (_) { printers = []; }
  populatePrinters(printers);

  try {
    const s = await window.settingsApi.get();
    PRINTER_SELECTS.forEach((k) => ensureSavedOption(k, s[k]));
    fill(s);
  } catch (_) {
    setStatus('No se pudo cargar la configuración', 'err');
  }

  updateActiveOnScroll();
  setActive(sections.length ? sections[0].id : null);
}

init();

// ---------------------------------------------------------------------------
//  Sección Aplicaciones: diálogo por app (URL + credenciales guardadas)
// ---------------------------------------------------------------------------
const APP_META = {
  erp:  { name: 'multiplika ERP',  icon: 'app-erp.png',  urlKey: 'URL_ERP' },
  plus: { name: 'multiplika Plus', icon: 'app-plus.png', urlKey: 'URL_PLUS' },
  leia: { name: 'multiplika Leia', icon: 'app-leia.png', urlKey: 'URL_LEIA' }
};

const appModal = document.getElementById('appModal');
const appModalIcon = document.getElementById('appModalIcon');
const appModalTitle = document.getElementById('appModalTitle');
const appModalUrl = document.getElementById('appModalUrl');
const urlEditBtn = document.getElementById('urlEditBtn');
const appModalClose = document.getElementById('appModalClose');
const credsList = document.getElementById('credsList');
const credsNote = document.getElementById('credsNote');

let currentApp = null;
let urlEditing = false;

const eyeIcon = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7-11-7-11-7z"/><circle cx="12" cy="12" r="3"/></svg>';
const trashIcon = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>';

function maskOf(pw) {
  const n = (pw || '').length || 8;
  return '•'.repeat(Math.max(6, Math.min(12, n)));
}

function renderCreds(items) {
  credsList.innerHTML = '';
  if (!items || !items.length) {
    const empty = document.createElement('div');
    empty.className = 'creds-empty';
    empty.textContent = 'No hay contraseñas guardadas para esta app.';
    credsList.appendChild(empty);
    return;
  }
  items.forEach((c) => {
    const row = document.createElement('div');
    row.className = 'cred';

    const user = document.createElement('span');
    user.className = 'cred-user';
    user.textContent = c.user || '(sin usuario)';
    user.title = c.user || '';

    const pass = document.createElement('span');
    pass.className = 'cred-pass';
    pass.textContent = maskOf(c.password);
    let shown = false;

    const reveal = document.createElement('button');
    reveal.className = 'cred-btn';
    reveal.title = 'Mostrar / ocultar';
    reveal.innerHTML = eyeIcon;
    reveal.addEventListener('click', () => {
      shown = !shown;
      pass.textContent = shown ? (c.password || '') : maskOf(c.password);
    });

    const del = document.createElement('button');
    del.className = 'cred-btn';
    del.title = 'Quitar';
    del.innerHTML = trashIcon;
    del.addEventListener('click', () => {
      window.settingsApi.removeCredential(currentApp, c.id);
      loadCreds();
    });

    row.appendChild(user);
    row.appendChild(pass);
    row.appendChild(reveal);
    row.appendChild(del);
    credsList.appendChild(row);
  });
}

async function loadCreds() {
  try {
    const items = await window.settingsApi.listCredentials(currentApp);
    renderCreds(items);
  } catch (_) {
    renderCreds([]);
  }
}

async function renderSecureNote() {
  if (!credsNote) return;
  try {
    const st = await window.settingsApi.getSecureStorageStatus();
    if (st && st.available) {
      credsNote.className = 'creds-note secure';
      credsNote.textContent = 'Almacenamiento seguro activo: las contraseñas se guardan cifradas con el llavero del sistema.';
    } else {
      credsNote.className = 'creds-note insecure';
      credsNote.textContent = 'Atención: en este equipo no hay cifrado disponible; las contraseñas se guardan sin cifrar (texto plano) en la carpeta de datos de la aplicación.';
    }
    credsNote.hidden = false;
  } catch (_) {
    credsNote.hidden = true;
  }
}

async function openAppModal(id) {
  const meta = APP_META[id];
  if (!meta) return;
  currentApp = id;
  appModalIcon.src = meta.icon;
  appModalTitle.textContent = meta.name;
  try {
    const s = await window.settingsApi.get();
    appModalUrl.value = s[meta.urlKey] || '';
  } catch (_) {
    appModalUrl.value = '';
  }
  await loadCreds();
  renderSecureNote();
  setUrlEditing(false);
  appModal.classList.add('show');
}

function closeAppModal() {
  appModal.classList.remove('show');
  currentApp = null;
}

// La URL se muestra en solo lectura; el botón "Editar" la desbloquea para
// cambiarla a propósito y, al pulsar "Guardar", la persiste y vuelve a bloquear.
function normalizeUrl(value) {
  const s = (value || '').trim();
  if (!s) return '';
  return /^https?:\/\//i.test(s) ? s : 'https://' + s;
}

function setUrlEditing(on) {
  urlEditing = on;
  appModalUrl.readOnly = !on;
  appModalUrl.classList.toggle('readonly', !on);
  urlEditBtn.textContent = on ? 'Guardar' : 'Editar';
  if (on) { appModalUrl.focus(); appModalUrl.select(); }
}

urlEditBtn.addEventListener('click', async () => {
  if (!currentApp) return;
  if (!urlEditing) { setUrlEditing(true); return; }
  const meta = APP_META[currentApp];
  const value = normalizeUrl(appModalUrl.value);
  appModalUrl.value = value;
  try {
    const patch = {};
    patch[meta.urlKey] = value;
    await window.settingsApi.update(patch);
    setStatus('URL guardada', 'ok');
  } catch (_) {
    setStatus('No se pudo guardar la URL', 'err');
  }
  setUrlEditing(false);
});

// Añadir una credencial manualmente.
const credAddUser = document.getElementById('credAddUser');
const credAddPass = document.getElementById('credAddPass');
const credAddBtn = document.getElementById('credAddBtn');

async function addCredential() {
  if (!currentApp) return;
  const user = credAddUser.value.trim();
  const pass = credAddPass.value;
  if (!user && !pass) return;
  try { await window.settingsApi.addCredential(currentApp, user, pass); } catch (_) { /* ignorar */ }
  credAddUser.value = '';
  credAddPass.value = '';
  loadCreds();
}
credAddBtn.addEventListener('click', addCredential);
credAddPass.addEventListener('keydown', (e) => { if (e.key === 'Enter') addCredential(); });

// ---------------------------------------------------------------------------
//  Soporte: WhatsApp y descarga de RustDesk
// ---------------------------------------------------------------------------
const emailBtn = document.getElementById('emailBtn');
const whatsappBtn = document.getElementById('whatsappBtn');
const rustdeskBtn = document.getElementById('rustdeskBtn');

emailBtn.addEventListener('click', () => window.settingsApi.openEmail());
whatsappBtn.addEventListener('click', () => window.settingsApi.openWhatsApp());

rustdeskBtn.addEventListener('click', async () => {
  rustdeskBtn.disabled = true;
  setStatus('Descargando RustDesk…', 'ok');
  try {
    const r = await window.settingsApi.downloadRustdesk();
    if (r && r.ok) setStatus('Descargando ' + r.name + '…', 'ok');
    else setStatus('No se pudo descargar; se abrió la web de RustDesk', 'err');
  } catch (_) {
    setStatus('No se pudo descargar RustDesk', 'err');
  } finally {
    rustdeskBtn.disabled = false;
  }
});

document.querySelectorAll('.app-row-cfg').forEach((btn) => {
  btn.addEventListener('click', () => openAppModal(btn.dataset.app));
});
appModalClose.addEventListener('click', closeAppModal);
appModal.addEventListener('click', (e) => { if (e.target === appModal) closeAppModal(); });
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && appModal.classList.contains('show')) closeAppModal();
});

// ---------------------------------------------------------------------------
//  Actualización automática (MST-02)
// ---------------------------------------------------------------------------
const updCheckBtn = document.getElementById('updCheckBtn');
const updInstallBtn = document.getElementById('updInstallBtn');
const updMsg = document.getElementById('updMsg');

function renderUpdate(s) {
  if (!s || !updMsg) return;
  const pct = (s.porcentaje != null) ? ' (' + s.porcentaje + '%)' : '';
  const ver = s.version ? ' v' + s.version : '';
  const textos = {
    idle: 'Se instala sola al cerrar la aplicación.',
    comprobando: 'Comprobando si hay una versión nueva…',
    'al-dia': 'Estás en la última versión.',
    descargando: 'Descargando la nueva versión' + ver + pct + '…',
    listo: 'Nueva versión' + ver + ' lista para instalar.',
    error: s.msg ? ('No se pudo actualizar: ' + s.msg) : 'No se pudo actualizar.'
  };
  updMsg.textContent = textos[s.estado] || textos.idle;
  if (updInstallBtn) updInstallBtn.style.display = (s.estado === 'listo') ? '' : 'none';
}

if (updCheckBtn) {
  updCheckBtn.addEventListener('click', async () => {
    updCheckBtn.disabled = true;
    try {
      const r = await window.settingsApi.checkUpdate();
      if (r && !r.ok && r.msg && updMsg) updMsg.textContent = r.msg;
    } catch (_) { /* el estado real llega por el evento update:state */ }
    finally { updCheckBtn.disabled = false; }
  });
}
if (updInstallBtn) {
  updInstallBtn.addEventListener('click', () => window.settingsApi.installUpdate());
}
if (window.settingsApi.onUpdateState) window.settingsApi.onUpdateState(renderUpdate);
(async () => {
  try { renderUpdate(await window.settingsApi.getUpdateState()); } catch (_) { /* sin estado */ }
})();
