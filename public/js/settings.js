/**
 * Settings Page JavaScript
 * Handles notification preferences and organization settings
 * Google integrations moved to Flow Builder
 */

// State management - currentUser is defined globally in auth.js
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

  window.currentUser = authResult.user;

  // Update navbar with user info (using auth.js function)
  window.updateNavbar(window.currentUser);

  // Show organization settings for admins only
  if (window.currentUser && window.currentUser.role === 'admin') {
    document.getElementById('orgSettingsSection').style.display = 'block';
    await loadOrganizationDetails();
  }

  // Load user settings
  await loadUserSettings();

  // Setup event listeners
  setupEventListeners();
}

// Only run init if not called from auth.js
if (typeof window.loadUserSettings === 'undefined') {
  document.addEventListener('DOMContentLoaded', initSettingsPage);
}

// Setup event listeners
function setupEventListeners() {
  // Forms
  document.getElementById('gowaForm').addEventListener('submit', saveGowaSettings);
  document.getElementById('notificationForm').addEventListener('submit', saveNotificationPreferences);
  document.getElementById('orgForm').addEventListener('submit', saveOrganizationSettings);

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
    }
  } catch (error) {
    console.error('[Settings] Error loading settings:', error);
  }
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

// Load organization details (admin only)
async function loadOrganizationDetails() {
  console.log('[Settings] Loading organization details');

  try {
    const response = await fetch('/api/organization', {
      credentials: 'include'
    });

    if (response.ok) {
      const org = await response.json();
      document.getElementById('orgName').value = org.name || '';
      document.getElementById('orgSlug').value = org.slug || '';
      document.getElementById('orgCreatedAt').value = org.created_at ? new Date(org.created_at).toLocaleDateString() : '';
    }
  } catch (error) {
    console.error('[Settings] Error loading organization details:', error);
  }
}

// Save organization settings (admin only)
async function saveOrganizationSettings(e) {
  e.preventDefault();

  const name = document.getElementById('orgName').value.trim();

  try {
    const response = await fetch('/api/organization', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ name })
    });

    if (response.ok) {
      alert('Organization updated successfully');
      // Update navbar with new org name
      if (window.currentUser) {
        window.currentUser.orgName = name;
        window.updateNavbar(window.currentUser);
      }
    } else {
      const error = await response.json();
      alert(error.error || 'Failed to update organization');
    }
  } catch (error) {
    console.error('[Settings] Save organization error:', error);
    alert('Network error. Please try again.');
  }
}
