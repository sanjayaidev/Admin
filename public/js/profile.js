/**
 * Profile Page JavaScript
 * Handles user profile management, avatar upload, password change, and activity history
 */

// State management
let currentUser = null;
let userSettings = {};

// Initialize page
document.addEventListener('DOMContentLoaded', async () => {
  console.log('[Profile] Page loaded');
  
  // Check authentication using the global checkAuth from auth.js
  const authResult = await window.checkAuth();
  
  if (!authResult.authenticated) {
    // User is not authenticated, show the auth modal from auth.js
    window.showAuthModal();
    return;
  }
  
  currentUser = authResult.user;
  
  // Load profile data
  await loadProfileData();
  
  // Setup event listeners
  setupEventListeners();
});

// Setup event listeners
function setupEventListeners() {
  // Profile form
  document.getElementById('profileForm').addEventListener('submit', saveProfile);
  
  // Password form
  document.getElementById('passwordForm').addEventListener('submit', changePassword);
  
  // Notification preferences form
  document.getElementById('notificationPrefsForm').addEventListener('submit', saveNotificationPrefs);
  
  // Avatar upload
  document.getElementById('avatarUpload').addEventListener('change', handleAvatarUpload);
  
  // Remove avatar
  document.getElementById('removeAvatarBtn').addEventListener('click', removeAvatar);
  
  // Danger zone buttons
  document.getElementById('deactivateAccountBtn').addEventListener('click', deactivateAccount);
  document.getElementById('deleteAccountBtn').addEventListener('click', deleteAccount);
}

// Load profile data from API
async function loadProfileData() {
  console.log('[Profile] Loading profile data');
  
  try {
    const response = await fetch('/api/users/me', {
      credentials: 'include'
    });
    
    if (response.ok) {
      const data = await response.json();
      console.log('[Profile] Profile data loaded:', data);
      
      currentUser = data;
      userSettings = data.settings || {};
      
      // Update profile header
      document.getElementById('profileName').textContent = data.full_name || 'Unknown';
      document.getElementById('profileEmail').textContent = data.email;
      document.getElementById('profileRole').textContent = data.role || 'user';
      
      // Update role badge color
      const roleBadge = document.getElementById('profileRole');
      roleBadge.className = `badge badge-${data.role || 'user'}`;
      
      // Populate profile form
      document.getElementById('fullName').value = data.full_name || '';
      document.getElementById('email').value = data.email || '';
      document.getElementById('phone').value = data.phone || '';
      document.getElementById('role').value = data.role || '';
      document.getElementById('bio').value = data.bio || '';
      
      // Load avatar if exists
      if (data.avatar) {
        document.getElementById('avatarPreview').innerHTML = `<img src="${data.avatar}" alt="Avatar">`;
        document.getElementById('removeAvatarBtn').style.display = 'inline-block';
      }
      
      // Populate notification preferences
      const prefs = data.notification_preferences || {};
      document.getElementById('prefEmailNotifications').checked = prefs.email_notifications !== false;
      document.getElementById('prefWhatsappNotifications').checked = prefs.whatsapp_notifications === true;
      document.getElementById('prefTaskAssignments').checked = prefs.task_assignments !== false;
      document.getElementById('prefMentions').checked = prefs.mentions !== false;
      
      // Load Google connections
      await loadGoogleConnections();
      
      // Load activity history
      await loadActivityHistory();
      
      // Update danger zone based on role
      if (data.role === 'admin') {
        document.getElementById('deleteAccountBtn').disabled = false;
        document.getElementById('deleteAccountBtn').title = 'Delete your account permanently';
      }
    } else {
      console.error('[Profile] Failed to load profile:', response.status);
    }
  } catch (error) {
    console.error('[Profile] Error loading profile:', error);
  }
}

// Load Google connections
async function loadGoogleConnections() {
  console.log('[Profile] Loading Google connections');
  
  try {
    const response = await fetch('/api/integrations', {
      credentials: 'include'
    });
    
    if (response.ok) {
      const integrations = await response.json();
      console.log('[Profile] Google connections loaded:', integrations);
      
      const container = document.getElementById('googleConnections');
      
      if (integrations.length === 0) {
        container.innerHTML = '<p class="text-muted">No Google accounts connected yet.</p>';
        return;
      }
      
      container.innerHTML = integrations.map(integration => `
        <div class="integration-item">
          <div class="integration-info">
            <span class="integration-name">${formatServiceName(integration.provider)}</span>
            <span class="integration-email">${integration.account_email || 'Connected'}</span>
          </div>
          <div class="integration-status">
            <span class="status-badge ${integration.is_active ? 'connected' : 'disconnected'}">
              ${integration.is_active ? 'Connected' : 'Disconnected'}
            </span>
          </div>
          <div class="integration-actions">
            ${integration.is_active ? 
              `<button class="btn btn-sm btn-outline" onclick="disconnectService('${integration.provider}')">Disconnect</button>` :
              `<a href="/api/integrations/google/auth?service=${integration.provider}" class="btn btn-sm btn-primary">Connect</a>`
            }
          </div>
        </div>
      `).join('');
    }
  } catch (error) {
    console.error('[Profile] Error loading Google connections:', error);
    document.getElementById('googleConnections').innerHTML = '<p class="text-danger">Failed to load connections</p>';
  }
}

