/**
 * Team Management Page JavaScript
 * Handles team member CRUD, role management, and workload distribution
 */

// State management
let currentUser = null;
let teamMembers = [];
let isAdmin = false;

// Initialize page
document.addEventListener('DOMContentLoaded', async () => {
  console.log('[Team] Page loaded');
  
  // Check authentication using the global checkAuth from auth.js
  const authResult = await window.checkAuth();
  
  if (!authResult.authenticated) {
    // User is not authenticated, show the inline modal
    document.getElementById('authModal').style.display = 'flex';
    return;
  }
  
  currentUser = authResult.user;
  isAdmin = currentUser.role === 'admin';
  
  document.getElementById('mainContent').style.display = 'block';
  
  // Show/hide admin features
  if (isAdmin) {
    document.getElementById('addMemberBtn').style.display = 'block';
  } else {
    document.getElementById('adminNotice').style.display = 'block';
  }
  
  // Update navbar with logout handler
  updateNavbar(currentUser);
  
  // Load team data
  await loadTeamMembers();
  await loadWorkloadData();
  
  // Setup event listeners
  setupEventListeners();
});

// Update navbar with user info and logout button
function updateNavbar(user) {
  const logoutBtn = document.getElementById('logoutBtn');
  if (logoutBtn) {
    logoutBtn.style.display = 'inline-block';
    logoutBtn.onclick = handleLogout;
  }
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
  
  // Add member button
  document.getElementById('addMemberBtn').addEventListener('click', () => openMemberModal());
  
  // Member form
  document.getElementById('memberForm').addEventListener('submit', saveMember);
  
  // Filters
  document.getElementById('roleFilter').addEventListener('change', filterTeamMembers);
  document.getElementById('statusFilter').addEventListener('change', filterTeamMembers);
  document.getElementById('searchInput').addEventListener('input', filterTeamMembers);
}

// Handle login
async function handleLogin(e) {
  e.preventDefault();
  
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
      currentUser = data.user;
      isAdmin = currentUser.role === 'admin';
      
      // Store auth token in session storage
      if (data.token) {
        sessionStorage.setItem('auth_token', data.token);
      }
      
      document.getElementById('authModal').style.display = 'none';
      document.getElementById('mainContent').style.display = 'block';
      
      if (isAdmin) {
        document.getElementById('addMemberBtn').style.display = 'block';
      } else {
        document.getElementById('adminNotice').style.display = 'block';
      }
      
      updateNavbar(currentUser);
      await loadTeamMembers();
    } else {
      alert(data.error || 'Login failed');
    }
  } catch (error) {
    console.error('[Team] Login error:', error);
    alert('Network error. Please try again.');
  }
}

// Handle signup
async function handleSignup(e) {
  e.preventDefault();
  
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
      currentUser = data.user;
      
      // Store auth token in session storage
      if (data.token) {
        sessionStorage.setItem('auth_token', data.token);
      }
      
      document.getElementById('authModal').style.display = 'none';
      document.getElementById('mainContent').style.display = 'block';
      updateNavbar(currentUser);
      await loadTeamMembers();
    } else {
      alert(data.error || 'Signup failed');
    }
  } catch (error) {
    console.error('[Team] Signup error:', error);
    alert('Network error. Please try again.');
  }
}

// Handle logout
async function handleLogout() {
  try {
    await fetch('/api/auth/logout', {
      method: 'POST',
      credentials: 'include'
    });
    
    // Clear auth token from session storage
    sessionStorage.removeItem('auth_token');
    
    window.location.href = '/';
  } catch (error) {
    console.error('[Team] Logout error:', error);
    window.location.href = '/';
  }
}

// Load team members
async function loadTeamMembers() {
  console.log('[Team] Loading team members');
  
  try {
    const response = await fetch('/api/team/members', {
      credentials: 'include'
    });
    
    if (response.ok) {
      teamMembers = await response.json();
      console.log('[Team] Team members loaded:', teamMembers);
      
      renderTeamGrid(teamMembers);
      updateStats(teamMembers);
    } else {
      console.error('[Team] Failed to load team members');
    }
  } catch (error) {
    console.error('[Team] Error loading team:', error);
  }
}

