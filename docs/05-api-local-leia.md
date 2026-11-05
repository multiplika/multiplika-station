# Multiplika Station — API local para LEIA

> Implementación del "puente" y del servidor HTTP local que consume el frontend
> LEIA cuando corre **dentro** de la Station. El contrato (rutas, cabeceras,
> formas de JSON) lo define LEIA y aquí solo se implementa. Fecha: 2026-07-31.

## Qué se ha añadido

- **Puente** `window.__MULTIPLIKA_STATION__`: se inyecta en `preload.js`, pero
  **solo en las pestañas de LEIA** y **solo en el frame superior**. Los datos de
  sesión (baseUrl, token, versión, equipo) se pasan al preload por
  `additionalArguments` desde `main.js`; el preload los expone con `contextBridge`
  antes de que corra el JS de la página y dispara el evento `station-ready`. Al
  recargar o navegar, el preload se re-ejecuta y el puente se re-inyecta solo.
- **Servidor HTTPS local** (`station/server.js`): escucha en `127.0.0.1` (loopback)
  en un puerto aleatorio, con certificado autofirmado (`station/tls.js`). Se
  arranca en `app.whenReady()` y se cierra en `will-quit`. El token y el puerto se
  generan una vez por sesión.
- **Handler SFTP** (`station/sftp.js`) con las 6 operaciones que LEIA habilita hoy.

Archivos nuevos: `station/tls.js`, `station/sftp.js`, `station/server.js`.
Modificados: `main.js`, `preload.js`, `package.json` (dependencias + `files`).

## Dependencias nuevas (¡importante!)

Se han añadido a `package.json`. Hay que instalarlas una vez:

```bash
npm install
```

- `selfsigned` — genera el certificado autofirmado del servidor local.
- `ssh2-sftp-client` — cliente SFTP para el handler de conexiones.

## Seguridad (cómo está resuelto)

- **Loopback + token**: el servidor solo escucha en `127.0.0.1`; **todas** las
  rutas exigen la cabecera `X-Station-Token` con el token de sesión (32 bytes
  aleatorios). Sin token o con uno falso → `401 TOKEN_INVALIDO`.
- **HTTPS local**: como la página va por https, el fetch a `http://127.0.0.1` se
  bloquearía por *mixed content*; por eso el servidor es https. El certificado
  autofirmado se acepta **solo para `https://127.0.0.1:<puerto>`** mediante
  `app.on('certificate-error')` en `main.js`; el resto de la verificación TLS
  sigue intacta y **no se toca `webSecurity`**.
- **Puente acotado**: el token/baseUrl solo se exponen en pestañas cuyo origen es
  el de LEIA (`APP_URL` o `URL_LEIA`) y solo en el frame superior, para no
  filtrarlo a iframes de terceros de la página.
- **Path traversal**: `/fs/guardar` (y el andamiaje `/fs/*`) confinan todo a la
  carpeta raíz de trabajo; se rechazan `..` y rutas absolutas con `FS_FUERA_DE_RAIZ`.
- **Credenciales**: llegan en `/v1/conexiones/ejecutar`, se usan para conectar y
  se descartan. No se registran en logs ni se devuelven en la respuesta.

## Carpeta raíz de trabajo

`/fs/guardar` escribe dentro de **`<Documentos>/Multiplika Station`** (se crea
sola). El `res.path` devuelto es la ruta absoluta donde quedó el archivo.

## Endpoints (resumen; el contrato canónico es LEIA)

Base: `https://127.0.0.1:<puerto>/v1`

- `GET  /v1/health` → `{ ok, version, equipo }`
- `POST /v1/fs/guardar` `{ nombre, contenidoBase64, path? }` → `{ path }`
- `POST /v1/web/traer` `{ url }` → `{ texto, url, status, contentType, truncado }`
  (texto acotado a ~60 000 caracteres; páginas grandes se truncan)
