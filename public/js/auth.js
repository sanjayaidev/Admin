
// public/js/auth.js
// Frontend authentication logic
let authToken = null;

// Check if user is authenticated
async function checkAuth() {
  // First check if we have a token in session storage
  if (!authToken) {
    authToken = sessionStorage.getItem('auth_token');
  }
  
  try {
    const headers = {};
    if (authToken) {
      headers['Authorization'] = `Bearer ${authToken}`;
    }
    
    const res = await fetch('/api/auth/me', {
      headers,
      credentials: 'include'
    });
    
    if (res.ok) {
      const user = await res.json();
      currentUser = user;
      
      // Store token if not already stored
      if (!authToken && user.token) {
        authToken = user.token;
        sessionStorage.setItem('auth_token', authToken);
      }
      
      return { authenticated: true, user };
    }
  } catch (e) {
    // Not authenticated
  }
  
  return { authenticated: false, user: null };
}

// Show authentication modal
function showAuthModal() {
  // Create modal if it doesn't exist
  if (!document.getElementById('auth-modal-container')) {
    injectAuthModal();
  }
  
  document.getElementById('auth-modal-container').classList.remove('hidden');
  document.body.style.overflow = 'hidden'; // Prevent scrolling
}

// Hide authentication modal
function hideAuthModal() {
  const container = document.getElementById('auth-modal-container');
  if (container) {
    container.classList.add('hidden');
  }
  document.body.style.overflow = '';
}

// Show the app content (called when authenticated)
function showAppContent(user) {
  currentUser = user;
  hideAuthModal();
  
  // Show user info in navbar
  updateNavbar(user);
}

// Update navbar with user info
function updateNavbar(user) {
  // Add user info and logout button to navbar
  const navbar = document.querySelector('.navbar');
  if (!navbar) return;
  
  // Remove existing user section if any
  const existingUser = navbar.querySelector('.navbar-user');
  if (existingUser) {
    existingUser.remove();
  }
  
  // Update brand with organization name if available
  const brand = navbar.querySelector('.brand');
  if (brand && user.orgName) {
    brand.textContent = user.orgName;
  }
  
  const userSection = document.createElement('div');
  userSection.className = 'navbar-user';
  userSection.style.cssText = 'display:flex; align-items:center; gap:12px; margin-left:auto;';
  
  userSection.innerHTML = `
    <span style="font-size:13px; color:#64748b;">
      <strong>${escapeHtml(user.fullname || user.full_name)}</strong>
      <span class="badge" style="font-size:10px; padding:2px 8px;">${escapeHtml(user.role)}</span>
    </span>
    <button onclick="logout()" class="btn outline" style="padding:4px 12px; font-size:12px;">
      Logout
    </button>
  `;
  
  navbar.appendChild(userSection);
}

// Login function
async function login(email, password) {
  const messageEl = document.getElementById('auth-message');
  const submitBtn = document.getElementById('auth-submit-btn');
  
  try {
    messageEl.classList.add('hidden');
    submitBtn.disabled = true;
    submitBtn.classList.add('loading');
    submitBtn.textContent = 'Logging in...';
    
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password })
    });
    
    if (!res.ok) {
      const error = await res.json();
      throw new Error(error.error || 'Login failed');
    }
    
    const user = await res.json();
    currentUser = user;
    
    // Store auth token in session storage
    if (user.token) {
      authToken = user.token;
      sessionStorage.setItem('auth_token', authToken);
    }
    
    hideAuthModal();
    showAppContent(user);
    
  } catch (error) {
    messageEl.textContent = error.message;
    messageEl.className = 'auth-message error';
    messageEl.classList.remove('hidden');
  } finally {
    submitBtn.disabled = false;
    submitBtn.classList.remove('loading');
    submitBtn.textContent = 'Sign In';
  }
}

