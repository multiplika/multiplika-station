# Errores conocidos

## MST-ERR-01 · Las contraseñas se guardan bajo la aplicación equivocada

**Reportado por Víctor el 2026-11-04:** «el guardado de contraseñas y url de Multiplika Station
se confunde entre aplicaciones y la guarda donde no es».

Síntoma: una contraseña introducida en una aplicación aparece guardada en otra, o no aparece.

### Dónde mirar

Las credenciales se guardan **por `appId`** (`credentials-store.js`: `data = { appId: [...] }`),
y el `appId` de una pestaña sale de `view.__appId`, que se fija al crearla
(`main.js:146`). La captura de credenciales se descarta si la pestaña no tiene `__appId`
(`main.js:635`). Así que todo depende de que ese valor sea el correcto, y hay al menos tres
caminos por los que no lo es:

1. **La pestaña hija hereda la aplicación de la madre** (`main.js:156` y `:160`): cuando una
   página abre otra, la pestaña nueva se crea con `view.__appId` de la pestaña de origen,
   **sea cual sea el destino**. Si desde la pestaña de LEIA se llega a otra web y ahí se escribe
   un usuario y una contraseña, se guardan como si fueran de LEIA. Es el camino que mejor
   explica lo que se ve.
2. **Las pestañas nuevas no tienen aplicación** (`main.js:475` con Ctrl+T, y `:484`): se crean
   con `createTab(settings.APP_URL)`, sin `appId`, así que `__appId` queda a `null` y lo que se
   escriba ahí **no se guarda en ninguna parte**. Desde fuera se ve como «no me ha guardado la
   contraseña».
3. **Dos aplicaciones apuntando a la misma dirección:** el Panel de control tiene tres entradas
   (`URL_ERP`, `URL_PLUS`, `URL_LEIA`) y en la configuración actual **`URL_ERP` y `URL_PLUS`
   están vacías**. Si al estar vacías se cae en `APP_URL`, dos botones distintos abren la misma
   web, y la misma contraseña acaba bajo un `appId` u otro según qué botón se pulsó.

### Qué comprobar antes de arreglar

- Reproducirlo anotando qué botón se pulsó y en qué pestaña se escribió la contraseña, y mirar
  después `credentials.json` en la carpeta de datos de la aplicación: dice bajo qué `appId`
  quedó cada entrada.
- La parte de **«y url»** del reporte no está localizada: hay que confirmar si lo que se mezcla
  es también la dirección guardada en los ajustes (`settings-store.js`, campos `URL_*`) o solo
  la asociación de la contraseña. Sin reproducirlo no se puede afirmar.

### Arreglo propuesto (a falta de confirmar el punto anterior)

- Decidir la aplicación **por el origen de la página**, no por herencia: comparar el origen de
  la pestaña con `URL_ERP`, `URL_PLUS` y `URL_LEIA`, y usar el `appId` que case. Si no casa
  ninguno, no capturar nada.
- No heredar `__appId` en las pestañas hijas cuando el destino cambia de origen.
- Impedir que dos entradas del Panel de control apunten a la misma dirección, o avisar cuando
  ocurra.

### Estado

Abierto. Station está **aparcada** en el plan de LEIA (decisión del 2026-11-04), así que esto
no bloquea nada; queda anotado para cuando se retome.
