// ============================================================
//  Subir la versión de Multiplika Station (MST-05)
//
//  Uso:  npm run version:set -- "<versión>"
//  Ej.:  npm run version:set -- "1.1.0"
//        npm run version:set -- "2026 verano"
//
//  - Escribe version.json con la versión (formato libre) y la fecha y
//    hora del momento en formato AAAAMMDD HH:MM.
//  - Si la versión es semver (X.Y.Z), actualiza también package.json
//    (los instaladores de electron-builder lo requieren); si no lo es,
//    package.json no se toca.
// ============================================================

const fs = require('fs');
const path = require('path');

const version = process.argv[2];
if (!version) {
  console.error('Uso: npm run version:set -- "<versión>"');
  process.exit(1);
}

// Fecha y hora actuales en formato AAAAMMDD HH:MM.
function stamp() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

const info = { version: String(version), date: stamp() };
const root = path.join(__dirname, '..');

fs.writeFileSync(path.join(root, 'version.json'), JSON.stringify(info, null, 2) + '\n', 'utf8');
console.log('version.json ->', info.version, '(' + info.date + ')');

// package.json solo si es semver (se sustituye el valor sin reformatear el archivo).
if (/^\d+\.\d+\.\d+(-[\w.]+)?$/.test(info.version)) {
  const pkgPath = path.join(root, 'package.json');
  const raw = fs.readFileSync(pkgPath, 'utf8');
  const updated = raw.replace(/("version"\s*:\s*")[^"]*(")/, '$1' + info.version + '$2');
  fs.writeFileSync(pkgPath, updated, 'utf8');
  console.log('package.json -> version', info.version);
} else {
  console.log('Aviso: la versión no es semver; package.json no se modifica.');
}
