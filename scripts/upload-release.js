// ============================================================
//  Sube la release de Station a GitHub con `gh` (determinista).
//
//  Sustituye al publicador de electron-builder, que en esta versión crea la release
//  en paralelo y colisiona (422 "valid tag" / "already_exists"), subiendo el .exe pero
//  dejándose latest.yml. Aquí compilamos con electron-builder SIN publicar y subimos
//  nosotros, con los nombres que espera electron-updater.
//
//  Lo encadena "publish:win":  release.js  &&  electron-builder --win  &&  upload-release.js
//  Usa la sesión de `gh` (cuenta activa); no necesita GH_TOKEN.
// ============================================================

const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const dist = path.join(root, 'dist');
const REPO = 'multiplika/multiplika-station';

function gh(args) { return spawnSync('gh', args, { cwd: root, stdio: 'pipe', encoding: 'utf8' }); }
function die(m) { console.error('ERROR: ' + m); process.exit(1); }

const version = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version;
const tag = 'v' + version;

const latestPath = path.join(dist, 'latest.yml');
if (!fs.existsSync(latestPath)) {
  die('falta dist/latest.yml (¿compilaste con electron-builder --win?).');
}
// Salvaguarda: el latest.yml tiene que ser de ESTA versión (electron-builder a veces
// deja uno obsoleto si falla). Si no coincide, abortar para no publicar un manifiesto
// que apunte a otra versión (rompería la autoactualización).
const ymlMatch = fs.readFileSync(latestPath, 'utf8').match(/^version:\s*(.+)$/m);
const ymlVersion = ymlMatch ? ymlMatch[1].trim() : null;
if (ymlVersion !== version) {
  die('dist/latest.yml es de la versión ' + ymlVersion + ', no ' + version + '. Recompila (npm run dist:win) antes de subir.');
}
let exes = fs.readdirSync(dist).filter((f) => /\.exe$/i.test(f));
if (!exes.length) die('no hay instalador .exe en ' + dist);
exes.sort((a, b) => fs.statSync(path.join(dist, b)).mtimeMs - fs.statSync(path.join(dist, a)).mtimeMs);
const exe = exes[0];
const blockmap = exe + '.blockmap';

// electron-updater espera los nombres con guiones (como en latest.yml). Los ficheros
// locales llevan espacios: hacemos copias con guiones para subirlas con ese nombre.
function hyphen(n) { return n.replace(/ /g, '-'); }
const uploads = [];
for (const f of [exe, blockmap]) {
  const src = path.join(dist, f);
  if (!fs.existsSync(src)) continue;
  const hy = hyphen(f);
  if (hy !== f) fs.copyFileSync(src, path.join(dist, hy));
  uploads.push(hy);
}
uploads.push('latest.yml');

// Crear la release si no existe; si existe, subir/actualizar sus assets.
const view = gh(['release', 'view', tag, '--repo', REPO]);
if (view.status !== 0) {
  const cr = gh(['release', 'create', tag, '--repo', REPO, '--title', 'Multiplika Station ' + version, '--notes', 'Release ' + version, '--latest']);
  if (cr.status !== 0) die('no se pudo crear la release ' + tag + ': ' + (cr.stderr || '').trim());
  console.log('Release ' + tag + ' creada.');
} else {
  console.log('Release ' + tag + ' ya existe; actualizo sus assets.');
}

const up = gh(['release', 'upload', tag, ...uploads.map((u) => path.join(dist, u)), '--repo', REPO, '--clobber']);
if (up.stdout) process.stdout.write(up.stdout);
if (up.status !== 0) die('no se pudieron subir los assets: ' + (up.stderr || '').trim());
console.log('Assets en ' + tag + ': ' + uploads.join(', '));
