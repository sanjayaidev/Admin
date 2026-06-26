/**
 * Settings Page JavaScript
 * Handles Google integrations, notification preferences, and system settings
 */

// State management
let currentUser = null;
let integrations = {};

// Initialize page
document.addEventListener('DOMContentLoaded', async () => {
  console.log('[Settings] Page loaded');
  
  // Check authentication
  const authResult = await checkAuth();
  if (!authResult.authenticated) {
    showAuthModal();
    return;
  }
  
  currentUser = authResult.user;
  document.getElementById('mainContent').style.display = 'block';
  
  // Load user settings
  await loadUserSettings();
  await loadIntegrations();
  
  // Setup event listeners
  setupEventListeners();
});

// Show auth modal
function showAuthModal() {
  document.getElementById('authModal').style.display = 'flex';
}

// Setup event listeners
function setupEventListeners() {
  // Logout button
  document.getElementById('logoutBtn').addEventListener('click', handleLogout);
  
  // Auth form switching
  document.getElementById('showSignup').addEventListener('click', (e) => {
    e.preventDefault();
    document.getElementById('loginForm').style.display = 'none';
    document.getElementById('signupForm').style.display = 'block';
  });
  
  document.getElementById('showLogin').addEventListener('click', (e) => {
    e.preventDefault();
    document.getElementById('signupForm').style.display = 'none';
    document.getElementById('loginForm').style.display = 'block';
  });
  
  // Login form
  document.getElementById('loginForm').addEventListener('submit', handleLogin);
  
  // Signup form
  document.getElementById('signupForm').addEventListener('submit', handleSignup);
  
  // Integration buttons
  document.querySelectorAll('.btn-connect').forEach(btn => {
    btn.addEventListener('click', handleConnectIntegration);
  });
  
  document.querySelectorAll('.btn-disconnect').forEach(btn => {
    btn.addEventListener('click', handleDisconnectIntegration);
  });
  
  // Forms
  document.getElementById('gowaForm').addEventListener('submit', saveGowaSettings);
  document.getElementById('notificationForm').addEventListener('submit', saveNotificationPreferences);
  document.getElementById('invoiceForm').addEventListener('submit', saveInvoiceSettings);
  document.getElementById('systemForm').addEventListener('submit', saveSystemSettings);
  
  // Test WhatsApp button
  document.getElementById('testWhatsappBtn').addEventListener('click', testWhatsAppConnection);
}

// Handle login
async function handleLogin(e) {
  e.preventDefault();
  console.log('[Settings] Login attempt');
  
  const email = document.getElementById('loginEmail').value;
  const password = document.getElementById('loginPassword').value;
  
  try {
    const response = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ email, password })
    });
    
    const data = await response.json();
    
    if (response.ok) {
      console.log('[Settings] Login successful');
      currentUser = data.user;
      document.getElementById('authModal').style.display = 'none';
      document.getElementById('mainContent').style.display = 'block';
      await loadUserSettings();
      await loadIntegrations();
    } else {
      alert(data.error || 'Login failed');
      console.error('[Settings] Login error:', data);
    }
  } catch (error) {
    console.error('[Settings] Login error:', error);
    alert('Network error. Please try again.');
  }
}

// Handle signup
async function handleSignup(e) {
  e.preventDefault();
  console.log('[Settings] Signup attempt');
  
  const full_name = document.getElementById('signupName').value;
  const email = document.getElementById('signupEmail').value;
  const password = document.getElementById('signupPassword').value;
  
  try {
    const response = await fetch('/api/auth/signup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ full_name, email, password })
    });
    
    const data = await response.json();
    
    if (response.ok) {
      console.log('[Settings] Signup successful');
      currentUser = data.user;
      document.getElementById('authModal').style.display = 'none';
      document.getElementById('mainContent').style.display = 'block';
      await loadUserSettings();
      await loadIntegrations();
    } else {
      alert(data.error || 'Signup failed');
      console.error('[Settings] Signup error:', data);
    }
  } catch (error) {
    console.error('[Settings] Signup error:', error);
    alert('Network error. Please try again.');
  }
}

// Handle logout
async function handleLogout() {
  console.log('[Settings] Logout attempt');
  
  try {
    await fetch('/api/auth/logout', {
      method: 'POST',
      credentials: 'include'
    });
    
    window.location.href = '/';
  } catch (error) {
    console.error('[Settings] Logout error:', error);
    window.location.href = '/';
  }
}

