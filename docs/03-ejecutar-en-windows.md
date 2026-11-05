# Cómo ejecutar Multiplika Station en Windows (modo prueba)

> Guía para arrancar la app en modo desarrollo y probarla en Windows, sin
> generar instalador. Fecha: 2026-07-28.

## Requisito previo: Node.js 22 o superior

1. Descarga Node.js desde https://nodejs.org (elige la versión **LTS**).
2. Ejecuta el instalador `.msi` y acepta las opciones por defecto (deja marcada
   la opción de añadir Node al `PATH`).
3. Comprueba que quedó instalado. Abre **PowerShell** o **Símbolo del sistema
   (CMD)** y escribe:

   ```powershell
   node -v
   ```

   Debe responder `v22.x` o superior.

> Si acabas de instalar Node y `node -v` da "no se reconoce el comando", cierra
> la ventana de PowerShell/CMD y ábrela de nuevo para que cargue el PATH
> actualizado.

## Paso 1 — Abrir una terminal en la carpeta del proyecto

La forma más cómoda:

1. Abre el **Explorador de archivos** y navega hasta la carpeta
   `multiplika_station` (dentro de tu carpeta de Nextcloud → `2. Workspace`).
2. Con la carpeta abierta, haz clic en la **barra de direcciones** del
   Explorador (donde se ve la ruta), escribe `powershell` y pulsa **Enter**.
   Se abrirá PowerShell ya situado dentro de esa carpeta.

Alternativa: abre PowerShell y usa `cd` seguido de la ruta entre comillas, por
ejemplo:

```powershell
cd "$env:USERPROFILE\Nextcloud\2. Workspace\multiplika_station"
```

(La ruta exacta depende de dónde sincronice Nextcloud en tu PC; ajústala si es
distinta.)

Para confirmar que estás en el sitio correcto:

```powershell
dir
```

Debes ver `main.js`, `package.json`, `config.js`, la carpeta `shell`, etc.

## Paso 2 — Instalar dependencias (solo la primera vez)

```powershell
npm install
```

Descarga Electron y electron-builder en `node_modules`. Tarda uno o dos minutos
la primera vez.

## Paso 3 — Arrancar la app

```powershell
npm start
```

Se abrirá la ventana **Multiplika** cargando `https://apiadev.multiplika.net`
con la barra de pestañas.

## Cómo probarla

- **Nueva pestaña**: `Ctrl + T` o el botón `+`.
- **Cerrar pestaña**: `Ctrl + W` (si es la última, pedirá confirmación).
- **Recargar**: `Ctrl + R`.
- **Sin conexión**: desactiva la red y recarga para ver la pantalla "No se pudo
  conectar".

## Cómo cerrar

Cierra la ventana, o vuelve a PowerShell y pulsa `Ctrl + C` para detener el
proceso.

## Problemas frecuentes

| Síntoma | Causa probable | Solución |
|---------|----------------|----------|
| `'node' no se reconoce...` | Node.js no instalado o PATH no cargado | Instala Node LTS y reabre la terminal |
| `'npm' no se reconoce...` | Igual que el anterior | Instala Node.js LTS |
| PowerShell bloquea scripts | Política de ejecución restrictiva | Usa **CMD** en vez de PowerShell, o ejecuta `Set-ExecutionPolicy -Scope Process RemoteSigned` en esa ventana |
| La ventana abre en blanco | Sin conexión o la URL no responde | Comprueba internet / que `apiadev.multiplika.net` responda |
| `npm start` no hace nada | No estás en la carpeta del proyecto | Repite el Paso 1 y verifica con `dir` |

---

*Nota: `npm start` sirve para probar. Para generar el instalador `.exe`
distribuible se usa `npm run dist:win` (paso aparte), y conviene ejecutarlo en
un equipo Windows.*
