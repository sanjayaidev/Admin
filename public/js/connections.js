// Connections page - manage Google OAuth connections for all modules
const API = '';
let apiKey = localStorage.getItem('sm_api_key') || null;
let modulesCache = [];
let connectionsCache = [];

function headers() {
  return { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + apiKey };
}

function showMsg(container, msg, type) {
  if (!container) return;
  container.innerHTML = msg ? `<div class="msg ${type || ''}">${msg}</div>` : '';
}

async function init() {
  const keyPill = document.getElementById('keyPill');
  if (!apiKey) {
    keyPill.textContent = 'no API key — log in on the classic dashboard';
    showMsg(document.getElementById('banner'), 'No API key found. Log in or paste a key on the classic dashboard first.', 'error');
    return;
  }
  keyPill.textContent = apiKey.slice(0, 14) + '...';
  
  await loadModules();
  await loadConnections();
  renderModuleList();
}

async function loadModules() {
  try {
    const res = await fetch(API + '/api', { headers: headers() });
    const data = await res.json();
    modulesCache = res.ok ? (data.modules || []) : [];
    if (!res.ok) showMsg(document.getElementById('banner'), 'Could not load modules (' + (data.error || res.status) + ')', 'error');
  } catch (e) { showMsg(document.getElementById('banner'), 'Network error loading modules: ' + e.message, 'error'); }
}

async function loadConnections() {
  try {
    const res = await fetch(API + '/connections', { headers: headers() });
    const data = await res.json();
    connectionsCache = res.ok ? (data.connections || []) : [];
    if (!res.ok) showMsg(document.getElementById('banner'), 'Could not load connections (' + (data.error || res.status) + ')', 'error');
  } catch (e) { showMsg(document.getElementById('banner'), 'Network error loading connections: ' + e.message, 'error'); }
}

function providerFor(moduleName) {
  const mod = modulesCache.find(m => m.name === moduleName);
  return mod ? mod.provider : 'google';
}

function connectionsForModule(moduleObjOrName) {
  const name = typeof moduleObjOrName === 'string' ? moduleObjOrName : moduleObjOrName.name;
  const provider = providerFor(name);
  return connectionsCache.filter(c =>
    c.status === 'active' &&
    c.provider === provider &&
    (c.module ? c.module === name : true)
  );
}

function renderModuleList() {
  const el = document.getElementById('moduleList');
  el.innerHTML = modulesCache.map(m => {
    const conns = connectionsForModule(m);
    const connected = conns.length > 0;
    return `
      <div class="module-row">
        <div class="module-name">
          <span class="socket ${connected ? 'on' : ''}"></span>
          <div>
            <div>${m.name}</div>
            <div class="conn-label">
              ${connected ? conns.map(c => `
                <span class="conn-chip">${c.account_label}
                  <button type="button" class="conn-chip-x" data-disconnect="${c.id}" title="Disconnect this account">×</button>
                </span>`).join(' ') : 'not connected'}
            </div>
          </div>
        </div>
        <button class="btn small ${connected ? 'ghost' : ''}" data-connect-module="${m.name}">${connected ? '+ add another' : 'connect'}</button>
      </div>`;
  }).join('') || '<div class="empty">No modules registered on the server.</div>';
}

async function disconnectConnection(id) {
  if (!confirm('Disconnect this account? Any flow steps using it will stop working until you pick another account.')) return;
  try {
    const res = await fetch(`${API}/connections/${id}`, { method: 'DELETE', headers: headers() });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      showMsg(document.getElementById('banner'), data.message || 'Could not disconnect', 'error');
      return;
    }
    await loadConnections();
    renderModuleList();
    showMsg(document.getElementById('banner'), 'Account disconnected.', 'success');
  } catch (e) { showMsg(document.getElementById('banner'), 'Network error: ' + e.message, 'error'); }
}

async function connectModule(moduleName) {
  try {
    const res = await fetch(`${API}/oauth/google/start?module=${moduleName}&returnTo=connections`, { headers: headers() });
    const data = await res.json();
    if (data.authUrl) location.href = data.authUrl;
    else showMsg(document.getElementById('banner'), data.message || 'Could not start connection', 'error');
  } catch (e) { showMsg(document.getElementById('banner'), 'Network error: ' + e.message, 'error'); }
}

// Event delegation for module list
document.addEventListener('click', (e) => {
  const connectBtn = e.target.closest('[data-connect-module]');
  if (connectBtn) {
    e.preventDefault();
    connectModule(connectBtn.dataset.connectModule);
    return;
  }
  const disconnectBtn = e.target.closest('[data-disconnect]');
  if (disconnectBtn) {
    e.preventDefault();
    disconnectConnection(disconnectBtn.dataset.disconnect);
  }
});

// Initialize on DOM ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