// Load user settings from API
async function loadUserSettings() {
  console.log('[Settings] Loading user settings');
  
  try {
    const response = await fetch('/api/settings', {
      credentials: 'include'
    });
    
    if (response.ok) {
      const data = await response.json();
      console.log('[Settings] User settings loaded:', data);
      
      // Populate notification preferences
      if (data.notification_preferences) {
        const prefs = data.notification_preferences;
        document.getElementById('emailNotifications').checked = prefs.email_notifications !== false;
        document.getElementById('whatsappNotifications').checked = prefs.whatsapp_notifications === true;
        document.getElementById('overdueReminders').checked = prefs.overdue_reminders !== false;
        document.getElementById('upcomingReminders').checked = prefs.upcoming_reminders !== false;
        document.getElementById('invoiceReminders').checked = prefs.invoice_reminders !== false;
        document.getElementById('weeklyDigest').checked = prefs.weekly_digest !== false;
      }
      
      // Populate invoice settings
      if (data.invoice_settings) {
        const inv = data.invoice_settings;
        document.getElementById('invoicePrefix').value = inv.prefix || 'INV';
        document.getElementById('taxRate').value = inv.tax_rate || 18;
        document.getElementById('currency').value = inv.currency || 'USD';
        document.getElementById('paymentTerms').value = inv.payment_terms || 30;
      }
      
      // Populate system settings
      if (data.system_settings) {
        const sys = data.system_settings;
        document.getElementById('appName').value = sys.app_name || 'ClientPM';
        document.getElementById('timezone').value = sys.timezone || 'UTC';
      }
      
      // Populate GOWA settings
      if (data.gowa_settings) {
        document.getElementById('gowaApiUrl').value = data.gowaSettings.api_url || '';
        document.getElementById('gowaApiKey').value = data.gowaSettings.api_key || '';
      }
    }
  } catch (error) {
    console.error('[Settings] Error loading settings:', error);
  }
}

// Load integrations status
async function loadIntegrations() {
  console.log('[Settings] Loading integrations');
  
  try {
    const response = await fetch('/api/integrations', {
      credentials: 'include'
    });
    
    if (response.ok) {
      const data = await response.json();
      console.log('[Settings] Integrations loaded:', data);
      
      integrations = {};
      data.forEach(integration => {
        integrations[integration.provider] = integration;
      });
      
      // Update UI for each integration
      updateIntegrationUI();
    }
  } catch (error) {
    console.error('[Settings] Error loading integrations:', error);
  }
}

// Update integration UI based on status
function updateIntegrationUI() {
  const services = ['google_calendar', 'google_drive', 'google_sheets', 'gmail', 'google_meet'];
  
  services.forEach(service => {
    const card = document.querySelector(`[data-service="${service}"]`);
    if (!card) return;
    
    const integration = integrations[service];
    const isConnected = integration && integration.is_active;
    
    const statusBadge = card.querySelector('.status-badge');
    const connectBtn = card.querySelector('.btn-connect');
    const disconnectBtn = card.querySelector('.btn-disconnect');
    
    if (isConnected) {
      statusBadge.textContent = 'Connected';
      statusBadge.className = 'status-badge connected';
      connectBtn.style.display = 'none';
      disconnectBtn.style.display = 'inline-block';
    } else {
      statusBadge.textContent = 'Disconnected';
      statusBadge.className = 'status-badge disconnected';
      connectBtn.style.display = 'inline-block';
      disconnectBtn.style.display = 'none';
    }
  });
}

// Handle connect integration
async function handleConnectIntegration(e) {
  const card = e.target.closest('.integration-card');
  const service = card.dataset.service;
  
  console.log(`[Settings] Connecting to ${service}`);
  
  try {
    const response = await fetch(`/api/integrations/google/auth?service=${service}`, {
      credentials: 'include'
    });
    
    if (response.ok) {
      const data = await response.json();
      console.log('[Settings] Redirecting to Google OAuth');
      
      // Redirect to Google OAuth
      if (data.auth_url) {
        window.location.href = data.auth_url;
      }
    } else {
      const error = await response.json();
      alert(error.error || 'Failed to initiate OAuth');
      console.error('[Settings] OAuth init error:', error);
    }
  } catch (error) {
    console.error('[Settings] OAuth init error:', error);
    alert('Network error. Please try again.');
  }
}

// Handle disconnect integration
async function handleDisconnectIntegration(e) {
  const card = e.target.closest('.integration-card');
  const service = card.dataset.service;
  
  console.log(`[Settings] Disconnecting ${service}`);
  
  if (!confirm(`Are you sure you want to disconnect ${service}?`)) {
    return;
  }
  
  try {
    const response = await fetch(`/api/integrations/${service}`, {
      method: 'DELETE',
      credentials: 'include'
    });
    
    if (response.ok) {
      console.log(`[Settings] ${service} disconnected`);
      delete integrations[service];
      updateIntegrationUI();
      alert(`${service} disconnected successfully`);
    } else {
      const error = await response.json();
      alert(error.error || 'Failed to disconnect');
      console.error('[Settings] Disconnect error:', error);
    }
  } catch (error) {
    console.error('[Settings] Disconnect error:', error);
    alert('Network error. Please try again.');
  }
}

