// Connections management page - session-based auth (no API key)
const API = '';

let modulesCache = [];
let connectionsCache = [];

function headers() {
  return { 'Content-Type': 'application/json' };
}

async function init() {
  await loadModules();
  await loadConnections();
  renderModuleList();
  
  // Check for OAuth callback params
  const urlParams = new URLSearchParams(window.location.search);
  if (urlParams.get('provider') === 'google') {
    const email = urlParams.get('email');
    showBanner(`Successfully connected ${email}`, 'success');
    // Clean URL
    window.history.replaceState({}, document.title, '/connections.html');
    // Refresh connections
    setTimeout(() => loadConnections().then(renderModuleList), 500);
  }
}

async function loadModules() {
  try {
    const res = await fetch(API + '/api', { headers: headers() });
    const data = await res.json();
    modulesCache = res.ok ? (data.modules || []) : [];
  } catch (e) {
    console.error('Failed to load modules:', e);
  }
}

async function loadConnections() {
  try {
    const res = await fetch(API + '/connections', { headers: headers() });
    const data = await res.json();
    connectionsCache = res.ok ? (data.connections || []) : [];
  } catch (e) {
    console.error('Failed to load connections:', e);
  }
}

function getConnectionsForModule(moduleName) {
  return connectionsCache.filter(c => c.module === moduleName && c.status === 'active');
}

function renderModuleList() {
  const container = document.getElementById('moduleList');
  if (!container) return;
  
  if (modulesCache.length === 0) {
    container.innerHTML = '<div class="empty">Loading modules...</div>';
    return;
  }
  
  const html = modulesCache.map(mod => {
    const connections = getConnectionsForModule(mod.name);
    const isConnected = connections.length > 0;
    
    return `
      <div class="module-row">
        <div class="module-name">
          <span class="socket ${isConnected ? 'on' : ''}"></span>
          <span>${getModuleIcon(mod.name)} ${mod.name}</span>
        </div>
        <div style="flex:1; margin-left:20px;">
          ${isConnected ? `
            <div class="conn-label">
              ${connections.map(c => `
                <span class="conn-chip">
                  ${c.account_label}
                  <button class="conn-chip-x" onclick="disconnect('${c.id}')">×</button>
                </span>
              `).join('')}
            </div>
          ` : '<span style="color:var(--ink-dim);font-size:12px;">No connections</span>'}
        </div>
        <button class="btn ${isConnected ? 'ghost' : ''}" onclick="connect('${mod.name}')">
          ${isConnected ? 'Connect Another' : 'Connect'}
        </button>
      </div>
    `;
  }).join('');
  
  container.innerHTML = html;
}

function getModuleIcon(moduleName) {
  const icons = {
    gmail: '📧',
    calendar: '📅',
    sheets: '📊',
    docs: '📄',
    drive: '📁',
    forms: '📝',
    googleBusinessProfile: '🏢'
  };
  return icons[moduleName] || '🔌';
}

async function connect(moduleName) {
  try {
    const res = await fetch(
      API + `/oauth/google/start?module=${encodeURIComponent(moduleName)}&returnTo=flow-builder`,
      { headers: headers() }
    );
    const data = await res.json();
    
    if (res.ok && data.authUrl) {
      window.location.href = data.authUrl;
    } else {
      showBanner(data.error || 'Failed to start OAuth flow', 'error');
    }
  } catch (e) {
    showBanner('Network error: ' + e.message, 'error');
  }
}

async function disconnect(connectionId) {
  if (!confirm('Remove this connection?')) return;
  
  try {
    const res = await fetch(API + `/connections/${connectionId}`, {
      method: 'DELETE',
      headers: headers()
    });
    
    if (res.ok) {
      showBanner('Connection removed', 'success');
      await loadConnections();
      renderModuleList();
    } else {
      const data = await res.json();
      showBanner(data.error || 'Failed to disconnect', 'error');
    }
  } catch (e) {
    showBanner('Network error: ' + e.message, 'error');
  }
}

function showBanner(msg, type) {
  const banner = document.getElementById('banner');
  if (!banner) return;
  
  banner.innerHTML = `<div class="msg ${type}">${msg}</div>`;
  setTimeout(() => {
    banner.innerHTML = '';
  }, 4000);
}

// Initialize on DOM ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
