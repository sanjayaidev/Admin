// public/js/team.js
// Team management — custom roles + role-based access

let allMembers = [];
let allRoles = [];
let deleteTargetId = null;
let isAdmin = false;

// ─── Called by auth.js after auth check ───────────────────────────────────────

async function loadTeamMembers() {
  const authResult = await window.checkAuth();
  if (!authResult.authenticated) return;

  window.currentUser = authResult.user;
  isAdmin = window.currentUser.role === 'admin';

  // Show admin controls
  if (isAdmin) {
    const adminActions = document.getElementById('admin-actions');
    if (adminActions) {
      adminActions.style.display = 'flex';
    }
    // Load pending join requests for admin
    loadPendingJoinRequests();
  } else {
    const notice = document.getElementById('member-notice');
    if (notice) notice.style.display = 'block';
  }

  await Promise.all([fetchRoles(), fetchMembers(), fetchWorkload()]);
}

// Also expose loadWorkloadData so auth.js can call it (it calls both)
async function loadWorkloadData() {
  // Already called inside loadTeamMembers via fetchWorkload()
  // This stub prevents auth.js from erroring
}

// ─── Pending Join Requests (Admin only) ───────────────────────────────────────

async function loadPendingJoinRequests() {
  try {
    const res = await fetch('/api/org/join-requests', { credentials: 'include' });
    if (!res.ok) throw new Error('Failed to fetch requests');
    const requests = await res.json();
    
    const panel = document.getElementById('pending-requests-panel');
    const list = document.getElementById('pending-requests-list');
    
    if (requests.length === 0) {
      panel.classList.add('hidden');
      return;
    }
    
    panel.classList.remove('hidden');
    list.innerHTML = requests.map(r => `
      <div style="display:flex; justify-content:space-between; align-items:center; padding:12px; background:#f8fafc; border-radius:8px; border:1px solid #e2e8f0;">
        <div>
          <div style="font-weight:600; color:var(--gray-800);">${escapeHtml(r.user_name)}</div>
          <div style="font-size:13px; color:var(--gray-500);">${escapeHtml(r.user_email)}</div>
          <div style="font-size:12px; color:var(--gray-400); margin-top:4px;">Requested: ${new Date(r.requested_at).toLocaleDateString()}</div>
        </div>
        <div style="display:flex; gap:8px;">
          <button class="btn success-btn" onclick="decideJoinRequest(${r.id}, 'approved')">✓ Approve</button>
          <button class="btn danger" onclick="decideJoinRequest(${r.id}, 'rejected')">✗ Reject</button>
        </div>
      </div>
    `).join('');
  } catch (err) {
    console.error('Failed to load join requests:', err);
  }
}

async function decideJoinRequest(requestId, status) {
  if (!confirm(`${status === 'approved' ? 'Approve' : 'Reject'} this join request?`)) return;
  
  try {
    const res = await fetch(`/api/org/join-requests/${requestId}/decide`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ status })
    });
    
    if (!res.ok) {
      const err = await res.json();
      alert(err.error || 'Failed to process request');
      return;
    }
    
    // Reload requests and members
    await loadPendingJoinRequests();
    await fetchMembers();
  } catch (err) {
    alert('Network error. Please try again.');
  }
}

// ─── Data fetching ─────────────────────────────────────────────────────────────

async function fetchMembers() {
  try {
    const res = await fetch('/api/team/members', { credentials: 'include' });
    if (!res.ok) throw new Error('Failed to fetch members');
    allMembers = await res.json();
    renderMembers();
    renderStats();
  } catch (err) {
    document.getElementById('team-grid').innerHTML =
      '<p style="color:var(--danger);">Failed to load team members.</p>';
  }
}

async function fetchRoles() {
  try {
    const res = await fetch('/api/roles', { credentials: 'include' });
    if (!res.ok) throw new Error('Failed to fetch roles');
    allRoles = await res.json();
    populateRoleFilters();
    populateRoleDropdown();
  } catch (err) {
    console.error('Failed to load roles:', err);
  }
}

async function fetchWorkload() {
  try {
    const res = await fetch('/api/team/workload', { credentials: 'include' });
    if (!res.ok) throw new Error();
    const data = await res.json();
    renderWorkload(data);
  } catch (err) {
    document.getElementById('workload-grid').innerHTML =
      '<p style="color:var(--gray-400);">No workload data available.</p>';
  }
}

