// ============================================================
//  Compila el "Descargador de modelos AEAT" (.NET 8) para meterlo en el instalador.
//
//  Station lo lleva dentro (resources/descargador) y lo arranca ella misma
//  (station/descargador.js), así que el usuario no tiene que encenderlo a mano.
//
//  Se publica AUTOCONTENIDO (win-x64, con su propio runtime de .NET): los equipos de
//  los clientes no tienen por qué tener .NET instalado. Deja el resultado en
//  vendor/descargador, que electron-builder copia como extraResources (ver package.json).
//
//  El código del descargador vive fuera de este repositorio. Por defecto:
//    ../multiplika_leia/laboratorio/descargador de modelos/src/DescargadorModelos
//  Se puede cambiar con la variable de entorno DESCARGADOR_SRC.
//
//  Uso: npm run build:descargador   (lo encadena también publish:win)
// ============================================================

const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const destino = path.join(root, 'vendor', 'descargador');
const fuente = path.resolve(
  process.env.DESCARGADOR_SRC ||
    path.join(root, '..', 'multiplika_leia', 'laboratorio', 'descargador de modelos', 'src', 'DescargadorModelos')
);

function die(m) { console.error('ERROR: ' + m); process.exit(1); }

if (!fs.existsSync(path.join(fuente, 'DescargadorModelos.csproj'))) {
  die('no encuentro el proyecto del descargador en ' + fuente + ' (usa DESCARGADOR_SRC).');
}

// Limpia la salida anterior: así no viajan ficheros de una compilación vieja.
fs.rmSync(destino, { recursive: true, force: true });

console.log('Compilando el descargador (autocontenido, win-x64)…');
console.log('  desde: ' + fuente);
const r = spawnSync('dotnet', [
  'publish', fuente,
  '-c', 'Release',
  '-r', 'win-x64',
  '--self-contained', 'true',
  '-p:DebugType=none',          // sin .pdb en el instalador
  '-p:GenerateDocumentationFile=false',
  '-o', destino,
], { stdio: 'inherit', shell: false });
if (r.error) die('no se pudo ejecutar dotnet: ' + r.error.message + ' (¿está instalado el SDK de .NET 8?).');
if (r.status !== 0) die('dotnet publish terminó con código ' + r.status + '.');

const exe = path.join(destino, 'DescargadorModelos.exe');
if (!fs.existsSync(exe)) die('la compilación no generó ' + exe);

// Tamaño total, para que se vea lo que añade al instalador.
let bytes = 0;
(function sumar(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) sumar(p); else bytes += fs.statSync(p).size;
  }
})(destino);
console.log(`Descargador listo en ${destino} (${(bytes / 1048576).toFixed(1)} MB sin comprimir).`);