- `POST /v1/conexiones/ejecutar` `{ tipo, operacion, parametros, credenciales }`
  → **siempre** `{ ok, resultado, error }`

Andamiaje listo pero que LEIA aún no llama: `GET /v1/fs/listar`, `GET /v1/fs/leer`,
`GET /v1/nube/estado`.

### Contrato de errores

Fallos de la **API local** (no de negocio): HTTP no-2xx con `{ error, codigo }`.
Códigos usados: `TOKEN_INVALIDO`, `CUERPO_INVALIDO`, `TIPO_NO_SOPORTADO`,
`OPERACION_NO_SOPORTADA`, `FS_FUERA_DE_RAIZ`, `WEB_FALLO`, `NO_ENCONTRADO`,
`INTERNO`. Un fallo **al ejecutar una acción** de conexión (no conecta, credencial
incorrecta, la operación falla) se devuelve con **200** y `{ ok:false, error }`,
para respetar el contrato de acción que LEIA reenvía al agente.

## Alta de conexiones SFTP (convención)

El backend guarda `parametros` y `credenciales` como JSON libre, así que la
convención de nombres la fija la Station. **Regla dura**: los secretos van en
`credenciales`, nunca en `parametros`. El handler es tolerante a alias:

```jsonc
// parametros (NO secreto):
{ "host": "sftp.ejemplo.com", "port": 22, "username": "usuario", "path": "/base/opcional" }
//   alias aceptados: host|hostname, port|puerto (def. 22), username|user|usuario

// credenciales (cifrado): una u otra forma
{ "password": "…" }
//   alias: password|clave|contrasena
// ó
{ "privateKey": "-----BEGIN OPENSSH PRIVATE KEY-----\n…", "passphrase": "opcional" }
//   alias: privateKey|private_key|llave_privada, passphrase|frase
```

Operaciones y su `resultado`:

| operacion | parámetros | resultado |
|-----------|------------|-----------|
| `probar`  | (solo conexión) | `{ conectado: true }` |
| `listar`  | `path` | `[{ nombre, tipo:"file\|dir", tamano, modificado }]` |
| `existe`  | `path` | `{ existe: true\|false }` |
| `subir`   | `destino`, `contenidoBase64` | `{ subido: true, ruta }` |
| `bajar`   | `path` | `{ nombre, contenidoBase64, tamano }` |
| `borrar`  | `path` | `{ borrado: true }` |

> Diseño preparado para más tipos (mariadb, http_api, ftp, smtp, imap, s3,
> webhook…) por el despachador `tipo -> handler` en `station/server.js`. Hoy solo
> `sftp` está habilitado (que es lo único que LEIA usa).

## Cómo se ha probado

Batería de 37 pruebas en Node (fuera de Electron, porque el servidor no depende
de Electron): health/token, CORS/preflight, `fs/guardar` + los tres vectores de
path traversal, `web/traer` (troceo de HTML y bloqueo de esquemas), despacho de
tipos/operaciones, y las **6 operaciones SFTP contra un servidor SFTP real
levantado en proceso**, más tolerancia a alias y verificación de que la
credencial no aparece en los mensajes de error. Todas en verde.

## Criterios de aceptación

1. `window.__MULTIPLIKA_STATION__` presente dentro de la Station (con
   `baseUrl`/`token`) y ausente en navegador normal. ✔ (puente acotado a LEIA)
2. `GET /v1/health` 2xx con token y 401 sin él. ✔
3. `guardar_archivo` crea el fichero en la raíz y `..` → `FS_FUERA_DE_RAIZ`. ✔
4. `ejecutar_conexion` SFTP hace las 6 operaciones devolviendo
   `{ ok, resultado, error }`; sin credenciales en logs. ✔
5. `traer_url` descarga y devuelve texto acotado. ✔
6. Al recargar/renavegar, el puente sigue presente (el preload se re-ejecuta). ✔
