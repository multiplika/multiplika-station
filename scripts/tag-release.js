// ============================================================
//  Crea y empuja el tag vX.Y.Z ANTES de publicar la release en GitHub.
//
//  electron-builder, con `publish.releaseType: "release"`, pide a GitHub crear una
//  release PUBLICADA; si el tag vX.Y.Z no existe aún, GitHub responde
//  422 "Published releases must have a valid tag" y la subida queda a medias
//  (sube el .exe pero no latest.yml ni el blockmap). Este paso evita ese error:
//  empuja el tag primero. Lo ejecuta el script "publish:win" antes de electron-builder.
//
//  La versión sale de version.json (la pone `npm run version:set`). Si esa versión
//  ya está publicada (el tag existe en el remoto), aborta: hay que subir la versión.
// ============================================================

const { spawnSync } = require('child_process');
const path = require('path');
const root = path.join(__dirname, '..');

function git(args) {
  const r = spawnSync('git', args, { cwd: root, stdio: 'pipe', encoding: 'utf8' });
  return { code: r.status, out: (r.stdout || '').trim(), err: (r.stderr || '').trim() };
}
function die(m) { console.error('ERROR: ' + m); process.exit(1); }

let version;
try { version = require(path.join(root, 'version.json')).version; } catch (_) { die('no puedo leer version.json'); }
if (!/^\d+\.\d+\.\d+(-[\w.]+)?$/.test(version)) {
  die('version.json no es semver ("' + version + '"). Sube la versión con: npm run version:set -- X.Y.Z');
}
const tag = 'v' + version;

// ¿Ya existe el tag en el remoto? Entonces esa versión ya se publicó.
const remote = git(['ls-remote', '--tags', 'origin', 'refs/tags/' + tag]);
if (remote.code !== 0) die('no se pudo consultar el remoto: ' + remote.err);
if (remote.out) {
  die('el tag ' + tag + ' ya existe en el remoto: la versión ' + version +
      ' ya se publicó. Sube la versión (npm run version:set -- X.Y.Z) antes de publicar.');
}

// Crear el tag local (apunta al HEAD: el commit de esta versión) si no está.
if (git(['rev-parse', '-q', '--verify', 'refs/tags/' + tag]).code !== 0) {
  const t = git(['tag', tag]);
  if (t.code !== 0) die('no se pudo crear el tag ' + tag + ': ' + t.err);
  console.log('Tag ' + tag + ' creado en HEAD.');
} else {
  console.log('Tag ' + tag + ' ya existía en local.');
}

// Empujar el tag (es lo que necesita GitHub para aceptar la release publicada).
const p = git(['push', 'origin', tag]);
if (p.code !== 0) die('no se pudo empujar el tag ' + tag + ': ' + p.err);
console.log('Tag ' + tag + ' empujado al remoto. Listo para electron-builder.');
