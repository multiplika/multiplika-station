// ============================================================
//  Fija la versión de Multiplika Station (MST-05).
//
//  Uso:  npm run version:set -- "1.0.5"    (semver X.Y.Z)
//
//  - Escribe version.json con la versión y la fecha/hora del momento en formato
//    "AAAAMMDD HH:MM" (la app la muestra junto a la versión en Configuración →
//    Actualizaciones, para saber cuándo se generó cada actualización).
//  - Actualiza también package.json (electron-builder/electron-updater lo exigen).
// ============================================================

const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');

const version = process.argv[2];
if (!version) {
  console.error('Uso: npm run version:set -- "1.0.5"');
  process.exit(1);
}
if (!/^\d+\.\d+\.\d+(-[\w.]+)?$/.test(version)) {
  console.error('La versión debe ser semver (X.Y.Z): ' + version);
  process.exit(1);
}

function pad(n) { return String(n).padStart(2, '0'); }
const d = new Date();
const marca = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;

const info = { version, date: marca };
fs.writeFileSync(path.join(root, 'version.json'), JSON.stringify(info, null, 2) + '\n', 'utf8');
console.log('version.json ->', version, '(' + marca + ')');

const pkgPath = path.join(root, 'package.json');
const raw = fs.readFileSync(pkgPath, 'utf8');
const updated = raw.replace(/("version"\s*:\s*")[^"]*(")/, '$1' + version + '$2');
fs.writeFileSync(pkgPath, updated, 'utf8');
console.log('package.json -> version', version);
