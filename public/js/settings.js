/**
 * Settings Page JavaScript
 * Handles Google integrations, notification preferences, and system settings
 */

// State management
let currentUser = null;
let integrations = {};

// Initialize page - now handled by auth.js
async function initSettingsPage() {
  console.log('[Settings] Page loaded');

  // Check authentication using the global checkAuth from auth.js
  const authResult = await window.checkAuth();

  if (!authResult.authenticated) {
    // User is not authenticated, show the auth modal from auth.js
    window.showAuthModal();
    return;
  }

  currentUser = authResult.user;

  // Update navbar with user info (using auth.js function)
  window.updateNavbar(currentUser);

  // Load user settings
  await loadUserSettings();
  await loadIntegrations();

  // Setup event listeners
  setupEventListeners();
}

// Only run init if not called from auth.js
if (typeof window.loadUserSettings === 'undefined') {
  document.addEventListener('DOMContentLoaded', initSettingsPage);
}

// Setup event listeners
function setupEventListeners() {
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

// Load user settings from API
async function loadUserSettings() {
  console.log('[Settings] Loading user settings');

  try {
    const response = await fetch('/api/settings', {
      credentials: 'include'
    });

    if (response.ok) {
      const settings = await response.json();
      console.log('[Settings] Settings loaded:', settings);

      // Populate forms
      if (settings.gowa) {
        document.getElementById('gowaApiUrl').value = settings.gowa.api_url || '';
        document.getElementById('gowaApiKey').value = settings.gowa.api_key || '';
      }

      if (settings.notifications) {
        document.getElementById('emailNotifications').checked = settings.notifications.email || false;
        document.getElementById('whatsappNotifications').checked = settings.notifications.whatsapp || false;
        document.getElementById('overdueReminders').checked = settings.notifications.overdue_reminders || false;
        document.getElementById('upcomingReminders').checked = settings.notifications.upcoming_reminders || false;
        document.getElementById('invoiceReminders').checked = settings.notifications.invoice_reminders || false;
        document.getElementById('weeklyDigest').checked = settings.notifications.weekly_digest || false;
      }

      if (settings.invoice) {
        document.getElementById('invoicePrefix').value = settings.invoice.prefix || 'INV';
        document.getElementById('taxRate').value = settings.invoice.tax_rate || 18;
        document.getElementById('currency').value = settings.invoice.currency || 'USD';
        document.getElementById('paymentTerms').value = settings.invoice.payment_terms || 30;
      }

      if (settings.system) {
        document.getElementById('appName').value = settings.system.app_name || 'ClientPM';
        document.getElementById('timezone').value = settings.system.timezone || 'UTC';
      }
    }
  } catch (error) {
    console.error('[Settings] Error loading settings:', error);
  }
}

// Load integrations
async function loadIntegrations() {
  console.log('[Settings] Loading integrations');

  try {
    const response = await fetch('/api/integrations', {
      credentials: 'include'
    });

    if (response.ok) {
      integrations = await response.json();
      console.log('[Settings] Integrations loaded:', integrations);
      renderIntegrations();
    }
  } catch (error) {
    console.error('[Settings] Error loading integrations:', error);
  }
}

// Render integration cards
function renderIntegrations() {
  const services = ['google_calendar', 'google_drive', 'google_sheets', 'gmail', 'google_meet'];

  services.forEach(service => {
    const card = document.querySelector(`.integration-card[data-service="${service}"]`);
    if (!card) return;

    const isConnected = integrations[service]?.connected || false;
    const statusBadge = card.querySelector('.status-badge');
    const connectBtn = card.querySelector('.btn-connect');
    const disconnectBtn = card.querySelector('.btn-disconnect');

    if (isConnected) {
      statusBadge.textContent = 'Connected';
      statusBadge.classList.remove('disconnected');
      statusBadge.classList.add('connected');
      connectBtn.style.display = 'none';
      disconnectBtn.style.display = 'inline-block';
    } else {
      statusBadge.textContent = 'Disconnected';
      statusBadge.classList.remove('connected');
      statusBadge.classList.add('disconnected');
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
    const response = await fetch(`/api/integrations/${service}/connect`, {
      method: 'POST',
      credentials: 'include'
    });

    if (response.ok) {
      const data = await response.json();
      if (data.auth_url) {
        window.open(data.auth_url, '_blank');
        // Poll for completion
        pollIntegrationStatus(service);
      } else {
        await loadIntegrations();
        alert(`${service} connected successfully`);
      }
    } else {
      const error = await response.json();
      alert(error.error || 'Failed to connect');
    }
  } catch (error) {
    console.error('[Settings] Connect error:', error);
    alert('Network error. Please try again.');
  }
}

// Handle disconnect integration
async function handleDisconnectIntegration(e) {
  const card = e.target.closest('.integration-card');
  const service = card.dataset.service;

  if (!confirm(`Disconnect ${service}?`)) return;

  console.log(`[Settings] Disconnecting ${service}`);

  try {
    const response = await fetch(`/api/integrations/${service}/disconnect`, {
      method: 'POST',
      credentials: 'include'
    });

    if (response.ok) {
      await loadIntegrations();
      alert(`${service} disconnected`);
    } else {
      const error = await response.json();
      alert(error.error || 'Failed to disconnect');
    }
  } catch (error) {
    console.error('[Settings] Disconnect error:', error);
    alert('Network error. Please try again.');
  }
}

// Poll integration status
async function pollIntegrationStatus(service, maxAttempts = 10) {
  let attempts = 0;
  const interval = setInterval(async () => {
    attempts++;
    try {
      const response = await fetch('/api/integrations', {
        credentials: 'include'
      });

      if (response.ok) {
        integrations = await response.json();
        if (integrations[service]?.connected) {
          clearInterval(interval);
          await loadIntegrations();
          alert(`${service} connected successfully`);
        }
      }
    } catch (error) {
      console.error('[Settings] Poll error:', error);
    }

    if (attempts >= maxAttempts) {
      clearInterval(interval);
      await loadIntegrations();
    }
  }, 2000);
}

// Save GOWA settings
async function saveGowaSettings(e) {
  e.preventDefault();

  const api_url = document.getElementById('gowaApiUrl').value.trim();
  const api_key = document.getElementById('gowaApiKey').value.trim();

  try {
    const response = await fetch('/api/settings/gowa', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ api_url, api_key })
    });

    if (response.ok) {
      alert('WhatsApp settings saved');
    } else {
      const error = await response.json();
      alert(error.error || 'Failed to save settings');
    }
  } catch (error) {
    console.error('[Settings] Save GOWA error:', error);
    alert('Network error. Please try again.');
  }
}

