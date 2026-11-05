// ============================================================
//  Prepara una release de Station por FECHA (MST-02), antes de electron-builder.
//
//  1) Genera la versión por fecha (bump-version.js auto): AAAA.MMDD.HHmm en
//     version.json y package.json.
//  2) Commitea y empuja version.json + package.json.
//  3) Crea y empuja el tag v<version> (lo exige GitHub para una release publicada;
//     evita el 422 de electron-builder). Aborta si esa versión ya se publicó.
//
//  Lo encadena el script "publish:win": node scripts/release.js && electron-builder …
// ============================================================

const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');

function run(cmd, args) {
  const r = spawnSync(cmd, args, { cwd: root, stdio: 'pipe', encoding: 'utf8' });
  return { code: r.status, out: (r.stdout || '').trim(), err: (r.stderr || '').trim() };
}
function die(m) { console.error('ERROR: ' + m); process.exit(1); }

// 1) Versión por fecha.
const bump = run('node', ['scripts/bump-version.js', 'auto']);
if (bump.out) console.log(bump.out);
if (bump.code !== 0) die('bump-version falló: ' + (bump.err || bump.out));

const version = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version;
const tag = 'v' + version;

// 2) Commit + push de la versión.
run('git', ['add', 'version.json', 'package.json']);
const commit = run('git', ['commit', '-m', 'Release ' + version]);
if (commit.code !== 0 && !/nothing to commit|nada para hacer commit/i.test(commit.out + commit.err)) {
  die('no se pudo commitear la versión: ' + (commit.err || commit.out));
}
const pushMain = run('git', ['push', 'origin', 'HEAD:main']);
if (pushMain.code !== 0) die('no se pudo empujar main: ' + (pushMain.err || pushMain.out));

// 3) Tag + push (aborta si esa versión ya se publicó).
const remoteTag = run('git', ['ls-remote', '--tags', 'origin', 'refs/tags/' + tag]);
if (remoteTag.code !== 0) die('no se pudo consultar el remoto: ' + remoteTag.err);
if (remoteTag.out) die('el tag ' + tag + ' ya existe en el remoto: la versión ' + version + ' ya se publicó. Vuelve a lanzar la publicación para generar una versión con la hora actual.');
if (run('git', ['rev-parse', '-q', '--verify', 'refs/tags/' + tag]).code !== 0) {
  const t = run('git', ['tag', tag]);
  if (t.code !== 0) die('no se pudo crear el tag ' + tag + ': ' + t.err);
}
const pushTag = run('git', ['push', 'origin', tag]);
if (pushTag.code !== 0) die('no se pudo empujar el tag ' + tag + ': ' + (pushTag.err || pushTag.out));

console.log('Versión ' + version + ' (tag ' + tag + ') commiteada y empujada. Lista para electron-builder.');
