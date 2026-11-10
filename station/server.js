// ============================================================
//  API local de Multiplika Station (contrato consumido por LEIA).
//
//  - HTTPS en 127.0.0.1 (loopback), puerto aleatorio, cert autofirmado.
//  - Autenticación por cabecera X-Station-Token en TODAS las rutas.
//  - Respuestas JSON. Contrato de errores: no-2xx con { error, codigo }.
//  - CORS: la página de LEIA (https://apiadev.multiplika.net) hace fetch
//    cross-origin al loopback, así que hay que responder cabeceras CORS
//    y el preflight OPTIONS.
//
//  Este módulo NO depende de Electron: recibe { version, equipo, workRoot }
//  para poder probarse en Node puro. main.js lo arranca al iniciar la app.
// ============================================================

const https = require('https');
const crypto = require('crypto');
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const { URL } = require('url');

const { generateCert } = require('./tls');
const sftp = require('./sftp');
const agent = require('./agent'); // motor de agente (Claude Code headless) — módulo aparte

const MAX_BODY = 25 * 1024 * 1024;   // 25 MB de cuerpo de petición
const WEB_MAX_BYTES = 3 * 1024 * 1024; // tope de descarga en /web/traer
const WEB_MAX_CHARS = 60000;          // tope de texto devuelto a la IA

// Despachador de tipos de conexión: tipo -> handler { ejecutar, OPERACIONES }.
// Preparado para añadir mariadb, http_api, ftp, smtp, imap, s3, webhook...
const HANDLERS = { sftp };

// ---------------------------------------------------------------------------
//  Arranque
// ---------------------------------------------------------------------------
function startStationServer(opts) {
  const ctx = {
    version: (opts && opts.version) || '',
    equipo: (opts && opts.equipo) || '',
    workRoot: path.resolve((opts && opts.workRoot) || '.'),
    token: crypto.randomBytes(32).toString('hex'),
    // Callback (lo pone main.js) para abrir el diálogo nativo de carpeta.
    elegirCarpeta: (opts && opts.elegirCarpeta) || null,
    // Callback (lo pone main.js) que enciende el descargador de modelos si no está en marcha.
    // Devuelve { ok, motivo? }. Sin él, se asume que alguien lo ha arrancado a mano.
    asegurarDescargador: (opts && opts.asegurarDescargador) || null
  };

  return new Promise((resolve, reject) => {
    try {
      fs.mkdirSync(ctx.workRoot, { recursive: true });
      const { key, cert } = generateCert('127.0.0.1');
      const server = https.createServer({ key, cert }, (req, res) => {
        handle(req, res, ctx).catch((err) => {
          sendError(res, req, 500, 'INTERNO', (err && err.message) || 'Error interno');
        });
      });
      server.on('error', reject);
      // Puerto 0 = el SO asigna uno libre. Solo loopback.
      server.listen(0, '127.0.0.1', () => {
        const port = server.address().port;
        resolve({
          port,
          token: ctx.token,
          baseUrl: `https://127.0.0.1:${port}/v1`,
          workRoot: ctx.workRoot,
          close: () => new Promise((r) => server.close(() => r()))
        });
      });
    } catch (err) {
      reject(err);
    }
  });
}

// ---------------------------------------------------------------------------
//  Utilidades de respuesta (JSON + CORS + errores)
// ---------------------------------------------------------------------------
function setCors(res, req) {
  const origin = req.headers.origin;
  if (origin) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
  } else {
    res.setHeader('Access-Control-Allow-Origin', '*');
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Station-Token');
  res.setHeader('Access-Control-Max-Age', '600');
}

function sendJson(res, req, status, obj) {
  setCors(res, req);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(obj));
}

// Contrato de errores de la API local (NO de negocio): no-2xx + { error, codigo }.
function sendError(res, req, status, codigo, error) {
  sendJson(res, req, status, { error: String(error || codigo), codigo });
}

// Lee y parsea el cuerpo JSON. Lanza { code:'CUERPO_INVALIDO' } si no es válido.
function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY) {
        const e = new Error('Cuerpo demasiado grande'); e.code = 'CUERPO_INVALIDO';
        reject(e); req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => {
      if (!chunks.length) return resolve({});
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch (_) {
        const e = new Error('JSON inválido'); e.code = 'CUERPO_INVALIDO';
        reject(e);
      }
    });
    req.on('error', reject);
  });
}