// Render team grid
function renderTeamGrid(members) {
  const grid = document.getElementById('teamGrid');
  
  if (members.length === 0) {
    grid.innerHTML = '<p class="text-muted">No team members found</p>';
    return;
  }
  
  grid.innerHTML = members.map(member => `
    <div class="team-card" data-role="${member.role}" data-status="${member.is_active ? 'active' : 'inactive'}">
      <div class="team-avatar">
        ${member.avatar ? 
          `<img src="${member.avatar}" alt="${member.full_name}">` :
          `<span class="avatar-placeholder">${getInitials(member.full_name)}</span>`
        }
      </div>
      <div class="team-info">
        <h3>${escapeHtml(member.full_name)}</h3>
        <p class="email">${escapeHtml(member.email)}</p>
        ${member.phone ? `<p class="phone">${escapeHtml(member.phone)}</p>` : ''}
        <div class="team-meta">
          <span class="badge badge-${member.role}">${member.role}</span>
          <span class="status-badge ${member.is_active ? 'connected' : 'disconnected'}">
            ${member.is_active ? 'Active' : 'Inactive'}
          </span>
        </div>
      </div>
      ${isAdmin ? `
      <div class="team-actions">
        <button class="btn btn-sm btn-outline" onclick="editMember('${member.id}')">Edit</button>
        <button class="btn btn-sm btn-${member.is_active ? 'warning' : 'success'}" onclick="toggleMemberStatus('${member.id}', ${!member.is_active})">
          ${member.is_active ? 'Deactivate' : 'Activate'}
        </button>
        ${member.role !== 'admin' || currentUser.id === member.id ? '' : 
          `<button class="btn btn-sm btn-danger" onclick="deleteMember('${member.id}')">Delete</button>`
        }
      </div>
      ` : ''}
    </div>
  `).join('');
}

// Update stats
function updateStats(members) {
  const total = members.length;
  const admins = members.filter(m => m.role === 'admin').length;
  const team = members.filter(m => m.role === 'team').length;
  const clients = members.filter(m => m.role === 'client').length;
  
  document.getElementById('totalMembers').textContent = total;
  document.getElementById('totalAdmins').textContent = admins;
  document.getElementById('totalTeam').textContent = team;
  document.getElementById('totalClients').textContent = clients;
}

// Filter team members
function filterTeamMembers() {
  const roleFilter = document.getElementById('roleFilter').value;
  const statusFilter = document.getElementById('statusFilter').value;
  const searchTerm = document.getElementById('searchInput').value.toLowerCase();
  
  let filtered = teamMembers;
  
  if (roleFilter !== 'all') {
    filtered = filtered.filter(m => m.role === roleFilter);
  }
  
  if (statusFilter !== 'all') {
    const isActive = statusFilter === 'active';
    filtered = filtered.filter(m => m.is_active === isActive);
  }
  
  if (searchTerm) {
    filtered = filtered.filter(m => 
      m.full_name.toLowerCase().includes(searchTerm) ||
      m.email.toLowerCase().includes(searchTerm)
    );
  }
  
  renderTeamGrid(filtered);
}

// Load workload data
async function loadWorkloadData() {
  console.log('[Team] Loading workload data');
  
  try {
    const response = await fetch('/api/team/workload', {
      credentials: 'include'
    });
    
    if (response.ok) {
      const workload = await response.json();
      console.log('[Team] Workload data loaded:', workload);
      renderWorkloadGrid(workload);
    }
  } catch (error) {
    console.error('[Team] Error loading workload:', error);
  }
}

// Render workload grid
function renderWorkloadGrid(workload) {
  const grid = document.getElementById('workloadGrid');
  
  if (!workload || workload.length === 0) {
    grid.innerHTML = '<p class="text-muted">No workload data available</p>';
    return;
  }
  
  grid.innerHTML = workload.map(item => `
    <div class="workload-card">
      <div class="workload-header">
        <h4>${escapeHtml(item.member_name)}</h4>
        <span class="task-count">${item.task_count} tasks</span>
      </div>
      <div class="workload-progress">
        <div class="progress-bar">
          <div class="progress-fill" style="width: ${calculateWorkloadPercent(item.task_count)}%"></div>
        </div>
        <div class="workload-stats">
          <span class="stat-pending">${item.pending || 0} Pending</span>
          <span class="stat-progress">${item.in_progress || 0} In Progress</span>
          <span class="stat-completed">${item.completed || 0} Completed</span>
        </div>
      </div>
    </div>
  `).join('');
}

