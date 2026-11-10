// ============================================================
//  Descargador de modelos AEAT, gestionado por Station.
//
//  El descargador es un programa .NET aparte (baja los justificantes de la AEAT con el
//  certificado del equipo) que escucha en http://127.0.0.1:5178. Station lo lleva dentro
//  del instalador (resources/descargador) y se encarga de él:
//    - lo enciende al arrancar y, si se ha caído, otra vez justo antes de usarlo;
//    - le dice dónde guardar sus datos y PDFs (fuera de la carpeta de instalación, que
//      se reemplaza en cada actualización);
//    - lo apaga al cerrarse (si no, Windows lo dejaría vivo y bloquearía la actualización).
//
//  Si ya hay un descargador escuchando (p. ej. uno arrancado a mano), se usa ese y no se
//  toca: solo se apaga el que haya encendido Station.
//
//  Este módulo NO depende de Electron (recibe rutas) para poder probarse en Node puro.
// ============================================================

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const PUERTO = 5178;
const URL_BASE = `http://127.0.0.1:${PUERTO}`;
const ESPERA_ARRANQUE_MS = 20000; // la primera vez Windows tarda en cargar el runtime de .NET

const dormir = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * @param {object} o
 * @param {string} o.exe      ruta de DescargadorModelos.exe
 * @param {string} o.carpeta  carpeta de trabajo: se crean dentro "datos" y "descargas"
 * @param {object} [o.log]    con info/warn (por defecto, console)
 */
function crearDescargador({ exe, carpeta, log = console }) {
  let hijo = null;       // proceso que ha encendido Station (null si no hay o no es nuestro)
  let enCurso = null;    // arranque en marcha: evita encender dos a la vez

  async function responde(ms = 1500) {
    try {
      const r = await fetch(URL_BASE + '/api/estado', { signal: AbortSignal.timeout(ms) });
      return r.ok;
    } catch (_) {
      return false;
    }
  }

  const instalado = () => process.platform === 'win32' && !!exe && fs.existsSync(exe);

  function lanzar() {
    const datos = path.join(carpeta, 'datos');
    const descargas = path.join(carpeta, 'descargas');
    fs.mkdirSync(datos, { recursive: true });
    fs.mkdirSync(descargas, { recursive: true });

    const proc = spawn(exe, [
      `--Descargador:CarpetaDatos=${datos}`,
      `--Descargador:CarpetaDescargas=${descargas}`,
      '--sin-navegador',
    ], { cwd: path.dirname(exe), windowsHide: true, stdio: 'ignore' });
    hijo = proc;
    proc.on('error', (e) => log.warn('[descargador] no se pudo lanzar:', e.message));
    proc.on('exit', (code) => {
      if (hijo === proc) hijo = null;
      log.info(`[descargador] se ha cerrado (código ${code}).`);
    });
    return proc;
  }

  async function encender() {
    if (await responde()) return { ok: true, propio: !!hijo };
    // Si ya lanzamos uno que aún está arrancando (la primera vez puede tardar, p. ej. mientras
    // el antivirus revisa sus ficheros), se le espera: lanzar otro solo chocaría por el puerto.
    let proc = hijo;
    if (!proc) {
      if (!instalado()) {
        return { ok: false, motivo: 'Este equipo no tiene el descargador de modelos instalado.' };
      }
      proc = lanzar();
    }

    const t0 = Date.now();
    while (Date.now() - t0 < ESPERA_ARRANQUE_MS) {
      if (await responde(1000)) {
        log.info('[descargador] encendido en ' + URL_BASE);
        return { ok: true, propio: hijo === proc };
      }
      if (hijo !== proc) break; // se cerró nada más arrancar
      await dormir(300);
    }
    return {
      ok: false,
      motivo: hijo === proc
        ? 'El descargador de modelos aún está arrancando; vuelve a intentarlo en un momento.'
        : 'El descargador de modelos no ha arrancado.',
    };
  }

  /** Enciende el descargador si no está escuchando. Devuelve { ok, propio?, motivo? }. */
  function asegurar() {
    if (!enCurso) enCurso = encender().finally(() => { enCurso = null; });
    return enCurso;
  }

  /** Apaga el descargador SOLO si lo encendió Station. Espera a que salga (máx. ~4 s). */
  async function apagar() {
    const proc = hijo;
    if (!proc) return;
    // Primero por las buenas: así guarda la cola de trabajos antes de salir.
    try {
      await fetch(URL_BASE + '/api/apagar', {
        method: 'POST',
        headers: { 'X-Descargador': '1' },
        signal: AbortSignal.timeout(1500),
      });
    } catch (_) { /* si no contesta, se le cierra abajo */ }
    await new Promise((resolve) => {
      if (proc.exitCode !== null) return resolve();
      const t = setTimeout(() => { try { proc.kill(); } catch (_) {} resolve(); }, 2500);
      proc.once('exit', () => { clearTimeout(t); resolve(); });
    });
    if (hijo === proc) hijo = null;
  }

  return {
    asegurar,
    apagar,
    url: URL_BASE,
    /** true si hay un descargador encendido por Station ahora mismo. */
    get propio() { return !!hijo; },
  };
}

module.exports = { crearDescargador, PUERTO };