// ---------------------------------------------------------------------------
//  Router
// ---------------------------------------------------------------------------
async function handle(req, res, ctx) {
  // Preflight CORS.
  if (req.method === 'OPTIONS') {
    setCors(res, req);
    res.writeHead(204);
    res.end();
    return;
  }

  const u = new URL(req.url, 'https://127.0.0.1');
  const route = u.pathname.replace(/\/+$/, ''); // sin barra(s) final(es)

  // Autenticación: token obligatorio en TODA ruta.
  const tok = req.headers['x-station-token'];
  if (!tok || tok !== ctx.token) {
    return sendError(res, req, 401, 'TOKEN_INVALIDO', 'Token de sesión no válido');
  }

  try {
    if (req.method === 'GET' && route === '/v1/health') {
      return sendJson(res, req, 200, { ok: true, version: ctx.version, equipo: ctx.equipo });
    }
    if (req.method === 'POST' && route === '/v1/fs/guardar') {
      return await fsGuardar(res, req, ctx, await readBody(req));
    }
    if (req.method === 'POST' && route === '/v1/web/traer') {
      return await webTraer(res, req, ctx, await readBody(req));
    }
    if (req.method === 'POST' && route === '/v1/conexiones/ejecutar') {
      return await conexionesEjecutar(res, req, ctx, await readBody(req));
    }
    if (req.method === 'POST' && route === '/v1/aeat/descargar') {
      return await aeatDescargar(res, req, ctx, await readBody(req));
    }

    // --- Agente: ejecuta Claude Code en local (headless) y hace streaming ---
    // (motor en ./agent.js; el estado durable vive en apia, no aquí)
    if (req.method === 'GET' && route === '/v1/agente/estado') {
      return sendJson(res, req, 200, await agent.estado());
    }
    if (req.method === 'POST' && route === '/v1/agente/ejecutar') {
      // Respuesta en streaming NDJSON: agent.ejecutar toma control de `res`.
      return await agent.ejecutar(req, res, ctx, await readBody(req), setCors);
    }
    if (req.method === 'POST' && route === '/v1/agente/elegir-carpeta') {
      const ruta = await agent.elegirCarpeta(ctx);
      return sendJson(res, req, 200, { ruta: ruta || null });
    }
    if (req.method === 'POST' && route === '/v1/agente/instalar') {
      // Respuesta en streaming NDJSON del progreso de instalación.
      return await agent.instalar(req, res, ctx, await readBody(req), setCors);
    }

    // --- Andamiaje: previsto pero LEIA aún no lo llama (sección 8) ---
    if (req.method === 'GET' && route === '/v1/fs/listar') {
      return await fsListar(res, req, ctx, u);
    }
    if (req.method === 'GET' && route === '/v1/fs/leer') {
      return await fsLeer(res, req, ctx, u);
    }
    if (req.method === 'GET' && route === '/v1/nube/estado') {
      return sendJson(res, req, 200, { disponible: false, estado: 'no_configurado', proveedor: null });
    }

    return sendError(res, req, 404, 'NO_ENCONTRADO', 'Ruta no encontrada: ' + route);
  } catch (err) {
    if (err && err.code === 'CUERPO_INVALIDO') {
      return sendError(res, req, 400, 'CUERPO_INVALIDO', err.message);
    }
    return sendError(res, req, 500, 'INTERNO', (err && err.message) || 'Error interno');
  }
}

// ---------------------------------------------------------------------------
//  Seguridad de rutas de fichero (raíz de trabajo fija, sin path traversal)
// ---------------------------------------------------------------------------
function assertRelative(p) {
  if (!p) return;
  if (path.isAbsolute(p) || /(^|[\\/])\.\.(?:[\\/]|$)/.test(p)) {
    const e = new Error('No se permiten rutas absolutas ni ".."'); e.code = 'FS_FUERA_DE_RAIZ';
    throw e;
  }
}

// Resuelve dentro de la raíz y verifica que no se sale de ella.
function safeResolve(root, parts) {
  const rootResolved = path.resolve(root);
  const resolved = path.resolve(rootResolved, ...parts.filter(Boolean));
  if (resolved !== rootResolved && !resolved.startsWith(rootResolved + path.sep)) {
    const e = new Error('Ruta fuera del área de trabajo'); e.code = 'FS_FUERA_DE_RAIZ';
    throw e;
  }
  return resolved;
}