// Save GOWA settings
async function saveGowaSettings(e) {
  e.preventDefault();
  console.log('[Settings] Saving GOWA settings');
  
  const api_url = document.getElementById('gowaApiUrl').value;
  const api_key = document.getElementById('gowaApiKey').value;
  
  try {
    const response = await fetch('/api/settings/gowa-configure', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ api_url, api_key })
    });
    
    if (response.ok) {
      console.log('[Settings] GOWA settings saved');
      alert('WhatsApp settings saved successfully');
    } else {
      const error = await response.json();
      alert(error.error || 'Failed to save settings');
      console.error('[Settings] Save GOWA error:', error);
    }
  } catch (error) {
    console.error('[Settings] Save GOWA error:', error);
    alert('Network error. Please try again.');
  }
}

// Save notification preferences
async function saveNotificationPreferences(e) {
  e.preventDefault();
  console.log('[Settings] Saving notification preferences');
  
  const preferences = {
    email_notifications: document.getElementById('emailNotifications').checked,
    whatsapp_notifications: document.getElementById('whatsappNotifications').checked,
    overdue_reminders: document.getElementById('overdueReminders').checked,
    upcoming_reminders: document.getElementById('upcomingReminders').checked,
    invoice_reminders: document.getElementById('invoiceReminders').checked,
    weekly_digest: document.getElementById('weeklyDigest').checked
  };
  
  try {
    const response = await fetch('/api/settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ notification_preferences: preferences })
    });
    
    if (response.ok) {
      console.log('[Settings] Notification preferences saved');
      alert('Notification preferences saved successfully');
    } else {
      const error = await response.json();
      alert(error.error || 'Failed to save preferences');
      console.error('[Settings] Save notifications error:', error);
    }
  } catch (error) {
    console.error('[Settings] Save notifications error:', error);
    alert('Network error. Please try again.');
  }
}

// Save invoice settings
async function saveInvoiceSettings(e) {
  e.preventDefault();
  console.log('[Settings] Saving invoice settings');
  
  const settings = {
    prefix: document.getElementById('invoicePrefix').value.trim(),
    tax_rate: parseFloat(document.getElementById('taxRate').value),
    currency: document.getElementById('currency').value,
    payment_terms: parseInt(document.getElementById('paymentTerms').value)
  };
  
  try {
    const response = await fetch('/api/settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ invoice_settings: settings })
    });
    
    if (response.ok) {
      console.log('[Settings] Invoice settings saved');
      alert('Invoice settings saved successfully');
    } else {
      const error = await response.json();
      alert(error.error || 'Failed to save settings');
      console.error('[Settings] Save invoice error:', error);
    }
  } catch (error) {
    console.error('[Settings] Save invoice error:', error);
    alert('Network error. Please try again.');
  }
}

// Save system settings
async function saveSystemSettings(e) {
  e.preventDefault();
  console.log('[Settings] Saving system settings');
  
  const settings = {
    app_name: document.getElementById('appName').value.trim(),
    timezone: document.getElementById('timezone').value
  };
  
  try {
    const response = await fetch('/api/settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ system_settings: settings })
    });
    
    if (response.ok) {
      console.log('[Settings] System settings saved');
      alert('System settings saved successfully');
    } else {
      const error = await response.json();
      alert(error.error || 'Failed to save settings');
      console.error('[Settings] Save system error:', error);
    }
  } catch (error) {
    console.error('[Settings] Save system error:', error);
    alert('Network error. Please try again.');
  }
}

// Test WhatsApp connection
async function testWhatsAppConnection() {
  console.log('[Settings] Testing WhatsApp connection');
  
  try {
    const response = await fetch('/api/notifications/test-whatsapp', {
      method: 'POST',
      credentials: 'include'
    });
    
    if (response.ok) {
      console.log('[Settings] WhatsApp test successful');
      alert('WhatsApp connection test successful! Check your phone.');
    } else {
      const error = await response.json();
      alert(error.error || 'WhatsApp test failed');
      console.error('[Settings] WhatsApp test error:', error);
    }
  } catch (error) {
    console.error('[Settings] WhatsApp test error:', error);
    alert('Network error. Please try again.');
  }
}

// Handle OAuth callback (if redirected back)
async function handleOAuthCallback() {
  const urlParams = new URLSearchParams(window.location.search);
  const code = urlParams.get('code');
  const service = urlParams.get('service');
  
  if (code && service) {
    console.log(`[Settings] OAuth callback for ${service}`);
    
    try {
      const response = await fetch('/api/integrations/google/callback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ code, service })
      });
      
      if (response.ok) {
        console.log('[Settings] OAuth successful');
        // Remove query params
        window.history.replaceState({}, document.title, '/settings.html');
        // Reload integrations
        await loadIntegrations();
        alert(`${service} connected successfully!`);
      } else {
        const error = await response.json();
        alert(error.error || 'OAuth failed');
        console.error('[Settings] OAuth callback error:', error);
      }
    } catch (error) {
      console.error('[Settings] OAuth callback error:', error);
      alert('Network error during OAuth');
    }
  }
}

// Check for OAuth callback on page load
if (window.location.search.includes('code=')) {
  handleOAuthCallback();
}