// Signup function - supports creating org or joining existing org
async function signup(fullName, email, password, orgId, orgSlug) {
  const messageEl = document.getElementById('auth-message');
  const submitBtn = document.getElementById('auth-submit-btn-signup');
  
  try {
    messageEl.classList.add('hidden');
    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.classList.add('loading');
      submitBtn.textContent = 'Creating account...';
    }
    
    const res = await fetch('/api/auth/signup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fullName, email, password, orgId, orgSlug })
    });
    
    if (!res.ok) {
      const error = await res.json();
      throw new Error(error.error || 'Signup failed');
    }
    
    const user = await res.json();
    currentUser = user;
    
    // Store auth token in session storage
    if (user.token) {
      authToken = user.token;
      sessionStorage.setItem('auth_token', authToken);
    }
    
    hideAuthModal();
    showAppContent(user);
    
  } catch (error) {
    messageEl.textContent = error.message;
    messageEl.className = 'auth-message error';
    messageEl.classList.remove('hidden');
  } finally {
    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.classList.remove('loading');
      submitBtn.textContent = 'Create Account';
    }
  }
}

// Logout function
async function logout() {
  try {
    await fetch('/api/auth/logout', { method: 'POST' });
  } catch (e) {
    // Ignore errors
  }
  
  currentUser = null;
  authToken = null;
  
  // Clear auth token from session storage
  sessionStorage.removeItem('auth_token');
  
  // Clear app content
  document.querySelectorAll('.page').forEach(page => {
    page.innerHTML = '';
  });
  
  showAuthModal();
}

// Switch between login and signup tabs
function switchAuthTab(tab) {
  const loginTab = document.getElementById('auth-tab-login');
  const signupTab = document.getElementById('auth-tab-signup');
  const loginForm = document.getElementById('auth-form-login');
  const signupForm = document.getElementById('auth-form-signup');
  
  if (tab === 'login') {
    loginTab.classList.add('active');
    signupTab.classList.remove('active');
    loginForm.classList.remove('hidden');
    signupForm.classList.add('hidden');
  } else {
    signupTab.classList.add('active');
    loginTab.classList.remove('active');
    signupForm.classList.remove('hidden');
    loginForm.classList.add('hidden');
  }
  
  // Clear messages
  document.getElementById('auth-message').classList.add('hidden');
}

