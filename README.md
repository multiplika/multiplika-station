# Multiplika Webview

Aplicación de escritorio multiplataforma (macOS, Windows y Linux) construida con
[Electron](https://www.electronjs.org/) que carga la URL `https://apiadev.multiplika.net`
en un navegador **multipestaña** con barra de pestañas, botón de nueva pestaña y
controles de atrás/adelante/recargar.

## Atajos de teclado

| Atajo | Acción |
|-------|--------|
| `Cmd/Ctrl + T` | Nueva pestaña |
| `Cmd/Ctrl + W` | Cerrar pestaña actual |
| `Cmd/Ctrl + R` | Recargar pestaña actual |

## Requisitos

- [Node.js](https://nodejs.org/) 22 o superior (incluye `npm`).

## Ejecutar en modo desarrollo

```bash
npm install     # solo la primera vez
npm start
```

Se abrirá una ventana cargando la URL configurada.

## Cambiar la configuración

Todo lo editable está en **`config.js`**:

| Opción | Descripción |
|--------|-------------|
| `APP_URL` | La URL que carga la app. |
| `WINDOW_TITLE` | Título de la ventana. |
| `WIDTH` / `HEIGHT` | Tamaño inicial de la ventana. |
| `MIN_WIDTH` / `MIN_HEIGHT` | Tamaño mínimo. |
| `OPEN_EXTERNAL_LINKS_IN_BROWSER` | Abrir enlaces a otros dominios en el navegador del sistema. |
| `AUTO_HIDE_MENU_BAR` | Ocultar la barra de menús en Windows/Linux. |

## Generar instaladores

Cada instalador se genera preferentemente **en su propio sistema operativo**:

```bash
npm run dist:mac     # genera un .dmg   (ejecutar en macOS)
npm run dist:win     # genera un .exe   (ejecutar en Windows)
npm run dist:linux   # genera un .AppImage (ejecutar en Linux)
```

Los archivos resultantes aparecen en la carpeta `dist/`.

### Generar las 3 plataformas sin tener las 3 máquinas

El proyecto incluye un flujo de **GitHub Actions** (`.github/workflows/build.yml`)
que compila automáticamente los tres instaladores en la nube. Sube el proyecto a
un repositorio de GitHub y:

- Ejecútalo manualmente desde la pestaña **Actions → Build installers → Run workflow**, o
- Crea una etiqueta de versión: `git tag v1.0.0 && git push --tags`.

Los instaladores quedan disponibles como *artifacts* de la ejecución.

## Icono de la app

En `build/icon.png` hay un icono de marcador de posición (1024×1024). Sustitúyelo
por el logotipo definitivo de Multiplika (mismo nombre y tamaño mínimo 512×512) y
electron-builder generará automáticamente los formatos de cada plataforma.

## Estructura

```
multiplika-webview/
├── main.js                  # Proceso principal: ventana + gestión de pestañas
├── preload.js               # Puente seguro para la página de error
├── config.js                # ⚙️  Configuración editable (URL, tamaño, etc.)
├── package.json             # Dependencias y configuración de instaladores
├── shell/
│   ├── shell.html           # Barra de pestañas + toolbar (interfaz)
│   ├── shell.js             # Lógica de la barra de pestañas
│   └── preload-shell.js     # Puente seguro de la barra de pestañas
├── assets/
│   └── error.html           # Pantalla de "sin conexión" con botón de reintento
├── build/
│   └── icon.png             # Icono de la app (reemplazar por el logo real)
└── .github/workflows/
    └── build.yml            # CI para generar los 3 instaladores
```
