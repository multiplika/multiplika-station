// ============================================================
//  Valores POR DEFECTO de la aplicación
//  Son la base de fábrica. En tiempo de ejecución se pueden
//  cambiar desde la pantalla de Configuración (icono de engranaje),
//  y esos ajustes se guardan por equipo en la carpeta de datos de
//  usuario (settings.json) y tienen prioridad sobre estos valores.
//  Edita aquí solo para cambiar los valores por defecto de fábrica.
// ============================================================

module.exports = {
  // URL única que cargará la aplicación.
  APP_URL: 'https://apiadev.multiplika.net',

  // Título de la ventana.
  WINDOW_TITLE: 'Multiplika',

  // Tamaño inicial de la ventana (en píxeles).
  WIDTH: 1280,
  HEIGHT: 800,

  // Tamaño mínimo permitido de la ventana.
  MIN_WIDTH: 400,
  MIN_HEIGHT: 300,

  // Abrir los enlaces a dominios externos en el navegador del sistema
  // en lugar de dentro de la app.
  OPEN_EXTERNAL_LINKS_IN_BROWSER: true,

  // Ocultar la barra de menús (Windows y Linux). En macOS el menú
  // superior del sistema siempre está presente.
  AUTO_HIDE_MENU_BAR: true,

  // Iniciar la aplicación en pantalla completa.
  FULLSCREEN: false,

  // Impresoras seleccionadas (nombre de sistema de la impresora).
  // Cadena vacía = usar la predeterminada del sistema.
  PRINTER_DOCUMENTS: '',
  PRINTER_TICKETS: '',

  // URL de cada enlace del Panel de control (configurable por cliente).
  // Cadena vacía = enlace sin configurar (al pulsarlo, se pide la URL).
  URL_ERP: '',
  URL_PLUS: '',
  URL_LEIA: '',

  // Mostrar cada aplicación en el Panel de control (se elige con un interruptor
  // en Configuración → Aplicaciones). true = visible.
  SHOW_ERP: true,
  SHOW_PLUS: true,
  SHOW_LEIA: true
};
