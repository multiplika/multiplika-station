// ============================================================
//  station/agent.js — Motor de agente local (Claude Code headless).
//
//  Ejecuta el CLI de Claude Code con `-p --output-format stream-json` y
//  reemite su salida como **NDJSON en streaming** por la API local. LEIA lo
//  consume desde el navegador (fetch + lectura del body) y lo pinta como chat.
//
//  Filosofía: la Station SOLO ejecuta (manos efímeras). El estado durable
//  (conversación, resultados) lo guarda LEIA en apia, no aquí.
//
//  Este módulo es autocontenido: server.js solo enruta a `estado()` y
//  `ejecutar()`. No comparte estado con el resto de la API salvo `ctx`.
// ============================================================

const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');

// Modos de permiso del agente → banderas del CLI. El usuario elige desde LEIA.
//  - plan:    solo planifica, no toca nada.
//  - lectura: modo por defecto (pide permiso para acciones; en headless => se deniegan).
//  - edicion: acepta ediciones de fichero dentro del workspace (recomendado por defecto).
//  - total:   sin restricciones (ejecuta shell). Úsese con cuidado.
const PERMISOS = {
  plan: ['--permission-mode', 'plan'],
  lectura: ['--permission-mode', 'default'],
  edicion: ['--permission-mode', 'acceptEdits'],
  total: ['--dangerously-skip-permissions'],
};

const ES_WIN = process.platform === 'win32';

// Nombre del ejecutable según SO.
function nombreBin() {
  return ES_WIN ? 'claude.cmd' : 'claude';
}

// Directorios donde suele vivir el CLI, AÑADIDOS al PATH del proceso. Una app
// Electron lanzada desde el Dock/Finder NO hereda el PATH del terminal, así que
// hay que buscar en las rutas típicas de npm/homebrew/nvm/volta a mano.
function dirsExtra() {
  const home = os.homedir();
  if (ES_WIN) {
    return [
      process.env.APPDATA ? path.join(process.env.APPDATA, 'npm') : null,
      process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, 'Programs') : null,
    ].filter(Boolean);
  }
  const base = [
    '/usr/local/bin', '/opt/homebrew/bin', '/usr/bin', '/bin',
    path.join(home, '.local', 'bin'),
    path.join(home, '.npm-global', 'bin'),
    path.join(home, '.bun', 'bin'),
    path.join(home, '.volta', 'bin'),
    path.join(home, 'bin'),
  ];
  // nvm/fnm: escanea las versiones instaladas y añade sus /bin.
  for (const nvmRoot of [path.join(home, '.nvm', 'versions', 'node'),
    path.join(home, '.local', 'share', 'fnm', 'node-versions')]) {
    try {
      for (const v of fs.readdirSync(nvmRoot)) {
        const b = path.join(nvmRoot, v, ES_WIN ? '' : 'bin');
        base.push(b);
        base.push(path.join(nvmRoot, v, 'installation', 'bin'));
      }
    } catch (_) { /* no existe */ }
  }
  return base;
}

// PATH ampliado (string) para pasar al proceso hijo.
function pathAmpliado() {
  const sep = ES_WIN ? ';' : ':';
  const actuales = (process.env.PATH || '').split(sep).filter(Boolean);
  const todos = [...actuales, ...dirsExtra()];
  const vistos = new Set();
  const limpio = [];
  for (const d of todos) { if (d && !vistos.has(d)) { vistos.add(d); limpio.push(d); } }
  return limpio.join(sep);
}

// Entorno para el hijo, con el PATH ampliado.
function entorno() {
  return Object.assign({}, process.env, { PATH: pathAmpliado() });
}

// Resuelve la RUTA ABSOLUTA del binario (o su nombre si no se encuentra, como
// último recurso). Override manual con la variable de entorno CLAUDE_BIN.
function resolverBin() {
  if (process.env.CLAUDE_BIN) return process.env.CLAUDE_BIN;
  const nombre = nombreBin();
  const candidatosNombre = ES_WIN ? ['claude.cmd', 'claude.exe', 'claude'] : ['claude'];
  for (const dir of dirsExtra()) {
    for (const n of candidatosNombre) {
      const cand = path.join(dir, n);
      try { fs.accessSync(cand, fs.constants.X_OK); return cand; } catch (_) { /* siguiente */ }
    }
  }
  return nombre; // deja que el SO lo resuelva con el PATH ampliado
}

