// ============================================================
//  Handler de conexiones tipo "sftp" para /v1/conexiones/ejecutar.
//
//  LEIA envía { tipo:"sftp", operacion, parametros, credenciales }.
//   - parametros  = datos NO secretos (host, puerto, usuario, path...)
//   - credenciales = el secreto descifrado (password o clave privada)
//
//  Reglas:
//   - Los secretos SIEMPRE llegan en `credenciales`, nunca en `parametros`.
//   - No hay esquema fijo en el backend: se es TOLERANTE A ALIAS al leer.
//   - Las credenciales se usan para conectar y NO se registran en ningún log
//     ni se devuelven en la respuesta.
//
//  Operaciones habilitadas hoy por LEIA (allowlist en accionesIA.js):
//   probar, listar, existe, subir, bajar, borrar.
// ============================================================

const posix = require('path').posix;
const SftpClient = require('ssh2-sftp-client');

const OPERACIONES = ['probar', 'listar', 'existe', 'subir', 'bajar', 'borrar'];

// Primer valor no vacío de una lista de claves alias.
function pick(obj, keys, def) {
  if (!obj || typeof obj !== 'object') return def;
  for (const k of keys) {
    const v = obj[k];
    if (v != null && v !== '') return v;
  }
  return def;
}

// Construye la configuración de conexión ssh2 a partir de parametros
// (no secreto) + credenciales (secreto), tolerando alias de nombres.
function buildConnectConfig(parametros, credenciales) {
  const host = pick(parametros, ['host', 'hostname']);
  const port = parseInt(pick(parametros, ['port', 'puerto'], 22), 10) || 22;
  const username = pick(parametros, ['username', 'user', 'usuario']);

  const password = pick(credenciales, ['password', 'clave', 'contrasena', 'contraseña']);
  const privateKey = pick(credenciales, ['privateKey', 'private_key', 'llave_privada']);
  const passphrase = pick(credenciales, ['passphrase', 'frase']);

  if (!host) throw new Error('Falta el host de la conexión (parametros.host)');
  if (!username) throw new Error('Falta el usuario de la conexión (parametros.username)');

  const cfg = { host, port, username, readyTimeout: 15000 };
  if (privateKey) {
    cfg.privateKey = privateKey;
    if (passphrase) cfg.passphrase = passphrase;
  } else if (password) {
    cfg.password = password;
  } else {
    throw new Error('Faltan credenciales (contraseña o clave privada)');
  }
  return cfg;
}

// Mapea el tipo de entrada de ssh2-sftp-client ('-','d','l') a file/dir.
function tipoDe(entry) {
  if (entry && entry.type === 'd') return 'dir';
  return 'file';
}

async function ejecutar(operacion, parametros, credenciales) {
  const cfg = buildConnectConfig(parametros, credenciales);
  const params = parametros || {};
  const sftp = new SftpClient();
  await sftp.connect(cfg);
  try {
    switch (operacion) {
      case 'probar':
        return { conectado: true };

      case 'listar': {
        const ruta = params.path || '.';
        const items = await sftp.list(ruta);
        return items.map((it) => ({
          nombre: it.name,
          tipo: tipoDe(it),
          tamano: it.size,
          modificado: it.modifyTime ? new Date(it.modifyTime).toISOString() : null
        }));
      }

      case 'existe': {
        if (!params.path) throw new Error('Falta "path"');
        const r = await sftp.exists(params.path);
        return { existe: !!r };
      }

      case 'subir': {
        if (!params.destino) throw new Error('Falta "destino"');
        if (typeof params.contenidoBase64 !== 'string') throw new Error('Falta "contenidoBase64"');
        const buf = Buffer.from(params.contenidoBase64, 'base64');
        await sftp.put(buf, params.destino);
        return { subido: true, ruta: params.destino };
      }

      case 'bajar': {
        if (!params.path) throw new Error('Falta "path"');
        const data = await sftp.get(params.path); // sin destino => devuelve Buffer
        const buf = Buffer.isBuffer(data) ? data : Buffer.from(data);
        return {
          nombre: posix.basename(params.path),
          contenidoBase64: buf.toString('base64'),
          tamano: buf.length
        };
      }

      case 'borrar': {
        if (!params.path) throw new Error('Falta "path"');
        // delete es para ficheros; si es un directorio, rmdir recursivo.
        try {
          await sftp.delete(params.path);
        } catch (_) {
          await sftp.rmdir(params.path, true);
        }
        return { borrado: true };
      }

      default:
        // No debería llegar aquí: el servidor valida contra OPERACIONES.
        throw new Error('Operación no soportada: ' + operacion);
    }
  } finally {
    try { await sftp.end(); } catch (_) { /* cerrar siempre, ignorar errores */ }
  }
}

module.exports = { ejecutar, OPERACIONES };