// Save notification preferences
async function saveNotificationPreferences(e) {
  e.preventDefault();

  const preferences = {
    email: document.getElementById('emailNotifications').checked,
    whatsapp: document.getElementById('whatsappNotifications').checked,
    overdue_reminders: document.getElementById('overdueReminders').checked,
    upcoming_reminders: document.getElementById('upcomingReminders').checked,
    invoice_reminders: document.getElementById('invoiceReminders').checked,
    weekly_digest: document.getElementById('weeklyDigest').checked
  };

  try {
    const response = await fetch('/api/settings/notifications', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify(preferences)
    });

    if (response.ok) {
      alert('Notification preferences saved');
    } else {
      const error = await response.json();
      alert(error.error || 'Failed to save preferences');
    }
  } catch (error) {
    console.error('[Settings] Save notifications error:', error);
    alert('Network error. Please try again.');
  }
}

// Save invoice settings
async function saveInvoiceSettings(e) {
  e.preventDefault();

  const settings = {
    prefix: document.getElementById('invoicePrefix').value.trim(),
    tax_rate: parseFloat(document.getElementById('taxRate').value),
    currency: document.getElementById('currency').value,
    payment_terms: parseInt(document.getElementById('paymentTerms').value)
  };

  try {
    const response = await fetch('/api/settings/invoice', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify(settings)
    });

    if (response.ok) {
      alert('Invoice settings saved');
    } else {
      const error = await response.json();
      alert(error.error || 'Failed to save settings');
    }
  } catch (error) {
    console.error('[Settings] Save invoice error:', error);
    alert('Network error. Please try again.');
  }
}

// Save system settings
async function saveSystemSettings(e) {
  e.preventDefault();

  const settings = {
    app_name: document.getElementById('appName').value.trim(),
    timezone: document.getElementById('timezone').value
  };

  try {
    const response = await fetch('/api/settings/system', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify(settings)
    });

    if (response.ok) {
      alert('System settings saved');
    } else {
      const error = await response.json();
      alert(error.error || 'Failed to save settings');
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
    const response = await fetch('/api/settings/gowa/test', {
      method: 'POST',
      credentials: 'include'
    });

    if (response.ok) {
      alert('WhatsApp connection successful!');
    } else {
      const error = await response.json();
      alert(error.error || 'WhatsApp connection failed');
    }
  } catch (error) {
    console.error('[Settings] Test WhatsApp error:', error);
    alert('Network error. Please try again.');
  }
}
