# Cómo ejecutar Multiplika Station en macOS (modo prueba)

> Guía para arrancar la app en modo desarrollo y probarla, sin generar
> instalador. Fecha: 2026-07-28.

## Requisito previo: Node.js 22 o superior

Comprueba si ya lo tienes. Abre **Terminal** (Aplicaciones → Utilidades →
Terminal) y escribe:

```bash
node -v
```

- Si responde algo como `v22.x` o superior → ya lo tienes, pasa al
  siguiente paso.
- Si dice "command not found" o una versión inferior a 22 → instala Node.js:
  - Opción sencilla: descárgalo de https://nodejs.org (versión **LTS**) e
    instala el `.pkg`.
  - Opción con Homebrew (si lo usas): `brew install node`

## Paso 1 — Ir a la carpeta del proyecto

En Terminal, escribe `cd ` (con un espacio al final) y **arrastra la carpeta
`multiplika_station` desde Finder hasta la ventana de Terminal**. Se pegará la
ruta automáticamente con el formato correcto. Luego pulsa Enter.

> Se recomienda arrastrar la carpeta porque la ruta está dentro de Nextcloud y
> contiene espacios y caracteres especiales; escribirla a mano es propenso a
> errores.

Para confirmar que estás en el sitio correcto:

```bash
ls
```

Debes ver `main.js`, `package.json`, `config.js`, la carpeta `shell`, etc.

## Paso 2 — Instalar dependencias (solo la primera vez)

```bash
npm install
```

Esto descarga Electron y electron-builder en una carpeta `node_modules`. Puede
tardar uno o dos minutos la primera vez. En arranques posteriores **no** hace
falta repetirlo (salvo que cambien las dependencias).

## Paso 3 — Arrancar la app

```bash
npm start
```

Se abrirá una ventana de escritorio titulada **Multiplika** cargando
`https://apiadev.multiplika.net` con la barra de pestañas.

## Cómo probarla

- **Nueva pestaña**: `Cmd + T` o el botón `+` de la barra.
- **Cerrar pestaña**: `Cmd + W` (si es la última, pedirá confirmación para salir).
- **Recargar**: `Cmd + R`.
- **Sin conexión**: si apagas el WiFi y recargas, verás la pantalla "No se pudo
  conectar" con el botón *Reintentar*.

## Cómo cerrar

Cierra la ventana normalmente, o pulsa `Cmd + Q`, o vuelve a la Terminal y pulsa
`Ctrl + C` para detener el proceso.

## Problemas frecuentes

| Síntoma | Causa probable | Solución |
|---------|----------------|----------|
| `command not found: npm` | Node.js no instalado | Instala Node.js (ver arriba) |
| `command not found: node` | Igual que el anterior | Instala Node.js LTS |
| La ventana abre en blanco | Sin conexión o la URL no responde | Comprueba internet / que `apiadev.multiplika.net` esté activo |
| `npm start` no hace nada | No estás en la carpeta del proyecto | Repite el Paso 1 y verifica con `ls` |

---

*Nota: `npm start` sirve para probar. Para generar el instalador `.dmg`
distribuible se usa `npm run dist:mac` (eso es otro paso distinto).*
