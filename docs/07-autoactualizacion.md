# Autoactualización (MST-02)

Añadido el 2026-11-05. Station ya no depende de reinstalar a mano: usa
**`electron-updater` contra GitHub Releases**, exactamente el modelo del *cliente*
de Multiplika Support.

## Cómo funciona

- El código vive en el repo **público** `multiplika/multiplika-station` (en GitHub,
  la cuenta `multiplika` es la de los proyectos públicos). Que sea público es lo que
  permite que cada equipo descargue la actualización **sin credenciales**.
- En `main.js`, `setupUpdater()` arranca `electron-updater` al abrir la app
  (**solo en la app instalada**; en `npm start` no hace nada). Descarga sola la
  versión nueva y la instala al cerrar (`autoInstallOnAppQuit`). También se puede
  forzar desde **Configuración → Actualizaciones → Buscar**, e **Instalar y
  reiniciar** cuando ya está descargada.
- El feed se define en `package.json` → `build.publish`:
  ```json
  "publish": { "provider": "github", "owner": "multiplika", "repo": "multiplika-station", "releaseType": "release" }
  ```
  electron-builder lo hornea en `app-update.yml` dentro del instalador, y
  electron-updater consulta las releases de ese repo para saber si hay versión nueva.

## Publicar una versión nueva

```bash
npm run version:set -- 1.0.4     # sube version.json y package.json (semver)
npm install                      # la primera vez, para instalar electron-updater
set GH_TOKEN=<token>             # token con permiso 'repo' sobre multiplika/multiplika-station
npm run publish:win              # electron-builder --win --publish always
```

`--publish always` compila el instalador NSIS y **sube automáticamente** a una
GitHub Release del repo el `.exe` + su `.blockmap` + `latest.yml`. Los equipos con
Station la detectan al comprobar actualización (botón «Buscar»), cada 6 h o al
reabrir la app, y la instalan al cerrar.

## PENDIENTE antes del primer uso real

1. **`npm install`** en el proyecto para traer `electron-updater` (aún no instalado).
2. Tener un **`GH_TOKEN`** con permiso `repo` sobre `multiplika/multiplika-station`
   a la hora de publicar (en CI o en la máquina que compile).
3. Verificación: la autoactualización **solo funciona en la app instalada**, no en
   `npm start`. Hay que instalar una versión, publicar otra mayor y comprobar que
   el equipo la detecta e instala.

> Nota: el aviso de SmartScreen (Windows) / Gatekeeper (Mac) al instalar no lo quita
> la autoactualización (sigue OPS-02); electron-updater valida la descarga por el
> `sha512` del `latest.yml`, así que la actualización es íntegra aun sin firma
> comercial.
