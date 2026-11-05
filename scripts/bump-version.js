// ============================================================
//  Fija la versión de Multiplika Station (MST-05 + MST-02).
//
//  Uso:
//    node scripts/bump-version.js auto        -> versión por FECHA (lo habitual)
//    node scripts/bump-version.js "X.Y.Z"     -> versión manual (semver)
//
//  Versión por fecha ("auto"): AAAA.MMDD.HHmm  (p. ej. 2026-11-05 20:15 -> 2026.1105.2015).
//  Así, mirando la versión se sabe CUÁNDO se generó la actualización. Lleva puntos
//  porque electron-updater/electron-builder exigen semver (3 números) para comparar
//  versiones y decidir si hay que actualizar; un número plano (AAAAMMDDHHmm) no vale.
//  Los componentes son enteros (mes*100+día y hora*100+min) para que sea semver válido
//  (sin ceros a la izquierda) y crezca de forma cronológica.
//
//  version.json.date guarda además la marca legible "AAAAMMDD HH:MM".
// ============================================================

const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');

const arg = process.argv[2];
if (!arg) {
  console.error('Uso: node scripts/bump-version.js auto | "X.Y.Z"');
  process.exit(1);
}

function pad(n) { return String(n).padStart(2, '0'); }

const now = new Date();
const Y = now.getFullYear(), Mo = now.getMonth() + 1, Da = now.getDate(), H = now.getHours(), Mi = now.getMinutes();
const marca = `${Y}${pad(Mo)}${pad(Da)} ${pad(H)}:${pad(Mi)}`; // "AAAAMMDD HH:MM"

let version;
if (arg === 'auto') {
  version = `${Y}.${Mo * 100 + Da}.${H * 100 + Mi}`;           // 2026.1105.2015
} else {
  if (!/^\d+\.\d+\.\d+(-[\w.]+)?$/.test(arg)) {
    console.error('La versión manual debe ser semver (X.Y.Z). Para versión por fecha usa "auto".');
    process.exit(1);
  }
  version = arg;
}

// version.json (fuente de la versión mostrada en la app) = version + fecha legible.
const info = { version, date: marca };
fs.writeFileSync(path.join(root, 'version.json'), JSON.stringify(info, null, 2) + '\n', 'utf8');
console.log('version.json ->', version, '(' + marca + ')');

// package.json SIEMPRE con semver (es lo que usa electron-updater).
const pkgPath = path.join(root, 'package.json');
const raw = fs.readFileSync(pkgPath, 'utf8');
const updated = raw.replace(/("version"\s*:\s*")[^"]*(")/, '$1' + version + '$2');
fs.writeFileSync(pkgPath, updated, 'utf8');
console.log('package.json -> version', version);
