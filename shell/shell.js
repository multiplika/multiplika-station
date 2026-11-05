// Interfaz de la barra superior. Se comunica con el proceso principal
// a través de window.tabsApi (definido en preload-shell.js).

const tabbar = document.getElementById('tabbar');
const dashBtn = document.getElementById('dashBtn');
const settingsBtn = document.getElementById('settingsBtn');

// Botones fijos de los extremos (no se recrean en cada actualización).
dashBtn.addEventListener('click', () => window.tabsApi.openDashboard());
settingsBtn.addEventListener('click', () => window.tabsApi.openSettings());

const closeIcon = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="5" y1="5" x2="19" y2="19"/><line x1="19" y1="5" x2="5" y2="19"/></svg>';

// `state` = { tabs: [...], overlay: 'dashboard'|'settings'|null } (ver preload-shell.js)
function render(state) {
  const tabs = (state && state.tabs) || [];
  const overlay = state && state.overlay;

  // Resaltar el botón fijo correspondiente a la superposición visible.
  dashBtn.classList.toggle('active', overlay === 'dashboard');
  settingsBtn.classList.toggle('active', overlay === 'settings');

  tabbar.innerHTML = '';

  tabs.forEach((tab) => {
    const el = document.createElement('div');
    el.className = 'tab' + (tab.active ? ' active' : '');
    el.title = tab.title;

    // Favicon de la web; si no hay (o falla su carga), el punto indicador.
    const makeDot = () => {
      const dot = document.createElement('span');
      dot.className = 'dot';
      return dot;
    };
    if (tab.favicon) {
      const ico = document.createElement('img');
      ico.className = 'favicon';
      ico.src = tab.favicon;
      ico.alt = '';
      ico.addEventListener('error', () => { ico.replaceWith(makeDot()); });
      el.appendChild(ico);
    } else {
      el.appendChild(makeDot());
    }

    const title = document.createElement('span');
    title.className = 'title';
    title.textContent = tab.title;
    el.appendChild(title);

    const close = document.createElement('span');
    close.className = 'close';
    close.innerHTML = closeIcon;
    close.addEventListener('click', (e) => {
      e.stopPropagation();
      window.tabsApi.closeTab(tab.id);
    });
    el.appendChild(close);

    el.addEventListener('click', () => {
      if (!tab.active) window.tabsApi.activateTab(tab.id);
    });

    tabbar.appendChild(el);
  });
}

window.tabsApi.onTabsUpdate(render);
