// Lógica del Panel de control: abrir cada aplicación en una pestaña nueva.
// Si una app no tiene URL configurada, se pide con un modal y se guarda.
// Habla con el proceso principal a través de window.dashboardApi.

const cards = Array.from(document.querySelectorAll('.app-card'));
const urlById = {}; // id -> url configurada (cacheada)

// ---- Modal ----
const modal = document.getElementById('urlModal');
const modalApp = document.getElementById('urlModalApp');
const modalInput = document.getElementById('urlModalInput');
const modalOk = document.getElementById('urlModalOk');
const modalCancel = document.getElementById('urlModalCancel');
let resolveModal = null;

function appLabel(card) {
  const img = card.querySelector('img');
  return (img && img.alt) || card.dataset.app;
}

function normalizeUrl(value) {
  const s = (value || '').trim();
  if (!s) return '';
  return /^https?:\/\//i.test(s) ? s : 'https://' + s;
}

function askUrl(card) {
  return new Promise((resolve) => {
    resolveModal = resolve;
    modalApp.textContent = appLabel(card);
    modalInput.value = urlById[card.dataset.app] || '';
    modal.classList.add('show');
    modalInput.focus();
    modalInput.select();
  });
}

function closeModal(value) {
  modal.classList.remove('show');
  const r = resolveModal;
  resolveModal = null;
  if (r) r(value);
}

function confirmModal() {
  const url = normalizeUrl(modalInput.value);
  if (!url) return; // vacío: no cerrar hasta que haya algo válido
  closeModal(url);
}

modalOk.addEventListener('click', confirmModal);
modalCancel.addEventListener('click', () => closeModal(null));
modalInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') confirmModal();
  else if (e.key === 'Escape') closeModal(null);
});
modal.addEventListener('click', (e) => { if (e.target === modal) closeModal(null); });

// ---- Tarjetas ----
cards.forEach((card) => {
  card.addEventListener('click', async () => {
    const id = card.dataset.app;
    let url = urlById[id];
    if (!url) {
      const entered = await askUrl(card);
      if (!entered) return; // cancelado
      const res = await window.dashboardApi.setAppUrl(id, entered);
      url = (res && res.url) || entered;
      urlById[id] = url;
    }
    window.dashboardApi.openApp(id);
  });
});

// ---- Carga inicial: URLs configuradas ----
// Aplicar la lista de apps: cachear su URL y mostrar/ocultar cada tarjeta según
// el interruptor de Configuración → Aplicaciones (a.show === false -> oculta).
function applyApps(apps) {
  (apps || []).forEach((a) => {
    urlById[a.id] = a.url;
    const card = document.querySelector('.app-card[data-app="' + a.id + '"]');
    if (card) card.style.display = (a.show === false) ? 'none' : '';
  });
}

async function init() {
  try {
    applyApps(await window.dashboardApi.getApps());
  } catch (_) { /* sin datos: se pedirán al pulsar */ }
}
init();

// El proceso principal reenvía la lista al mostrar el panel (refleja los cambios
// de los interruptores sin reiniciar la app).
if (window.dashboardApi.onApps) window.dashboardApi.onApps(applyApps);
