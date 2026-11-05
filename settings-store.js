// ============================================================
//  Almacén de configuración editable
//  Fusiona los valores por defecto (config.js) con los ajustes
//  guardados por el usuario en un fichero JSON dentro de la carpeta
//  de datos de la aplicación (app.getPath('userData')).
// ============================================================

const { app } = require('electron');
const fs = require('fs');
const path = require('path');

const defaults = require('./config');

// Claves editables/persistidas. Cualquier otra clave se ignora.
const KEYS = [
  'APP_URL',
  'WINDOW_TITLE',
  'WIDTH',
  'HEIGHT',
  'MIN_WIDTH',
  'MIN_HEIGHT',
  'OPEN_EXTERNAL_LINKS_IN_BROWSER',
  'AUTO_HIDE_MENU_BAR',
  'FULLSCREEN',
  'PRINTER_DOCUMENTS',
  'PRINTER_TICKETS',
  'URL_ERP',
  'URL_PLUS',
  'URL_LEIA',
  'SHOW_ERP',
  'SHOW_PLUS',
  'SHOW_LEIA'
];

const NUMERIC_KEYS = ['WIDTH', 'HEIGHT', 'MIN_WIDTH', 'MIN_HEIGHT'];
const BOOLEAN_KEYS = ['OPEN_EXTERNAL_LINKS_IN_BROWSER', 'AUTO_HIDE_MENU_BAR', 'FULLSCREEN', 'SHOW_ERP', 'SHOW_PLUS', 'SHOW_LEIA'];
// Texto donde la cadena vacía es un valor válido (no cae al valor por defecto).
const OPTIONAL_STRING_KEYS = ['PRINTER_DOCUMENTS', 'PRINTER_TICKETS', 'URL_ERP', 'URL_PLUS', 'URL_LEIA'];

let current = null; // caché en memoria de los ajustes efectivos

// Ruta del fichero de ajustes (se resuelve en tiempo de llamada, ya con la
// app lista, no en el momento de importar el módulo).
function filePath() {
  return path.join(app.getPath('userData'), 'settings.json');
}

// Leer el JSON guardado; si no existe o está corrupto, devolver {}.
function readSaved() {
  try {
    const raw = fs.readFileSync(filePath(), 'utf8');
    const obj = JSON.parse(raw);
    return obj && typeof obj === 'object' ? obj : {};
  } catch (_) {
    return {};
  }
}

// Convertir un valor entrante al tipo correcto según su clave. Si el valor
// no es válido, se cae al valor por defecto de esa clave.
function coerce(key, value) {
  if (NUMERIC_KEYS.includes(key)) {
    const n = parseInt(value, 10);
    return Number.isFinite(n) && n > 0 ? n : defaults[key];
  }
  if (BOOLEAN_KEYS.includes(key)) {
    return !!value;
  }
  if (OPTIONAL_STRING_KEYS.includes(key)) {
    // La cadena vacía es válida (por ejemplo, "sin impresora elegida").
    return value == null ? '' : String(value).trim();
  }
  // Texto: recortar espacios; si queda vacío, usar el valor por defecto.
  const s = value == null ? '' : String(value).trim();
  return s === '' ? defaults[key] : s;
}

// Cargar (una vez) los ajustes efectivos = defaults + guardados.
function load() {
  if (current) return current;
  const saved = readSaved();
  const merged = {};
  for (const k of KEYS) {
    merged[k] = k in saved ? coerce(k, saved[k]) : defaults[k];
  }
  current = merged;
  return current;
}

// Copia de los ajustes efectivos actuales.
function get() {
  return { ...load() };
}

// Copia de los valores por defecto (solo las claves editables).
function getDefaults() {
  const out = {};
  for (const k of KEYS) out[k] = defaults[k];
  return out;
}

// Persistir en disco los ajustes efectivos actuales.
function persist() {
  try {
    fs.mkdirSync(path.dirname(filePath()), { recursive: true });
    fs.writeFileSync(filePath(), JSON.stringify(current, null, 2), 'utf8');
    return true;
  } catch (_) {
    return false;
  }
}

// Aplicar un parche parcial: solo las claves presentes y válidas cambian.
function update(patch) {
  const base = load();
  const next = { ...base };
  if (patch && typeof patch === 'object') {
    for (const k of KEYS) {
      if (k in patch) next[k] = coerce(k, patch[k]);
    }
  }
  current = next;
  persist();
  return { ...current };
}

// Volver a todos los valores por defecto.
function reset() {
  current = getDefaults();
  persist();
  return { ...current };
}

module.exports = { load, get, getDefaults, update, reset, KEYS, filePath };