// Format service name for display
function formatServiceName(service) {
  const names = {
    'google_calendar': 'Google Calendar',
    'google_drive': 'Google Drive',
    'google_sheets': 'Google Sheets',
    'gmail': 'Gmail',
    'google_meet': 'Google Meet'
  };
  return names[service] || service;
}

// Disconnect service (global function for onclick handler)
async function disconnectService(service) {
  console.log(`[Profile] Disconnecting ${service}`);
  
  if (!confirm(`Are you sure you want to disconnect ${formatServiceName(service)}?`)) {
    return;
  }
  
  try {
    const response = await fetch(`/api/integrations/${service}`, {
      method: 'DELETE',
      credentials: 'include'
    });
    
    if (response.ok) {
      console.log(`[Profile] ${service} disconnected`);
      await loadGoogleConnections();
      alert(`${formatServiceName(service)} disconnected successfully`);
    } else {
      const error = await response.json();
      alert(error.error || 'Failed to disconnect');
    }
  } catch (error) {
    console.error('[Profile] Disconnect error:', error);
    alert('Network error. Please try again.');
  }
}

// Make disconnectService available globally
window.disconnectService = disconnectService;

// Load activity history
async function loadActivityHistory() {
  console.log('[Profile] Loading activity history');
  
  try {
    const response = await fetch('/api/users/me/activity', {
      credentials: 'include'
    });
    
    if (response.ok) {
      const activities = await response.json();
      console.log('[Profile] Activity history loaded:', activities);
      
      const container = document.getElementById('activityList');
      
      if (activities.length === 0) {
        container.innerHTML = '<p class="text-muted">No recent activity</p>';
        return;
      }
      
      container.innerHTML = activities.slice(0, 10).map(activity => `
        <div class="activity-item">
          <div class="activity-icon">${getActivityIcon(activity.type)}</div>
          <div class="activity-details">
            <p class="activity-text">${activity.description}</p>
            <p class="activity-time">${formatTimeAgo(activity.created_at)}</p>
          </div>
        </div>
      `).join('');
    }
  } catch (error) {
    console.error('[Profile] Error loading activity:', error);
    document.getElementById('activityList').innerHTML = '<p class="text-muted">Unable to load activity</p>';
  }
}

// Get icon for activity type
function getActivityIcon(type) {
  const icons = {
    'login': '🔐',
    'logout': '🚪',
    'profile_update': '✏️',
    'password_change': '🔑',
    'task_created': '📝',
    'task_updated': '✅',
    'client_created': '👥',
    'invoice_created': '💰',
    'settings_updated': '⚙️'
  };
  return icons[type] || '📌';
}

// Format time ago
function formatTimeAgo(dateString) {
  const date = new Date(dateString);
  const now = new Date();
  const seconds = Math.floor((now - date) / 1000);
  
  const intervals = [
    { label: 'year', seconds: 31536000 },
    { label: 'month', seconds: 2592000 },
    { label: 'day', seconds: 86400 },
    { label: 'hour', seconds: 3600 },
    { label: 'minute', seconds: 60 }
  ];
  
  for (const interval of intervals) {
    const count = Math.floor(seconds / interval.seconds);
    if (count >= 1) {
      return `${count} ${interval.label}${count > 1 ? 's' : ''} ago`;
    }
  }
  
  return 'Just now';
}

// Handle avatar upload
async function handleAvatarUpload(e) {
  const file = e.target.files[0];
  
  if (!file) return;
  
  console.log('[Profile] Avatar upload started');
  
  // Validate file
  if (!file.type.startsWith('image/')) {
    alert('Please select an image file');
    return;
  }
  
  if (file.size > 5 * 1024 * 1024) {
    alert('File size must be less than 5MB');
    return;
  }
  
  const formData = new FormData();
  formData.append('avatar', file);
  
  try {
    const response = await fetch('/api/users/me/avatar', {
      method: 'POST',
      credentials: 'include',
      body: formData
    });
    
    if (response.ok) {
      const data = await response.json();
      console.log('[Profile] Avatar uploaded successfully');
      
      // Update preview
      document.getElementById('avatarPreview').innerHTML = `<img src="${data.avatar_url}" alt="Avatar">`;
      document.getElementById('removeAvatarBtn').style.display = 'inline-block';
      
      alert('Avatar updated successfully');
    } else {
      const error = await response.json();
      alert(error.error || 'Failed to upload avatar');
      console.error('[Profile] Avatar upload error:', error);
    }
  } catch (error) {
    console.error('[Profile] Avatar upload error:', error);
    alert('Network error. Please try again.');
  }
  
  // Reset file input
  e.target.value = '';
}