// ─── Render: Team Grid ─────────────────────────────────────────────────────────

function renderMembers() {
  const search = (document.getElementById('search-input')?.value || '').toLowerCase();
  const roleFilter = document.getElementById('filter-role')?.value || '';
  const statusFilter = document.getElementById('filter-status')?.value || '';

  let filtered = allMembers.filter(m => {
    const matchSearch =
      !search ||
      m.full_name.toLowerCase().includes(search) ||
      m.email.toLowerCase().includes(search);
    const matchRole =
      !roleFilter ||
      m.role === roleFilter ||
      m.custom_role === roleFilter;
    const matchStatus =
      !statusFilter ||
      (statusFilter === 'active' && m.is_active) ||
      (statusFilter === 'inactive' && !m.is_active);
    return matchSearch && matchRole && matchStatus;
  });

  const grid = document.getElementById('team-grid');
  document.getElementById('team-count').textContent =
    `${filtered.length} member${filtered.length !== 1 ? 's' : ''}`;

  if (filtered.length === 0) {
    grid.innerHTML = '<div class="empty-state"><p>No members found</p></div>';
    return;
  }

  grid.innerHTML = filtered.map(m => memberCardHtml(m)).join('');
}

function memberCardHtml(m) {
  const initials = m.full_name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2);
  const roleBadge = m.custom_role
    ? `<span class="role-tag" style="background:${getRoleColor(m.custom_role)}22; color:${getRoleColor(m.custom_role)}; border:1px solid ${getRoleColor(m.custom_role)}44;">${escapeHtml(m.custom_role)}</span>`
    : '';

  const systemBadge = m.role === 'admin'
    ? `<span class="system-badge admin">Admin</span>`
    : `<span class="system-badge team">Team</span>`;

  const statusDot = m.is_active
    ? `<span class="status-dot active"></span>`
    : `<span class="status-dot inactive"></span>`;

  const adminControls = isAdmin ? `
    <div class="member-card-actions">
      <button class="btn outline small" onclick="openEditMember('${m.id}')">Edit</button>
      <button class="btn outline small ${m.is_active ? 'warn' : 'success-btn'}" onclick="toggleStatus('${m.id}', ${!m.is_active})">
        ${m.is_active ? 'Deactivate' : 'Activate'}
      </button>
      ${m.id !== window.currentUser.id ? `<button class="btn danger small" onclick="openDeleteModal('${m.id}', '${escapeHtml(m.full_name)}')">Remove</button>` : ''}
    </div>
  ` : '';

  return `
    <div class="member-card ${m.is_active ? '' : 'inactive'}">
      <div class="member-card-top">
        <div class="member-avatar">${initials}</div>
        <div class="member-header-right">
          ${statusDot}
          ${systemBadge}
        </div>
      </div>
      <div class="member-info">
        <div class="member-name">${escapeHtml(m.full_name)}</div>
        <div class="member-email">${escapeHtml(m.email)}</div>
        ${m.phone ? `<div class="member-phone">${escapeHtml(m.phone)}</div>` : ''}
        <div class="member-badges">
          ${roleBadge}
        </div>
      </div>
      ${adminControls}
    </div>
  `;
}

function getRoleColor(roleName) {
  const role = allRoles.find(r => r.name === roleName);
  return role?.color || '#4f46e5';
}

// ─── Render: Stats ─────────────────────────────────────────────────────────────

function renderStats() {
  document.getElementById('stat-total').textContent = allMembers.length;
  document.getElementById('stat-admins').textContent = allMembers.filter(m => m.role === 'admin').length;
  document.getElementById('stat-active').textContent = allMembers.filter(m => m.is_active).length;
  document.getElementById('stat-roles').textContent = allRoles.length;
}

// ─── Render: Workload ──────────────────────────────────────────────────────────