// ¿Está Claude Code instalado y responde? GET /v1/agente/estado.
function estado() {
  return new Promise((resolve) => {
    const bin = resolverBin();
    let done = false;
    const fin = (v) => { if (!done) { done = true; resolve(v); } };
    let out = '';
    let proc;
    try {
      proc = spawn(bin, ['--version'], { stdio: ['ignore', 'pipe', 'ignore'], env: entorno() });
    } catch (err) {
      return fin({ disponible: false, ruta: bin, error: (err && err.message) || 'no ejecutable' });
    }
    proc.stdout.on('data', (d) => { out += d.toString('utf8'); });
    proc.on('error', (err) => fin({ disponible: false, ruta: bin, error: (err && err.message) || 'no encontrado' }));
    proc.on('close', (code) => fin({ disponible: code === 0, version: out.trim() || null, ruta: bin }));
    setTimeout(() => { try { proc && proc.kill(); } catch (_) { /* ignore */ } fin({ disponible: false, ruta: bin, error: 'timeout' }); }, 4000);
  });
}

// Ejecuta el agente y hace streaming NDJSON. `setCors` viene de server.js.
// Cada línea del cuerpo es un objeto JSON: o bien un evento del stream-json de
// Claude Code (type: system|assistant|user|result…), o uno de los nuestros:
//   { type:'__error__', error, codigo }   fallo antes/durante el arranque
//   { type:'__fin__', code, stderr? }      el proceso terminó
async function ejecutar(req, res, ctx, body, setCors) {
  const errJson = (status, codigo, error) => {
    setCors(res, req);
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ error: String(error || codigo), codigo }));
  };

  const prompt = body && body.prompt;
  if (!prompt || typeof prompt !== 'string') {
    return errJson(400, 'CUERPO_INVALIDO', 'Falta "prompt"');
  }

  // cwd de trabajo:
  //  - ABSOLUTO: carpeta que el usuario eligió en el diálogo nativo (debe existir).
  //  - RELATIVO: subcarpeta dentro de la raíz de trabajo (~/.multiplika), sin "..".
  let cwd = ctx.workRoot;
  if (body.cwd) {
    const c = String(body.cwd);
    if (path.isAbsolute(c)) {
      try {
        if (!fs.statSync(c).isDirectory()) throw new Error('no es carpeta');
        cwd = c;
      } catch (_) {
        return errJson(400, 'CWD_INVALIDO', 'La carpeta indicada no existe: ' + c);
      }
    } else if (/(^|[\\/])\.\.(?:[\\/]|$)/.test(c)) {
      return errJson(400, 'FS_FUERA_DE_RAIZ', 'cwd fuera del área de trabajo');
    } else {
      cwd = path.resolve(ctx.workRoot, c);
    }
  }

  const bin = resolverBin();
  const permiso = PERMISOS[body.permiso] || PERMISOS.edicion;
  const args = ['-p', String(prompt), '--output-format', 'stream-json', '--verbose', ...permiso];
  if (body.sessionId) args.push('--resume', String(body.sessionId));

  let proc;
  try {
    proc = spawn(bin, args, { cwd, env: entorno() });
  } catch (err) {
    return errJson(400, 'CLI_NO_ENCONTRADO', 'No se pudo lanzar Claude Code: ' + ((err && err.message) || bin));
  }

  // A partir de aquí, respuesta en streaming NDJSON.
  setCors(res, req);
  res.writeHead(200, {
    'Content-Type': 'application/x-ndjson; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    'X-Accel-Buffering': 'no',
  });
  const enviar = (obj) => { try { res.write(JSON.stringify(obj) + '\n'); } catch (_) { /* socket cerrado */ } };

  // Fallo asíncrono al arrancar (p. ej. binario no encontrado → ENOENT).
  proc.on('error', (err) => {
    enviar({
      type: '__error__',
      error: (err && err.code === 'ENOENT')
        ? ('No se encontró el CLI de Claude Code (ruta probada: ' + bin + '). Instálalo o define CLAUDE_BIN.')
        : ((err && err.message) || 'No se pudo ejecutar Claude Code'),
      codigo: err && err.code === 'ENOENT' ? 'CLI_NO_ENCONTRADO' : 'INTERNO',
    });
    try { res.end(); } catch (_) { /* ignore */ }
  });

  // stdout: líneas JSON de stream-json → se reenvían parseadas (una por línea).
  let buf = '';
  proc.stdout.on('data', (d) => {
    buf += d.toString('utf8');
    let idx;
    while ((idx = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, idx); buf = buf.slice(idx + 1);
      const s = line.trim();
      if (!s) continue;
      try { enviar(JSON.parse(s)); } catch (_) { enviar({ type: '__raw__', text: s }); }
    }
  });

  // stderr: se acumula acotado para diagnóstico si el proceso falla.
  let errBuf = '';
  proc.stderr.on('data', (d) => { errBuf += d.toString('utf8'); if (errBuf.length > 8000) errBuf = errBuf.slice(-8000); });

  proc.on('close', (code) => {
    const rest = buf.trim();
    if (rest) { try { enviar(JSON.parse(rest)); } catch (_) { enviar({ type: '__raw__', text: rest }); } }
    enviar({ type: '__fin__', code, stderr: code === 0 ? undefined : (errBuf.slice(-2000) || undefined) });
    try { res.end(); } catch (_) { /* ignore */ }
  });

  // Si LEIA aborta el fetch (el usuario pulsa "Detener"), matamos el proceso.
  req.on('close', () => { try { proc.kill('SIGTERM'); } catch (_) { /* ignore */ } });
}

