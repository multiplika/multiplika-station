# Multiplika Station — Análisis del proyecto

> Documento de estudio inicial. Describe qué es el proyecto, cómo está
> estructurado y cómo funciona cada pieza. Fecha: 2026-07-28.

## 1. Qué es

**Multiplika Station** (nombre interno del paquete: `multiplika-webview`) es una
**aplicación de escritorio multiplataforma** (macOS, Windows y Linux) construida
con [Electron](https://www.electronjs.org/).

Su función es envolver una única web —`https://apiadev.multiplika.net`— dentro de
una ventana de escritorio nativa, dándole aspecto y comportamiento de navegador
**multipestaña**: barra de pestañas, botón de nueva pestaña y navegación
atrás/adelante/recargar. En la práctica convierte una aplicación web en una app
instalable de escritorio.

Versión actual: **1.0.0**. Licencia: MIT. `appId`: `net.multiplika.apiadev`.

## 2. Estructura de archivos

```
multiplika_station/
├── main.js                # Proceso principal de Electron: ventana + gestión de pestañas
├── preload.js             # Puente seguro para la página de error
├── config.js              # ⚙️ Configuración editable (URL, tamaño de ventana, etc.)
├── package.json           # Dependencias y configuración de electron-builder
├── README.md              # Documentación de uso
├── shell/
│   ├── shell.html         # Interfaz de la barra de pestañas (HTML + CSS)
│   ├── shell.js           # Lógica de la barra de pestañas (renderizado)
│   └── preload-shell.js   # Puente seguro de la barra de pestañas
├── assets/
│   └── error.html         # Pantalla de "sin conexión" con botón de reintento
└── build/
    └── icon.png           # Icono de la app (marcador de posición, reemplazable)
```

> Nota: el README menciona un flujo de CI en `.github/workflows/build.yml` para
> generar los tres instaladores en la nube, pero ese archivo **no está presente**
> en la copia actual del proyecto (ver sección 7).

## 3. Arquitectura y flujo de ejecución

La app sigue el modelo estándar de Electron con separación de procesos:

1. **Proceso principal** (`main.js`): arranca cuando la app está lista
   (`app.whenReady()`), crea la ventana principal (`BrowserWindow`) y carga como
   "cromo" la interfaz `shell/shell.html`.
2. Cuando el shell termina de cargar, se crea automáticamente la **primera
   pestaña** apuntando a `config.APP_URL`.
3. Cada pestaña es un **`WebContentsView`** independiente que se coloca justo
   debajo de la barra de pestañas (a partir de `y = 44px`, la altura del "chrome").
4. La barra de pestañas (`shell.js`) y el proceso principal se comunican por
   **IPC** a través de puentes seguros (`preload-shell.js`).

### Modelo de pestañas

- Las pestañas se guardan en un `Map` (`id -> WebContentsView`), con un
  `activeTabId` y un contador `nextTabId`.
- Solo la vista activa se añade a la ventana (`addChildView`); al cambiar de
  pestaña se quita la anterior y se coloca la nueva, reajustando su tamaño con
  `layoutActiveView()`.
- Al redimensionar la ventana se recoloca la vista activa.

## 4. Configuración (`config.js`)

Todo lo editable está centralizado en `config.js`:

| Opción | Valor actual | Descripción |
|--------|--------------|-------------|
| `APP_URL` | `https://apiadev.multiplika.net` | URL única que carga la app |
| `WINDOW_TITLE` | `Multiplika` | Título de la ventana |
| `WIDTH` / `HEIGHT` | `1280` / `800` | Tamaño inicial |
| `MIN_WIDTH` / `MIN_HEIGHT` | `400` / `300` | Tamaño mínimo |
| `OPEN_EXTERNAL_LINKS_IN_BROWSER` | `true` | Abre dominios externos en el navegador del sistema |
| `AUTO_HIDE_MENU_BAR` | `true` | Oculta la barra de menús en Windows/Linux |

> Observación: `AUTO_HIDE_MENU_BAR` está definido en `config.js` pero **no se usa
> en `main.js`** (no se aplica `autoHideMenuBar` al crear la ventana). Ver
> sección 7.

## 5. Comportamiento de navegación y enlaces

La lógica de apertura de enlaces (en `createTab`) distingue por origen:

- **Enlace que abre ventana nueva** (`setWindowOpenHandler`):
  - Mismo dominio → nueva pestaña dentro de la app.
  - Dominio externo → navegador del sistema (si `OPEN_EXTERNAL_LINKS_IN_BROWSER`).
- **Navegación a dominio externo en la misma pestaña** (`will-navigate`) → se
  cancela y se abre fuera de la app.
- La comparación de origen se hace con `isSameOrigin()` comparando `URL.origin`
  contra `APP_URL`.

### Manejo de errores de carga

Si falla la carga del frame principal (`did-fail-load`, salvo el código `-3` que
es una cancelación normal), la pestaña carga `assets/error.html`, una pantalla de
"No se pudo conectar" con detalle técnico opcional y un botón **Reintentar** que,
vía IPC (`retry-load`), pide al proceso principal recargar `APP_URL`.

## 6. Atajos de teclado y seguridad

**Atajos** (registrados con `before-input-event`, funcionan tenga el foco el shell
o una pestaña; `Cmd` en macOS, `Ctrl` en el resto):

| Atajo | Acción |
|-------|--------|
| `Cmd/Ctrl + T` | Nueva pestaña |
| `Cmd/Ctrl + W` | Cerrar pestaña actual |
| `Cmd/Ctrl + R` | Recargar pestaña actual |

Al cerrar la **última** pestaña se muestra un diálogo de confirmación
("¿Quieres salir del programa?") antes de cerrar la app.

**Seguridad**: la app sigue las buenas prácticas de Electron —
`contextIsolation: true`, `nodeIntegration: false`, y puentes mínimos vía
`contextBridge` que exponen solo lo estrictamente necesario (`tabsApi` para el
shell y `appBridge.retry` para la página de error). El shell aplica además una
**CSP** restrictiva. La navegación usa helpers compatibles con distintas versiones
de Electron (`navCanGoBack`/`navGoBack`, etc.), porque la API de historial cambió
entre versiones.

## 7. Empaquetado y distribución

Configurado con **electron-builder** (`build` en `package.json`):

| Plataforma | Target | Comando |
|------------|--------|---------|
| macOS | `dmg` | `npm run dist:mac` |
| Windows | `nsis` (`.exe`) | `npm run dist:win` |
| Linux | `AppImage` | `npm run dist:linux` |

Salida en la carpeta `dist/`. El instalador NSIS de Windows permite elegir carpeta
y crea acceso directo en el escritorio.

Dependencias de desarrollo: `electron ^43.2.0` y `electron-builder ^24.13.3`.
La app **no tiene dependencias de producción** (solo `devDependencies`), lo cual
es coherente con un wrapper tan ligero.

## 8. Observaciones y posibles mejoras

Puntos detectados durante el estudio (no son errores críticos, pero conviene
tenerlos en cuenta):

1. **`AUTO_HIDE_MENU_BAR` no se aplica.** Está en `config.js` pero `main.js` no lo
   pasa a `BrowserWindow` (`autoHideMenuBar: config.AUTO_HIDE_MENU_BAR`).
2. **Falta el workflow de CI.** El README documenta
   `.github/workflows/build.yml`, pero ese archivo no está en el proyecto.
3. **No hay botones visibles de atrás/adelante/recargar en la barra.** El README y
   el IPC (`nav:back/forward/reload`) contemplan esos controles y `shell.js` los
   soporta vía `tabsApi`, pero `shell.html`/`shell.js` solo pintan pestañas y el
   botón "+"; la navegación queda accesible únicamente por atajos de teclado.
4. **URL de desarrollo.** `APP_URL` apunta a `apiadev.multiplika.net` (entorno de
   *dev*). Conviene confirmar cuál debe ser la URL de producción antes de generar
   instaladores para usuarios finales.
5. **Icono placeholder.** `build/icon.png` es un marcador de posición pendiente de
   sustituir por el logo definitivo (mínimo 512×512).

---

*Este documento resume el estado del proyecto tal y como está en el repositorio
local a fecha 2026-07-28.*