// Remove avatar
async function removeAvatar() {
  console.log('[Profile] Removing avatar');
  
  if (!confirm('Are you sure you want to remove your avatar?')) {
    return;
  }
  
  try {
    const response = await fetch('/api/users/me/avatar', {
      method: 'DELETE',
      credentials: 'include'
    });
    
    if (response.ok) {
      console.log('[Profile] Avatar removed');
      document.getElementById('avatarPreview').innerHTML = '<span class="avatar-placeholder">👤</span>';
      document.getElementById('removeAvatarBtn').style.display = 'none';
      alert('Avatar removed successfully');
    } else {
      const error = await response.json();
      alert(error.error || 'Failed to remove avatar');
    }
  } catch (error) {
    console.error('[Profile] Avatar removal error:', error);
    alert('Network error. Please try again.');
  }
}

// Save profile
async function saveProfile(e) {
  e.preventDefault();
  console.log('[Profile] Saving profile');
  
  const full_name = document.getElementById('fullName').value.trim();
  const email = document.getElementById('email').value.trim();
  const phone = document.getElementById('phone').value.trim();
  const bio = document.getElementById('bio').value.trim();
  
  try {
    const response = await fetch('/api/users/me', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ full_name, email, phone, bio })
    });
    
    if (response.ok) {
      const data = await response.json();
      console.log('[Profile] Profile saved');
      
      // Update display
      document.getElementById('profileName').textContent = data.full_name;
      document.getElementById('profileEmail').textContent = data.email;
      
      alert('Profile updated successfully');
    } else {
      const error = await response.json();
      alert(error.error || 'Failed to save profile');
      console.error('[Profile] Save profile error:', error);
    }
  } catch (error) {
    console.error('[Profile] Save profile error:', error);
    alert('Network error. Please try again.');
  }
}

// Change password
async function changePassword(e) {
  e.preventDefault();
  console.log('[Profile] Changing password');
  
  const current_password = document.getElementById('currentPassword').value;
  const new_password = document.getElementById('newPassword').value;
  const confirm_password = document.getElementById('confirmPassword').value;
  
  // Validate passwords match
  if (new_password !== confirm_password) {
    alert('New passwords do not match');
    return;
  }
  
  // Validate minimum length
  if (new_password.length < 6) {
    alert('Password must be at least 6 characters long');
    return;
  }
  
  try {
    const response = await fetch('/api/auth/change-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ current_password, new_password })
    });
    
    if (response.ok) {
      console.log('[Profile] Password changed');
      document.getElementById('passwordForm').reset();
      alert('Password changed successfully');
    } else {
      const error = await response.json();
      alert(error.error || 'Failed to change password');
      console.error('[Profile] Password change error:', error);
    }
  } catch (error) {
    console.error('[Profile] Password change error:', error);
    alert('Network error. Please try again.');
  }
}

// Save notification preferences
async function saveNotificationPrefs(e) {
  e.preventDefault();
  console.log('[Profile] Saving notification preferences');
  
  const preferences = {
    email_notifications: document.getElementById('prefEmailNotifications').checked,
    whatsapp_notifications: document.getElementById('prefWhatsappNotifications').checked,
    task_assignments: document.getElementById('prefTaskAssignments').checked,
    mentions: document.getElementById('prefMentions').checked
  };
  
  try {
    const response = await fetch('/api/users/me', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ notification_preferences: preferences })
    });
    
    if (response.ok) {
      console.log('[Profile] Notification preferences saved');
      alert('Notification preferences updated');
    } else {
      const error = await response.json();
      alert(error.error || 'Failed to save preferences');
    }
  } catch (error) {
    console.error('[Profile] Save preferences error:', error);
    alert('Network error. Please try again.');
  }
}

// Deactivate account
async function deactivateAccount() {
  console.log('[Profile] Deactivating account');
  
  if (!confirm('Are you sure you want to deactivate your account? You will not be able to log in.')) {
    return;
  }
  
  try {
    const response = await fetch('/api/users/me/deactivate', {
      method: 'POST',
      credentials: 'include'
    });
    
    if (response.ok) {
      console.log('[Profile] Account deactivated');
      alert('Account deactivated. You have been logged out.');
      window.location.href = '/';
    } else {
      const error = await response.json();
      alert(error.error || 'Failed to deactivate account');
    }
  } catch (error) {
    console.error('[Profile] Deactivation error:', error);
    alert('Network error. Please try again.');
  }
}

// Delete account (admin only)
async function deleteAccount() {
  console.log('[Profile] Deleting account');
  
  if (!confirm('WARNING: This will permanently delete your account and all associated data. This action cannot be undone!')) {
    return;
  }
  
  const confirmation = prompt('Type "DELETE" to confirm account deletion:');
  if (confirmation !== 'DELETE') {
    alert('Account deletion cancelled');
    return;
  }
  
  try {
    const response = await fetch('/api/users/me', {
      method: 'DELETE',
      credentials: 'include'
    });
    
    if (response.ok) {
      console.log('[Profile] Account deleted');
      alert('Account deleted. You have been logged out.');
      window.location.href = '/';
    } else {
      const error = await response.json();
      alert(error.error || 'Failed to delete account');
    }
  } catch (error) {
    console.error('[Profile] Deletion error:', error);
    alert('Network error. Please try again.');
  }
}
