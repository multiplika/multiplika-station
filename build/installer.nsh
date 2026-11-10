; Incluido por electron-builder en el instalador NSIS de Station (package.json → nsis.include).
;
; Station lleva dentro el descargador de modelos AEAT (resources\descargador) y lo apaga al
; cerrarse. Por si se quedó encendido (cierre forzado, cuelgue…), el instalador y el
; desinstalador lo cierran antes de copiar o borrar ficheros: si no, Windows no deja
; reemplazar DescargadorModelos.exe y la actualización falla.

!macro customInit
  nsExec::Exec 'taskkill /F /T /IM DescargadorModelos.exe'
!macroend

!macro customUnInit
  nsExec::Exec 'taskkill /F /T /IM DescargadorModelos.exe'
!macroend