// Diálogo nativo para elegir la carpeta de trabajo. Lo resuelve main.js (Electron)
// vía el callback ctx.elegirCarpeta; aquí solo lo invocamos. POST /v1/agente/elegir-carpeta.
async function elegirCarpeta(ctx) {
  if (ctx && typeof ctx.elegirCarpeta === 'function') {
    try { return await ctx.elegirCarpeta(); } catch (_) { return null; }
  }
  return null;
}

// Instala Claude Code (npm global) y hace streaming del progreso (NDJSON).
// POST /v1/agente/instalar. Requiere Node/npm ya en el equipo.
async function instalar(req, res, ctx, body, setCors) {
  setCors(res, req);
  res.writeHead(200, {
    'Content-Type': 'application/x-ndjson; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    'X-Accel-Buffering': 'no',
  });
  const enviar = (obj) => { try { res.write(JSON.stringify(obj) + '\n'); } catch (_) { /* socket cerrado */ } };
  const npm = ES_WIN ? 'npm.cmd' : 'npm';
  const args = ['install', '-g', '@anthropic-ai/claude-code'];
  enviar({ type: 'log', text: '$ ' + npm + ' ' + args.join(' ') });

  let proc;
  try {
    proc = spawn(npm, args, { env: entorno() });
  } catch (err) {
    enviar({ type: '__error__', error: 'No se encontró npm. Instala Node.js primero.', codigo: 'NPM_NO_ENCONTRADO' });
    try { res.end(); } catch (_) { /* ignore */ }
    return;
  }
  proc.on('error', (err) => {
    const noNpm = err && err.code === 'ENOENT';
    enviar({
      type: '__error__',
      error: noNpm ? 'No se encontró npm. Instala Node.js primero.' : ((err && err.message) || 'Fallo al instalar'),
      codigo: noNpm ? 'NPM_NO_ENCONTRADO' : 'INTERNO',
    });
    try { res.end(); } catch (_) { /* ignore */ }
  });
  const onData = (d) => {
    for (const line of d.toString('utf8').split(/\r?\n/)) {
      if (line.trim()) enviar({ type: 'log', text: line });
    }
  };
  proc.stdout.on('data', onData);
  proc.stderr.on('data', onData);
  proc.on('close', (code) => { enviar({ type: '__fin__', code }); try { res.end(); } catch (_) { /* ignore */ } });
  req.on('close', () => { try { proc.kill('SIGTERM'); } catch (_) { /* ignore */ } });
}

module.exports = { estado, ejecutar, elegirCarpeta, instalar };