function renderWorkload(data) {
  const grid = document.getElementById('workload-grid');
  if (!data || data.length === 0) {
    grid.innerHTML = '<p style="color:var(--gray-400);">No workload data yet.</p>';
    return;
  }

  const max = Math.max(...data.map(d => parseInt(d.task_count) || 0), 1);

  grid.innerHTML = data.map(item => {
    const pct = Math.round((parseInt(item.task_count) / max) * 100);
    return `
      <div class="workload-card">
        <div class="workload-top">
          <span class="workload-name">${escapeHtml(item.member_name)}</span>
          <span class="workload-count">${item.task_count} task${item.task_count != 1 ? 's' : ''}</span>
        </div>
        <div class="workload-bar-wrap">
          <div class="workload-bar-fill" style="width:${pct}%"></div>
        </div>
        <div class="workload-breakdown">
          <span class="wb pending">${item.pending || 0} Pending</span>
          <span class="wb in-progress">${item.in_progress || 0} In Progress</span>
          <span class="wb completed">${item.completed || 0} Done</span>
        </div>
      </div>
    `;
  }).join('');
}

// ─── Populate Dropdowns ────────────────────────────────────────────────────────

function populateRoleFilters() {
  const select = document.getElementById('filter-role');
  if (!select) return;
  select.innerHTML = '<option value="">All Roles</option>';
  select.innerHTML += '<option value="admin">Admin</option>';
  select.innerHTML += '<option value="team">Team</option>';
  allRoles.forEach(r => {
    select.innerHTML += `<option value="${escapeHtml(r.name)}">${escapeHtml(r.name)}</option>`;
  });
}

function populateRoleDropdown() {
  const select = document.getElementById('m-custom-role');
  if (!select) return;
  select.innerHTML = '<option value="">— Select Job Role —</option>';
  allRoles.forEach(r => {
    select.innerHTML += `<option value="${escapeHtml(r.name)}">${escapeHtml(r.name)}</option>`;
  });
}

// ─── Member Modal ──────────────────────────────────────────────────────────────

function openMemberModal() {
  document.getElementById('member-modal-title').textContent = 'Add Team Member';
  document.getElementById('m-id').value = '';
  document.getElementById('m-name').value = '';
  document.getElementById('m-email').value = '';
  document.getElementById('m-phone').value = '';
  document.getElementById('m-role').value = 'team';
  document.getElementById('m-custom-role').value = '';
  document.getElementById('m-password').value = '';
  document.getElementById('member-modal').classList.add('open');
}

function openEditMember(id) {
  const m = allMembers.find(x => x.id == id);
  if (!m) return;
  document.getElementById('member-modal-title').textContent = 'Edit Team Member';
  document.getElementById('m-id').value = m.id;
  document.getElementById('m-name').value = m.full_name;
  document.getElementById('m-email').value = m.email;
  document.getElementById('m-phone').value = m.phone || '';
  document.getElementById('m-role').value = m.role;
  document.getElementById('m-custom-role').value = m.custom_role || '';
  document.getElementById('m-password').value = '';
  document.getElementById('member-modal').classList.add('open');
}

function closeMemberModal() {
  document.getElementById('member-modal').classList.remove('open');
}

async function saveMember() {
  const id = document.getElementById('m-id').value;
  const full_name = document.getElementById('m-name').value.trim();
  const email = document.getElementById('m-email').value.trim();
  const phone = document.getElementById('m-phone').value.trim();
  const role = document.getElementById('m-role').value;
  const custom_role = document.getElementById('m-custom-role').value;
  const password = document.getElementById('m-password').value;

  if (!full_name || !email) {
    alert('Name and email are required');
    return;
  }

  const data = { full_name, email, phone, role, custom_role: custom_role || null };
  if (password) data.password = password;

  try {
    const url = id ? `/api/team/members/${id}` : '/api/team/members';
    const method = id ? 'PUT' : 'POST';

    const res = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify(data)
    });

    if (!res.ok) {
      const err = await res.json();
      alert(err.error || 'Failed to save member');
      return;
    }

    closeMemberModal();
    await fetchMembers();
  } catch (err) {
    alert('Network error. Please try again.');
  }
}

// ─── Toggle Status ─────────────────────────────────────────────────────────────

async function toggleStatus(id, isActive) {
  if (!confirm(`${isActive ? 'Activate' : 'Deactivate'} this member?`)) return;
  try {
    const res = await fetch(`/api/team/members/${id}/status`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ is_active: isActive })
    });
    if (res.ok) await fetchMembers();
    else alert('Failed to update status');
  } catch (err) {
    alert('Network error');
  }
}