// Calculate workload percentage for visual
function calculateWorkloadPercent(taskCount) {
  const maxTasks = 20; // Assume 20 tasks is 100% workload
  return Math.min((taskCount / maxTasks) * 100, 100);
}

// Open member modal
function openMemberModal(member = null) {
  const modal = document.getElementById('memberModal');
  const form = document.getElementById('memberForm');
  const title = document.getElementById('modalTitle');
  
  form.reset();
  
  if (member) {
    title.textContent = 'Edit Team Member';
    document.getElementById('memberId').value = member.id;
    document.getElementById('memberName').value = member.full_name;
    document.getElementById('memberEmail').value = member.email;
    document.getElementById('memberPhone').value = member.phone || '';
    document.getElementById('memberRole').value = member.role;
    document.getElementById('memberPassword').value = '';
  } else {
    title.textContent = 'Add Team Member';
    document.getElementById('memberId').value = '';
  }
  
  modal.style.display = 'flex';
}

// Close member modal
function closeMemberModal() {
  document.getElementById('memberModal').style.display = 'none';
}

// Edit member
function editMember(id) {
  const member = teamMembers.find(m => m.id === id);
  if (member) {
    openMemberModal(member);
  }
}

// Make functions global
window.editMember = editMember;
window.closeMemberModal = closeMemberModal;

// Save member
async function saveMember(e) {
  e.preventDefault();
  
  const memberId = document.getElementById('memberId').value;
  const full_name = document.getElementById('memberName').value.trim();
  const email = document.getElementById('memberEmail').value.trim();
  const phone = document.getElementById('memberPhone').value.trim();
  const role = document.getElementById('memberRole').value;
  const password = document.getElementById('memberPassword').value;
  
  const data = { full_name, email, phone, role };
  if (password) {
    data.password = password;
  }
  
  try {
    const url = memberId ? `/api/team/members/${memberId}` : '/api/team/members';
    const method = memberId ? 'PUT' : 'POST';
    
    const response = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify(data)
    });
    
    if (response.ok) {
      console.log('[Team] Member saved');
      closeMemberModal();
      await loadTeamMembers();
      alert(`Member ${memberId ? 'updated' : 'added'} successfully`);
    } else {
      const error = await response.json();
      alert(error.error || 'Failed to save member');
    }
  } catch (error) {
    console.error('[Team] Save member error:', error);
    alert('Network error. Please try again.');
  }
}

// Toggle member status
async function toggleMemberStatus(id, isActive) {
  if (!confirm(`Are you sure you want to ${isActive ? 'activate' : 'deactivate'} this member?`)) {
    return;
  }
  
  try {
    const response = await fetch(`/api/team/members/${id}/status`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ is_active: isActive })
    });
    
    if (response.ok) {
      console.log('[Team] Member status updated');
      await loadTeamMembers();
    } else {
      const error = await response.json();
      alert(error.error || 'Failed to update status');
    }
  } catch (error) {
    console.error('[Team] Toggle status error:', error);
    alert('Network error. Please try again.');
  }
}

// Delete member
async function deleteMember(id) {
  if (!confirm('Are you sure you want to delete this team member? This cannot be undone.')) {
    return;
  }
  
  const confirmation = prompt('Type "DELETE" to confirm:');
  if (confirmation !== 'DELETE') {
    return;
  }
  
  try {
    const response = await fetch(`/api/team/members/${id}`, {
      method: 'DELETE',
      credentials: 'include'
    });
    
    if (response.ok) {
      console.log('[Team] Member deleted');
      await loadTeamMembers();
      alert('Member deleted successfully');
    } else {
      const error = await response.json();
      alert(error.error || 'Failed to delete member');
    }
  } catch (error) {
    console.error('[Team] Delete member error:', error);
    alert('Network error. Please try again.');
  }
}

// Make delete function global
window.deleteMember = deleteMember;
window.toggleMemberStatus = toggleMemberStatus;

// Utility: Get initials from name
function getInitials(name) {
  return name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2);
}

// Utility: Escape HTML
function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}