// Inject auth modal into the page
function injectAuthModal() {
  const container = document.createElement('div');
  container.id = 'auth-modal-container';
  container.className = 'auth-modal-overlay hidden';
  
  container.innerHTML = `
    <div class="auth-modal" onclick="event.stopPropagation()">
      <div class="auth-modal-header">
        <span class="logo">📊 ClientPM</span>
        <p class="subtitle">Project Management Platform</p>
      </div>
      
      <!-- Tabs -->
      <div class="auth-tabs">
        <button id="auth-tab-login" class="auth-tab active" onclick="switchAuthTab('login')">
          Sign In
        </button>
        <button id="auth-tab-signup" class="auth-tab" onclick="switchAuthTab('signup')">
          Create Account
        </button>
      </div>
      
      <!-- Message -->
      <div id="auth-message" class="auth-message hidden"></div>
      
      <!-- Login Form -->
      <form id="auth-form-login" class="auth-form" onsubmit="event.preventDefault(); login(document.getElementById('login-email').value, document.getElementById('login-password').value)">
        <div class="input-group">
          <label for="login-email">Email</label>
          <input id="login-email" type="email" placeholder="you@example.com" required />
        </div>
        <div class="input-group">
          <label for="login-password">Password</label>
          <input id="login-password" type="password" placeholder="Enter your password" required />
        </div>
        <button id="auth-submit-btn" type="submit" class="auth-submit-btn">Sign In</button>
      </form>
      
      <!-- Signup Form -->
      <form id="auth-form-signup" class="auth-form hidden" onsubmit="event.preventDefault(); handleSignup()">
        <div class="input-group">
          <label for="signup-name">Full Name</label>
          <input id="signup-name" type="text" placeholder="John Doe" required />
        </div>
        <div class="input-group">
          <label for="signup-email">Email</label>
          <input id="signup-email" type="email" placeholder="you@example.com" required />
        </div>
        <div class="input-group">
          <label for="signup-password">Password (min 6 characters)</label>
          <input id="signup-password" type="password" placeholder="Create a password" minlength="6" required />
          <div class="password-strength">
            <div class="password-strength-bar" id="password-strength-bar"></div>
          </div>
        </div>
        
        <!-- Signup Mode Toggle -->
        <div class="input-group">
          <label>Signup Type</label>
          <div class="role-selector">
            <label class="role-option selected" id="mode-create-label">
              <input type="radio" name="signup-mode" value="create" checked onchange="setSignupMode('create')" />
              <span class="role-icon">🏢</span>
              Create Organization
            </label>
            <label class="role-option" id="mode-join-label">
              <input type="radio" name="signup-mode" value="join" onchange="setSignupMode('join')" />
              <span class="role-icon">👥</span>
              Join Existing Org
            </label>
          </div>
          <span class="hint">Create your own org as admin, or join an existing team (pending approval).</span>
        </div>
        
        <!-- Create Org: Organization Name and ID Fields -->
        <div class="input-group" id="org-name-group">
          <label for="signup-org-name">Organization Name</label>
          <input id="signup-org-name" type="text" placeholder="Your Company Name" />
          <span class="hint">This creates your organization workspace. You'll be the admin.</span>
        </div>
        <div class="input-group" id="org-id-group">
          <label for="signup-org-id-create">Organization ID (Optional)</label>
          <input id="signup-org-id-create" type="text" placeholder="e.g., org-123 or leave blank to auto-generate" />
          <span class="hint">Optional: Provide a specific ID for your organization, or leave blank to auto-generate.</span>
        </div>
        
        <!-- Join Org: Org ID Field Only -->
        <div class="input-group hidden" id="org-join-group">
          <label for="signup-org-id-join">Organization ID</label>
          <input id="signup-org-id-join" type="text" placeholder="e.g., org-123" />
          <span class="hint">Ask your admin for the org ID. Your account will need approval before access.</span>
          <button type="button" id="validate-org-btn" class="btn outline" style="margin-top:8px; padding:4px 12px; font-size:12px;" onclick="validateOrganization()">Validate Organization ID</button>
          <span id="org-validation-message" class="hint" style="display:block; margin-top:4px;"></span>
        </div>
        
        <button id="auth-submit-btn-signup" type="submit" class="auth-submit-btn">Create Account</button>
      </form>
      
      <div class="auth-footer">
        ${new Date().getFullYear()} ClientPM · Secure Authentication
      </div>
    </div>
  `;
  
  document.body.appendChild(container);
  
  // Password strength indicator
  const passwordInput = document.getElementById('signup-password');
  if (passwordInput) {
    passwordInput.addEventListener('input', function() {
      const bar = document.getElementById('password-strength-bar');
      const val = this.value;
      let strength = 0;
      if (val.length >= 6) strength++;
      if (val.length >= 10) strength++;
      if (/[a-z]/.test(val) && /[A-Z]/.test(val)) strength++;
      if (/\d/.test(val)) strength++;
      if (/[^a-zA-Z0-9]/.test(val)) strength++;
      
      const percent = Math.min(strength / 5 * 100, 100);
      bar.style.width = percent + '%';
      bar.className = 'password-strength-bar';
      if (percent < 40) bar.classList.add('weak');
      else if (percent < 70) bar.classList.add('medium');
      else bar.classList.add('strong');
    });
  }
}

// Escape HTML for security
function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str || '';
  return div.innerHTML;
}

// Set signup mode (create org or join org)
function setSignupMode(mode) {
  const createGroup = document.getElementById('org-name-group');
  const orgIdCreateGroup = document.getElementById('org-id-group');
  const joinGroup = document.getElementById('org-join-group');
  const orgNameInput = document.getElementById('signup-org-name');
  const orgIdCreateInput = document.getElementById('signup-org-id-create');
  const orgIdJoinInput = document.getElementById('signup-org-id-join');
  const createLabel = document.getElementById('mode-create-label');
  const joinLabel = document.getElementById('mode-join-label');
  const validationMessage = document.getElementById('org-validation-message');
  
  // Clear validation message when switching modes
  if (validationMessage) {
    validationMessage.textContent = '';
    validationMessage.style.color = '';
  }
  
  if (mode === 'create') {
    createGroup.classList.remove('hidden');
    orgIdCreateGroup.classList.remove('hidden');
    joinGroup.classList.add('hidden');
    orgNameInput.required = true;
    orgIdCreateInput.required = false;
    orgIdJoinInput.required = false;
    createLabel.classList.add('selected');
    joinLabel.classList.remove('selected');
  } else {
    createGroup.classList.add('hidden');
    orgIdCreateGroup.classList.add('hidden');
    joinGroup.classList.remove('hidden');
    orgNameInput.required = false;
    orgIdCreateInput.required = false;
    orgIdJoinInput.required = true;
    createLabel.classList.remove('selected');
    joinLabel.classList.add('selected');
  }
}

