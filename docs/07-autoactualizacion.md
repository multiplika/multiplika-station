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

Las versiones van **por fecha**: `AAAA.MMDD.HHmm` (p. ej. `2026.1105.2015` = 2026-11-05
20:15), así se sabe de un vistazo **cuándo se generó** la actualización. Llevan puntos
porque electron-updater/electron-builder exigen **semver** (tres números) para comparar
versiones; un número plano `AAAAMMDDHHmm` no serviría para decidir si hay que actualizar.
Los componentes son enteros (`mes*100+día` y `hora*100+min`) para que sea semver válido
y crezca en orden cronológico. `version.json.date` guarda además la marca legible
`AAAAMMDD HH:MM`.

Para publicar (no hay que inventar número: se sella la fecha/hora actual):

```bash
npm install                      # solo la 1.ª vez (electron-updater)
set GH_TOKEN=<token>             # token con permiso 'repo' sobre multiplika/multiplika-station
npm run publish:win
```

`publish:win` encadena:
1. `scripts/release.js` → genera la versión por fecha (`bump-version.js auto`),
   commitea y empuja `version.json` + `package.json`, y crea y empuja el tag
   `v<versión>` (aborta si esa versión ya se publicó).
2. `electron-builder --win --publish always` → compila el instalador NSIS y **sube**
   a una GitHub Release el `.exe` + su `.blockmap` + `latest.yml`.

> El tag se empuja antes a propósito: con `releaseType: release`, GitHub devuelve un
> **422 ("Published releases must have a valid tag")** si el tag no existe de antemano,
> y la subida queda a medias. `release.js` lo evita.

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