// ─── Delete Member ─────────────────────────────────────────────────────────────

function openDeleteModal(id, name) {
  deleteTargetId = id;
  document.getElementById('delete-confirm-text').textContent =
    `Are you sure you want to remove "${name}"? This cannot be undone.`;
  document.getElementById('delete-modal').classList.add('open');
}

function closeDeleteModal() {
  deleteTargetId = null;
  document.getElementById('delete-modal').classList.remove('open');
}

async function confirmDelete() {
  if (!deleteTargetId) return;
  try {
    const res = await fetch(`/api/team/members/${deleteTargetId}`, {
      method: 'DELETE',
      credentials: 'include'
    });
    if (res.ok) {
      closeDeleteModal();
      await fetchMembers();
    } else {
      const err = await res.json();
      alert(err.error || 'Failed to remove member');
    }
  } catch (err) {
    alert('Network error');
  }
}

// ─── Roles Modal ───────────────────────────────────────────────────────────────

function openRolesModal() {
  document.getElementById('roles-modal').classList.add('open');
  renderRolesList();
}

function closeRolesModal() {
  document.getElementById('roles-modal').classList.remove('open');
}

function renderRolesList() {
  const list = document.getElementById('roles-list');
  if (allRoles.length === 0) {
    list.innerHTML = '<p style="color:var(--gray-400); font-size:13px;">No roles yet. Create one above.</p>';
    return;
  }

  list.innerHTML = allRoles.map(r => `
    <div class="role-list-item">
      <span class="role-color-dot" style="background:${r.color};"></span>
      <div class="role-list-info">
        <span class="role-list-name">${escapeHtml(r.name)}</span>
        ${r.description ? `<span class="role-list-desc">${escapeHtml(r.description)}</span>` : ''}
      </div>
      <button class="btn danger small" onclick="deleteRole(${r.id}, '${escapeHtml(r.name)}')">Remove</button>
    </div>
  `).join('');
}

async function createRole() {
  const name = document.getElementById('new-role-name').value.trim();
  const description = document.getElementById('new-role-desc').value.trim();
  const color = document.getElementById('new-role-color').value;

  if (!name) {
    alert('Role name is required');
    return;
  }

  try {
    const res = await fetch('/api/roles', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ name, description, color })
    });

    if (!res.ok) {
      const err = await res.json();
      alert(err.error || 'Failed to create role');
      return;
    }

    document.getElementById('new-role-name').value = '';
    document.getElementById('new-role-desc').value = '';
    document.getElementById('new-role-color').value = '#4f46e5';

    await fetchRoles();
    renderRolesList();
    renderStats();
  } catch (err) {
    alert('Network error');
  }
}

async function deleteRole(id, name) {
  if (!confirm(`Remove role "${name}"? Members with this role will have it unassigned.`)) return;
  try {
    const res = await fetch(`/api/roles/${id}`, {
      method: 'DELETE',
      credentials: 'include'
    });
    if (res.ok) {
      await fetchRoles();
      await fetchMembers(); // refresh in case any member had this role
      renderRolesList();
      renderStats();
    } else {
      const err = await res.json();
      alert(err.error || 'Failed to delete role');
    }
  } catch (err) {
    alert('Network error');
  }
}

// ─── Utils ─────────────────────────────────────────────────────────────────────

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str || '';
  return div.innerHTML;
}

// ─── Expose globals needed by auth.js and HTML ─────────────────────────────────

window.loadTeamMembers = loadTeamMembers;
window.loadWorkloadData = loadWorkloadData;
window.openMemberModal = openMemberModal;
window.closeMemberModal = closeMemberModal;
window.openEditMember = openEditMember;
window.saveMember = saveMember;
window.toggleStatus = toggleStatus;
window.openDeleteModal = openDeleteModal;
window.closeDeleteModal = closeDeleteModal;
window.confirmDelete = confirmDelete;
window.openRolesModal = openRolesModal;
window.closeRolesModal = closeRolesModal;
window.createRole = createRole;
window.deleteRole = deleteRole;
window.renderMembers = renderMembers;
window.loadPendingJoinRequests = loadPendingJoinRequests;
window.decideJoinRequest = decideJoinRequest;