// ---------------------------------------------------------------------------
//  POST /v1/fs/guardar
// ---------------------------------------------------------------------------
async function fsGuardar(res, req, ctx, body) {
  const nombre = body && body.nombre;
  if (!nombre || typeof nombre !== 'string') {
    return sendError(res, req, 400, 'CUERPO_INVALIDO', 'Falta "nombre"');
  }
  if (typeof body.contenidoBase64 !== 'string') {
    return sendError(res, req, 400, 'CUERPO_INVALIDO', 'Falta "contenidoBase64"');
  }
  const sub = body.path || '';
  try {
    assertRelative(sub);
    // El nombre es un nombre de fichero, no una ruta.
    if (/[\\/]/.test(nombre) || nombre === '..' || nombre === '.') {
      const e = new Error('El nombre no puede contener rutas'); e.code = 'FS_FUERA_DE_RAIZ';
      throw e;
    }
    const dir = safeResolve(ctx.workRoot, [sub]);
    const dest = safeResolve(ctx.workRoot, [sub, nombre]);
    await fsp.mkdir(dir, { recursive: true });
    await fsp.writeFile(dest, Buffer.from(body.contenidoBase64, 'base64'), { mode: 0o600 });
    return sendJson(res, req, 200, { path: dest });
  } catch (err) {
    if (err.code === 'FS_FUERA_DE_RAIZ') return sendError(res, req, 400, 'FS_FUERA_DE_RAIZ', err.message);
    return sendError(res, req, 500, 'INTERNO', err.message);
  }
}

// ---------------------------------------------------------------------------
//  POST /v1/web/traer
// ---------------------------------------------------------------------------
async function webTraer(res, req, ctx, body) {
  const url = body && body.url;
  if (!url || typeof url !== 'string') {
    return sendError(res, req, 400, 'CUERPO_INVALIDO', 'Falta "url"');
  }
  let parsed;
  try { parsed = new URL(url); } catch (_) {
    return sendError(res, req, 400, 'CUERPO_INVALIDO', 'URL no válida');
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return sendError(res, req, 400, 'CUERPO_INVALIDO', 'Solo se permiten URLs http/https');
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20000);
  try {
    const r = await fetch(url, {
      redirect: 'follow',
      signal: controller.signal,
      headers: { 'User-Agent': 'MultiplikaStation/' + (ctx.version || '1.0') }
    });
    const contentType = r.headers.get('content-type') || '';
    const { text, truncado: truncBytes } = await readCapped(r, WEB_MAX_BYTES);
    let texto = /html/i.test(contentType) ? htmlToText(text) : text;
    let truncado = truncBytes;
    if (texto.length > WEB_MAX_CHARS) { texto = texto.slice(0, WEB_MAX_CHARS); truncado = true; }
    return sendJson(res, req, 200, {
      texto,
      url: r.url || url,
      status: r.status,
      contentType,
      truncado
    });
  } catch (err) {
    const msg = (err && err.name === 'AbortError') ? 'La descarga tardó demasiado' : ((err && err.message) || 'No se pudo descargar la URL');
    return sendError(res, req, 502, 'WEB_FALLO', msg);
  } finally {
    clearTimeout(timer);
  }
}

// Lee el cuerpo de la respuesta con tope de bytes (para no reventar memoria/IA).
async function readCapped(r, maxBytes) {
  if (!r.body || typeof r.body.getReader !== 'function') {
    const t = await r.text();
    const buf = Buffer.from(t, 'utf8');
    if (buf.length > maxBytes) return { text: buf.slice(0, maxBytes).toString('utf8'), truncado: true };
    return { text: t, truncado: false };
  }
  const reader = r.body.getReader();
  const parts = [];
  let received = 0;
  let truncado = false;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    const chunk = Buffer.from(value);
    if (received + chunk.length > maxBytes) {
      parts.push(chunk.slice(0, maxBytes - received));
      truncado = true;
      try { await reader.cancel(); } catch (_) { /* ignorar */ }
      break;
    }
    parts.push(chunk);
    received += chunk.length;
  }
  return { text: Buffer.concat(parts).toString('utf8'), truncado };
}

