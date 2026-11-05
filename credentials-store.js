// ============================================================
//  Almacén de credenciales por aplicación
//  Guarda, por cada app del Panel de control, una lista de
//  usuarios/contraseñas en un fichero JSON dentro de la carpeta
//  de datos de usuario (app.getPath('userData')).
//
//  Las contraseñas se cifran con el llavero del sistema (safeStorage)
//  cuando está disponible; si no, se guardan en texto plano.
// ============================================================

const { app, safeStorage } = require('electron');
const fs = require('fs');
const path = require('path');

let data = null; // { appId: [ { id, user, enc, pw } ] }
let seq = 0;

function filePath() {
  return path.join(app.getPath('userData'), 'credentials.json');
}

function load() {
  if (data) return data;
  try {
    const obj = JSON.parse(fs.readFileSync(filePath(), 'utf8'));
    data = obj && typeof obj === 'object' ? obj : {};
  } catch (_) {
    data = {};
  }
  let dirty = dedupeAll();
  if (reencryptPlaintext()) dirty = true;
  if (dirty) persist();
  return data;
}

// Usuario normalizado para comparar (sin mayúsculas ni espacios sobrantes).
function normUser(s) {
  return String(s || '').trim().toLowerCase();
}

// Fusionar entradas duplicadas del mismo usuario (se queda la más reciente).
// Devuelve true si hubo cambios (para re-persistir).
function dedupeAll() {
  let changed = false;
  for (const appId of Object.keys(data)) {
    const arr = data[appId];
    if (!Array.isArray(arr)) continue;
    const byUser = new Map(); // clave normalizada -> entrada superviviente
    for (const c of arr) {
      const key = normUser(c && c.user);
      // La última aparición gana (es la más reciente en el archivo).
      byUser.set(key, c);
    }
    if (byUser.size !== arr.length) {
      data[appId] = Array.from(byUser.values());
      changed = true;
    }
  }
  return changed;
}

function persist() {
  try {
    fs.mkdirSync(path.dirname(filePath()), { recursive: true });
    fs.writeFileSync(filePath(), JSON.stringify(data, null, 2), 'utf8');
  } catch (_) { /* ignorar */ }
}

// ¿Hay cifrado REAL disponible en este equipo?
//  - Windows (DPAPI) y macOS (Keychain): basta con isEncryptionAvailable().
//  - Linux: isEncryptionAvailable() puede devolver true con el backend
//    'basic_text', que NO cifra de verdad (usa una contraseña fija). En ese
//    caso lo tratamos como "sin cifrado" para no dar una falsa sensación de
//    seguridad (H-03).
function isSecureStorageAvailable() {
  try {
    if (!safeStorage || !safeStorage.isEncryptionAvailable()) return false;
    if (process.platform === 'linux' &&
        typeof safeStorage.getSelectedStorageBackend === 'function') {
      return safeStorage.getSelectedStorageBackend() !== 'basic_text';
    }
    return true;
  } catch (_) {
    return false;
  }
}

// Estado del almacenamiento seguro (para mostrarlo en la interfaz).
function secureStatus() {
  let backend = null;
  try {
    if (process.platform === 'linux' && safeStorage &&
        typeof safeStorage.getSelectedStorageBackend === 'function') {
      backend = safeStorage.getSelectedStorageBackend();
    }
  } catch (_) { /* ignorar */ }
  return { available: isSecureStorageAvailable(), platform: process.platform, backend };
}

// Cifrar una contraseña. Devuelve { enc, pw } listo para guardar. Si no hay
// cifrado real, se guarda en texto plano (decisión de producto) pero de forma
// explícita (enc:false), nunca aparentando estar cifrada.
function encryptPassword(password) {
  try {
    if (isSecureStorageAvailable()) {
      return { enc: true, pw: safeStorage.encryptString(String(password)).toString('base64') };
    }
  } catch (_) { /* caer a texto plano */ }
  return { enc: false, pw: String(password) };
}

// Recifrar oportunistamente las contraseñas que estuvieran en texto plano,
// si el equipo ya dispone de cifrado real. Devuelve true si hubo cambios.
function reencryptPlaintext() {
  if (!isSecureStorageAvailable()) return false;
  let changed = false;
  for (const appId of Object.keys(data)) {
    const arr = data[appId];
    if (!Array.isArray(arr)) continue;
    for (const c of arr) {
      if (c && !c.enc) {
        const encd = encryptPassword(String(c.pw || ''));
        if (encd.enc) { c.enc = true; c.pw = encd.pw; changed = true; }
      }
    }
  }
  return changed;
}

// Descifrar una contraseña guardada.
function decryptPassword(item) {
  try {
    if (item && item.enc) {
      return safeStorage.decryptString(Buffer.from(item.pw, 'base64'));
    }
  } catch (_) {
    return '';
  }
  return item ? String(item.pw || '') : '';
}

function newId() {
  return 'c' + Date.now().toString(36) + (seq++).toString(36);
}

// Lista de credenciales de una app, con la contraseña ya descifrada.
function list(appId) {
  load();
  const arr = data[appId] || [];
  return arr.map((c) => ({ id: c.id, user: c.user, password: decryptPassword(c) }));
}

// Añadir una credencial. Devuelve { id, user, password }.
function add(appId, user, password) {
  load();
  if (!Array.isArray(data[appId])) data[appId] = [];
  const item = Object.assign({ id: newId(), user: String(user || '') }, encryptPassword(password));
  data[appId].push(item);
  persist();
  return { id: item.id, user: item.user, password: String(password || '') };
}

// Guardar una credencial, actualizando la contraseña si ya existe ese usuario
// para la app (evita duplicados en la captura al iniciar sesión). El usuario
// se compara ignorando mayúsculas/minúsculas y espacios sobrantes.
function save(appId, user, password) {
  load();
  if (!Array.isArray(data[appId])) data[appId] = [];
  const u = String(user || '');
  const encd = encryptPassword(password);
  const matches = data[appId].filter((c) => normUser(c.user) === normUser(u));
  if (matches.length) {
    // Actualizar la primera coincidencia y eliminar cualquier duplicado.
    const keep = matches[0];
    keep.enc = encd.enc;
    keep.pw = encd.pw;
    data[appId] = data[appId].filter((c) => c === keep || normUser(c.user) !== normUser(u));
  } else {
    data[appId].push(Object.assign({ id: newId(), user: u }, encd));
  }
  persist();
}

// Quitar una credencial por id.
function remove(appId, id) {
  load();
  if (!Array.isArray(data[appId])) return;
  data[appId] = data[appId].filter((c) => c.id !== id);
  persist();
}

module.exports = { list, add, save, remove, secureStatus };