// Validate organization ID before joining
async function validateOrganization() {
  const orgId = document.getElementById('signup-org-id-join').value.trim();
  const validationMessage = document.getElementById('org-validation-message');
  
  if (!orgId) {
    validationMessage.textContent = 'Please enter an organization ID';
    validationMessage.style.color = '#ef4444';
    return false;
  }
  
  try {
    validationMessage.textContent = 'Validating...';
    validationMessage.style.color = '#64748b';
    
    const res = await fetch(`/api/auth/validate-org?id=${encodeURIComponent(orgId)}`, {
      method: 'GET',
      credentials: 'include'
    });
    
    if (res.ok) {
      const data = await res.json();
      if (data.valid) {
        validationMessage.textContent = `✓ Valid organization: ${data.orgName}`;
        validationMessage.style.color = '#22c55e';
        return true;
      } else {
        validationMessage.textContent = '✗ Organization not found';
        validationMessage.style.color = '#ef4444';
        return false;
      }
    } else {
      const error = await res.json();
      validationMessage.textContent = `✗ ${error.error || 'Organization not found'}`;
      validationMessage.style.color = '#ef4444';
      return false;
    }
  } catch (error) {
    validationMessage.textContent = '✗ Error validating organization';
    validationMessage.style.color = '#ef4444';
    return false;
  }
}

// Handle signup form submission
function handleSignup() {
  const fullName = document.getElementById('signup-name').value;
  const email = document.getElementById('signup-email').value;
  const password = document.getElementById('signup-password').value;
  const mode = document.querySelector('input[name="signup-mode"]:checked')?.value;
  
  if (mode === 'create') {
    const orgName = document.getElementById('signup-org-name').value;
    const orgIdCreate = document.getElementById('signup-org-id-create').value.trim();
    signup(fullName, email, password, orgIdCreate || null, orgName); // orgId optional for create, orgSlug passed as orgName
  } else {
    const orgId = document.getElementById('signup-org-id-join').value.trim();
    // Validate organization ID before proceeding
    validateOrganization().then(isValid => {
      if (isValid) {
        // Check if it looks like a UUID or a regular ID
        const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(orgId);
        signup(fullName, email, password, isUuid ? orgId : null, isUuid ? null : orgId);
      } else {
        const messageEl = document.getElementById('auth-message');
        messageEl.textContent = 'Please validate the organization ID before creating account';
        messageEl.className = 'auth-message error';
        messageEl.classList.remove('hidden');
      }
    });
  }
}

// Make auth functions globally available
window.login = login;
window.signup = signup;
window.logout = logout;
window.checkAuth = checkAuth;
window.switchAuthTab = switchAuthTab;
window.showAuthModal = showAuthModal;
window.updateNavbar = updateNavbar;
window.showAppContent = showAppContent;
window.setSignupMode = setSignupMode;
window.handleSignup = handleSignup;
window.validateOrganization = validateOrganization;

// Initialize auth check when DOM is ready
document.addEventListener('DOMContentLoaded', async function() {
  // Check if user is authenticated
  const authResult = await checkAuth();
  
  if (!authResult.authenticated) {
    // User is not authenticated, show the auth modal
    showAuthModal();
    return;
  }
  
  // User is authenticated, update navbar and load page-specific data
  currentUser = authResult.user;
  updateNavbar(currentUser);
  
  // Call page-specific init function if it exists
  if (typeof loadDashboard === 'function') {
    loadDashboard();
  }
  if (typeof loadClients === 'function') {
    loadClients();
  }
  if (typeof loadTasks === 'function') {
    loadTasks();
  }
  if (typeof initCalendar === 'function') {
    initCalendar();
  }
  if (typeof loadTeamMembers === 'function') {
    loadTeamMembers();
    loadWorkloadData();
  }
  if (typeof loadUserSettings === 'function') {
    loadUserSettings();
    loadIntegrations();
  }
  if (typeof loadProfileData === 'function') {
    loadProfileData();
  }
});