// HTML -> texto plano razonable (sin dependencias).
function htmlToText(html) {
  return String(html)
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<\/(p|div|br|li|h[1-6]|tr|section|article)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/[ \t\f\v]+/g, ' ')
    .replace(/\n[ \t]+/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// ---------------------------------------------------------------------------
//  POST /v1/conexiones/ejecutar  (despachador tipo -> handler)
// ---------------------------------------------------------------------------
async function conexionesEjecutar(res, req, ctx, body) {
  const tipo = body && body.tipo;
  const operacion = body && body.operacion;
  const parametros = (body && body.parametros) || {};
  const credenciales = (body && body.credenciales) || {};

  if (!tipo || typeof tipo !== 'string') {
    return sendError(res, req, 400, 'CUERPO_INVALIDO', 'Falta "tipo"');
  }
  if (!operacion || typeof operacion !== 'string') {
    return sendError(res, req, 400, 'CUERPO_INVALIDO', 'Falta "operacion"');
  }
  const handler = HANDLERS[tipo];
  if (!handler) {
    return sendError(res, req, 400, 'TIPO_NO_SOPORTADO', 'Tipo de conexión no soportado: ' + tipo);
  }
  if (!handler.OPERACIONES.includes(operacion)) {
    return sendError(res, req, 400, 'OPERACION_NO_SOPORTADA', 'Operación no soportada: ' + operacion);
  }

  try {
    const resultado = await handler.ejecutar(operacion, parametros, credenciales);
    // Contrato de acción: LEIA reenvía este objeto entero al agente.
    return sendJson(res, req, 200, { ok: true, resultado, error: null });
  } catch (err) {
    // Fallo al ejecutar la acción (no conecta, credenciales, operación falla):
    // se devuelve con el MISMO contrato de acción (criterio de aceptación #4),
    // nunca con las credenciales en el mensaje.
    return sendJson(res, req, 200, { ok: false, resultado: null, error: (err && err.message) || 'Error al ejecutar la acción' });
  }
}

// ---------------------------------------------------------------------------
//  Andamiaje de ficheros (sección 8: aún no lo llama LEIA)
// ---------------------------------------------------------------------------
async function fsListar(res, req, ctx, u) {
  const rel = u.searchParams.get('path') || '';
  try {
    assertRelative(rel);
    const dir = safeResolve(ctx.workRoot, [rel]);
    const entries = await fsp.readdir(dir, { withFileTypes: true });
    const out = [];
    for (const e of entries) {
      const full = path.join(dir, e.name);
      let tamano = 0;
      try { tamano = (await fsp.stat(full)).size; } catch (_) { /* ignorar */ }
      out.push({ nombre: e.name, ruta: full, tamano, es_directorio: e.isDirectory() });
    }
    return sendJson(res, req, 200, out);
  } catch (err) {
    if (err.code === 'FS_FUERA_DE_RAIZ') return sendError(res, req, 400, 'FS_FUERA_DE_RAIZ', err.message);
    if (err.code === 'ENOENT') return sendError(res, req, 404, 'NO_ENCONTRADO', 'No existe la carpeta');
    return sendError(res, req, 500, 'INTERNO', err.message);
  }
}

async function fsLeer(res, req, ctx, u) {
  const rel = u.searchParams.get('ruta') || '';
  try {
    assertRelative(rel);
    const file = safeResolve(ctx.workRoot, [rel]);
    const buf = await fsp.readFile(file);
    const esBinario = buf.includes(0);
    if (esBinario) {
      return sendJson(res, req, 200, { nombre: path.basename(file), texto: `[archivo binario, ${buf.length} bytes]` });
    }
    return sendJson(res, req, 200, { nombre: path.basename(file), texto: buf.toString('utf8') });
  } catch (err) {
    if (err.code === 'FS_FUERA_DE_RAIZ') return sendError(res, req, 400, 'FS_FUERA_DE_RAIZ', err.message);
    if (err.code === 'ENOENT') return sendError(res, req, 404, 'NO_ENCONTRADO', 'No existe el archivo');
    return sendError(res, req, 500, 'INTERNO', err.message);
  }
}

// ---------------------------------------------------------------------------
//  POST /v1/aeat/descargar
//  Baja justificantes de la AEAT con el servicio local "Descargador de modelos" (.NET).
//  Station lo llama desde el equipo (sin cabecera Origin), así que al .NET le basta con
//  X-Descargador: 1 en el POST (el token/CORS del .NET son para el navegador, aquí no se usan).
//  El .NET es una cola asíncrona: se encola el trabajo, se sondea hasta que termina y se
//  devuelven los PDF en base64 para que la pantalla de LEIA los adjunte a la respuesta.
//  La URL del descargador es configurable con DESCARGADOR_URL (por defecto 127.0.0.1:5178).
//  Station lo lleva dentro y lo enciende ella misma (station/descargador.js).
// ---------------------------------------------------------------------------
const DESCARGADOR_URL = (process.env.DESCARGADOR_URL || 'http://127.0.0.1:5178').replace(/\/+$/, '');
const AEAT_TIMEOUT_MS = 180000; // la AEAT es lenta; damos hasta 3 minutos

// Lee un campo venga en PascalCase o camelCase (el JSON del .NET puede serializar de cualquiera).
function campo(obj, nombre) {
  if (!obj) return undefined;
  const camel = nombre.charAt(0).toLowerCase() + nombre.slice(1);
  return obj[nombre] !== undefined ? obj[nombre] : obj[camel];
}

async function aeatDescargar(res, req, ctx, body) {
  const nif = String(body?.nif || '').trim();
  const modelos = Array.isArray(body?.modelos) ? body.modelos.join(',') : String(body?.modelos || '').trim();
  const ejercicios = String(body?.ejercicios || '').trim();
  const periodos = String(body?.periodos || '').trim();
  // El ejercicio es opcional: si no viene, el descargador baja "el último presentado" de cada modelo.
  if (!nif || !modelos) {
    return sendError(res, req, 400, 'CUERPO_INVALIDO', 'Faltan nif o modelos');
  }
  // Station lleva el descargador dentro: si no está encendido (o se ha caído), lo enciende.
  if (ctx.asegurarDescargador) {
    const est = await ctx.asegurarDescargador();
    if (!est.ok) return sendError(res, req, 503, 'DESCARGADOR_NO_DISPONIBLE', est.motivo);
  }
  try {
    // 1) Encola el trabajo en el descargador.
    const alta = await fetch(DESCARGADOR_URL + '/api/trabajos', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Descargador': '1' },
      body: JSON.stringify({ Nif: nif, Modelos: modelos, Ejercicios: ejercicios, Periodos: periodos }),
    });
    if (!alta.ok) {
      const t = await alta.text().catch(() => '');
      return sendError(res, req, 502, 'DESCARGADOR_ERROR', `El descargador rechazó la petición: ${t.slice(0, 200)}`);
    }
    const altaJson = await alta.json();
    const id = campo(altaJson, 'Id');
    if (!id) return sendError(res, req, 502, 'DESCARGADOR_ERROR', 'El descargador no devolvió id de trabajo');

    // 2) Sondea hasta que el trabajo deje de estar en cola/en curso.
    const t0 = Date.now();
    let trabajo = null;
    while (Date.now() - t0 < AEAT_TIMEOUT_MS) {
      await new Promise((r) => setTimeout(r, 2000));
      const snap = await fetch(DESCARGADOR_URL + '/api/trabajos').then((r) => r.json()).catch(() => null);
      const lista = Array.isArray(snap) ? snap : (campo(snap, 'Trabajos') || campo(snap, 'Items') || []);
      trabajo = (lista || []).find((x) => String(campo(x, 'Id')) === String(id));
      const estado = trabajo && campo(trabajo, 'Estado');
      if (trabajo && estado !== 'EnCola' && estado !== 'EnCurso') break;
    }
    if (!trabajo) return sendError(res, req, 504, 'DESCARGADOR_TIMEOUT', 'La descarga de la AEAT tardó demasiado');

    // 3) Trae el PDF de cada documento que tenga ruta.
    const documentos = [];
    for (const d of (campo(trabajo, 'Documentos') || [])) {
      const ruta = campo(d, 'Ruta');
      const doc = {
        modelo: campo(d, 'Modelo'),
        ejercicio: campo(d, 'Ejercicio'),
        periodo: campo(d, 'Periodo'),
        resultado: campo(d, 'Resultado'),
        error: campo(d, 'Error') || null,
        nombre: null,
        pdf_base64: null,
      };
      if (ruta) {
        try {
          const pdf = await fetch(DESCARGADOR_URL + '/api/archivo?ruta=' + encodeURIComponent(ruta));
          if (pdf.ok) {
            doc.pdf_base64 = Buffer.from(await pdf.arrayBuffer()).toString('base64');
            doc.nombre = String(ruta).split(/[\\/]/).pop();
          }
        } catch (_) { /* se devuelve el documento sin pdf */ }
      }
      documentos.push(doc);
    }
    return sendJson(res, req, 200, {
      estado: campo(trabajo, 'Estado'),
      resumen: campo(trabajo, 'Resumen') || null,
      documentos,
    });
  } catch (e) {
    return sendError(res, req, 502, 'DESCARGADOR_NO_DISPONIBLE',
      `No se pudo contactar con el descargador de modelos: ${e.message}`);
  }
}

module.exports = { startStationServer };
