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

## Versionado y publicación

Las versiones son **semver normal** (`1.0.4`, `1.0.5`…). En cada publicación se sella
además la **fecha y hora** (`version.json.date`, formato `AAAAMMDD HH:MM`), y la app la
muestra **junto a la versión** en Configuración → Actualizaciones (p. ej.
`1.0.5 · 20261105 19:20`), para saber cuándo se generó cada actualización.

Para publicar una versión nueva:

```bash
npm run version:set -- 1.0.5     # sube version.json (versión + fecha) y package.json
npm run publish:win              # con `gh` autenticado en la cuenta "multiplika"
```

`publish:win` encadena:
1. `scripts/release.js` → commitea y empuja `version.json` + `package.json` y crea y
   empuja el tag `v<versión>` (aborta si esa versión ya se publicó).
2. `electron-builder --win` → compila el instalador NSIS y genera `latest.yml` + el
   `.blockmap` en `dist/` (sin publicar).
3. `scripts/upload-release.js` → crea la GitHub Release (si no existe) y sube con `gh`
   el `.exe` + `.blockmap` + `latest.yml`, con los nombres que espera electron-updater.

> No usamos el publicador propio de electron-builder: en esta versión crea la release en
> paralelo y colisiona (422 "valid tag" / "already_exists"), subiendo el `.exe` pero
> dejándose `latest.yml`. Subir con `gh` es determinista. `upload-release.js` usa la
> sesión de `gh` (cuenta activa), no necesita `GH_TOKEN`.

Los equipos con Station detectan la versión al comprobar actualización (botón
«Buscar»), cada 6 h o al reabrir la app, y la instalan al cerrar.

## Estado y verificación

- **Primera release publicada**: `v1.0.4` (2026-11-05), con `.exe` + `.blockmap` +
  `latest.yml`, marcada «Latest» en `multiplika/multiplika-station`.
- Este `1.0.4` es el **primero que lleva el actualizador**, así que hay que
  **instalarlo a mano una vez en cada equipo**; a partir de él, las versiones
  siguientes se autoactualizan.
- `electron-updater` ya está instalado (`npm install` hecho).
- Para publicar hace falta un **`GH_TOKEN`** con permiso `repo` sobre el repo.
- La autoactualización **solo funciona en la app instalada**, no en `npm start`.
  Para verificarla de punta a punta: instalar `1.0.4`, publicar `1.0.5` y comprobar
  que el equipo la detecta e instala.

> Nota: el aviso de SmartScreen (Windows) / Gatekeeper (Mac) al instalar no lo quita
> la autoactualización (sigue OPS-02); electron-updater valida la descarga por el
> `sha512` del `latest.yml`, así que la actualización es íntegra aun sin firma
> comercial.
