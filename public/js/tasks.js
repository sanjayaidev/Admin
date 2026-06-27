// public/js/tasks.js
// Tasks page — role-scoped view + assigned_to support

let allTasks = [];
let allClients = [];
let allMembers = [];
let deleteId = null;
let isAdmin = false;
// ─── Entry point called by auth.js ────────────────────────────────────────────

async function loadTasks() {
  // Get current user from auth
  const authResult = await window.checkAuth();
  if (!authResult.authenticated) return;

  window.currentUser = authResult.user;
  isAdmin = window.currentUser.role === 'admin';

  // Show Add Task button only for admins
  if (isAdmin) {
    document.getElementById('add-task-btn').style.display = 'inline-flex';
    document.getElementById('filter-assigned').style.display = 'block';
  }

  await Promise.all([
    loadClients(),
    isAdmin ? loadTeamMembersForAssign() : Promise.resolve()
  ]);

  await fetchTasks();
}

async function fetchTasks() {
  try {
    // API already scopes results server-side:
    // admin → all tasks
    // team member → only their assigned tasks
    const res = await fetch('/api/work-items', { credentials: 'include' });
    if (!res.ok) throw new Error('Failed to fetch tasks');
    allTasks = await res.json();
    populateClientFilters();
    render();
  } catch (err) {
    document.getElementById('tasks-list').innerHTML =
      '<div class="empty-state"><p>Failed to load tasks.</p></div>';
  }
}

async function loadClients() {
  try {
    // API already scopes: admin → all clients, team → only clients with assigned tasks
    const res = await fetch('/api/clients', { credentials: 'include' });
    if (!res.ok) throw new Error();
    allClients = await res.json();
  } catch (err) {
    allClients = [];
  }
}

async function loadTeamMembersForAssign() {
  try {
    const res = await fetch('/api/team/members', { credentials: 'include' });
    if (!res.ok) throw new Error();
    allMembers = await res.json();
    populateMemberDropdowns();
  } catch (err) {
    allMembers = [];
  }
}

// ─── Populate dropdowns ────────────────────────────────────────────────────────

function populateClientFilters() {
  const filterSelect = document.getElementById('filter-client');
  const formSelect = document.getElementById('f-client');

  filterSelect.innerHTML = '<option value="">All Clients</option>';
  formSelect.innerHTML = '';

  allClients.forEach(c => {
    const opt = `<option value="${c.id}">${escapeHtml(c.name)}</option>`;
    filterSelect.innerHTML += opt;
    formSelect.innerHTML += opt;
  });
}

function populateMemberDropdowns() {
  // Filter dropdown (admin-only, already visible)
  const filterSelect = document.getElementById('filter-assigned');
  filterSelect.innerHTML = '<option value="">All Members</option>';

  // Form assign dropdown
  const formSelect = document.getElementById('f-assigned-to');
  formSelect.innerHTML = '<option value="">— Unassigned —</option>';

  const activeMembers = allMembers.filter(m => m.is_active);
  activeMembers.forEach(m => {
    const label = m.custom_role
      ? `${escapeHtml(m.full_name)} (${escapeHtml(m.custom_role)})`
      : escapeHtml(m.full_name);
    const opt = `<option value="${m.id}">${label}</option>`;
    filterSelect.innerHTML += opt;
    formSelect.innerHTML += opt;
  });

  // Show assign field in modal for admins
  document.getElementById('assign-field').style.display = isAdmin ? 'block' : 'none';
}

// ─── Filtering + Render ────────────────────────────────────────────────────────

function getFilteredTasks() {
  const clientId = document.getElementById('filter-client').value;
  const status = document.getElementById('filter-status').value;
  const payment = document.getElementById('filter-payment').value;
  const assignedTo = isAdmin ? document.getElementById('filter-assigned').value : '';

  return allTasks.filter(t => {
    if (clientId && t.client_id != clientId) return false;
    if (status && t.status !== status) return false;
    if (payment && t.payment_status !== payment) return false;
    if (assignedTo && t.assigned_to != assignedTo) return false;
    return true;
  });
}

function render() {
  const tasks = getFilteredTasks();
  document.getElementById('task-count').textContent =
    `${tasks.length} task${tasks.length !== 1 ? 's' : ''}`;

  if (tasks.length === 0) {
    document.getElementById('tasks-list').innerHTML =
      '<div class="empty-state"><p>No tasks found</p></div>';
    return;
  }

  document.getElementById('tasks-list').innerHTML = `
    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Task</th>
            <th>Client</th>
            <th>Status</th>
            <th>Priority</th>
            <th>Due Date</th>
            <th>Amount</th>
            <th>Payment</th>
            ${isAdmin ? '<th>Assigned To</th>' : ''}
            ${isAdmin ? '<th>Actions</th>' : ''}
          </tr>
        </thead>
        <tbody>
          ${tasks.map(taskRowHtml).join('')}
        </tbody>
      </table>
    </div>
  `;
}

function taskRowHtml(task) {
  const overdueStyle = isOverdue(task) ? 'style="color:#dc2626; font-weight:600;"' : '';
  const assignedName = task.assigned_name || '—';

  return `
    <tr>
      <td>${escapeHtml(task.title)}</td>
      <td>${escapeHtml(task.client_name || '—')}</td>
      <td><span class="badge ${task.status}">${task.status}</span></td>
      <td><span class="badge ${task.priority}">${task.priority}</span></td>
      <td ${overdueStyle}>${formatDate(task.due_date)}</td>
      <td>${formatCurrency(task.amount)}</td>
      <td><span class="badge ${task.payment_status}">${task.payment_status}</span></td>
      ${isAdmin ? `<td>${escapeHtml(assignedName)}</td>` : ''}
      ${isAdmin ? `
        <td>
          <button class="btn outline" style="padding:4px 8px; font-size:12px;" onclick="editTask(${task.id})">Edit</button>
          <button class="btn danger" style="padding:4px 8px; font-size:12px;" onclick="openDeleteModal(${task.id})">Delete</button>
        </td>
      ` : ''}
    </tr>
  `;
}

function clearFilters() {
  document.getElementById('filter-client').value = '';
  document.getElementById('filter-status').value = '';
  document.getElementById('filter-payment').value = '';
  if (isAdmin) document.getElementById('filter-assigned').value = '';
  render();
}

// ─── Modal: Create / Edit ──────────────────────────────────────────────────────

function openCreateModal() {
  if (!isAdmin) return; // safety guard
  document.getElementById('modal-title').textContent = 'Add Task';
  document.getElementById('edit-id').value = '';
  document.getElementById('save-btn').textContent = 'Create';

  document.getElementById('f-client').value = allClients[0]?.id || '';
  document.getElementById('f-title').value = '';
  document.getElementById('f-description').value = '';
  document.getElementById('f-status').value = 'pending';
  document.getElementById('f-priority').value = 'medium';
  document.getElementById('f-due-date').value = '';
  document.getElementById('f-amount').value = '';
  document.getElementById('f-payment-status').value = 'unpaid';
  document.getElementById('f-assigned-to').value = '';

  document.getElementById('task-modal').classList.add('open');
}

function editTask(id) {
  if (!isAdmin) return;
  const task = allTasks.find(t => t.id == id);
  if (!task) return;

  document.getElementById('modal-title').textContent = 'Edit Task';
  document.getElementById('edit-id').value = task.id;
  document.getElementById('save-btn').textContent = 'Update';

  document.getElementById('f-client').value = task.client_id;
  document.getElementById('f-title').value = task.title;
  document.getElementById('f-description').value = task.description || '';
  document.getElementById('f-status').value = task.status;
  document.getElementById('f-priority').value = task.priority;
  document.getElementById('f-due-date').value = task.due_date ? task.due_date.split('T')[0] : '';
  document.getElementById('f-amount').value = task.amount || '';
  document.getElementById('f-payment-status').value = task.payment_status;
  document.getElementById('f-assigned-to').value = task.assigned_to || '';

  document.getElementById('task-modal').classList.add('open');
}

function closeModal() {
  document.getElementById('task-modal').classList.remove('open');
}

async function saveTask() {
  const id = document.getElementById('edit-id').value;
  const clientId = document.getElementById('f-client').value;
  const title = document.getElementById('f-title').value.trim();

  if (!clientId || !title) {
    alert('Please fill in required fields (Client and Title)');
    return;
  }

  const assignedTo = document.getElementById('f-assigned-to').value;

  const data = {
    client_id: parseInt(clientId),
    title,
    description: document.getElementById('f-description').value.trim(),
    status: document.getElementById('f-status').value,
    priority: document.getElementById('f-priority').value,
    due_date: document.getElementById('f-due-date').value || null,
    amount: document.getElementById('f-amount').value
      ? parseFloat(document.getElementById('f-amount').value)
      : null,
    payment_status: document.getElementById('f-payment-status').value,
    assigned_to: assignedTo ? parseInt(assignedTo) : null
  };

  try {
    const url = id ? `/api/work-items/${id}` : '/api/work-items';
    const method = id ? 'PUT' : 'POST';

    const res = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify(data)
    });

    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error || 'Failed to save task');
    }

    closeModal();
    await fetchTasks();
  } catch (err) {
    alert('Error saving task: ' + err.message);
  }
}

// ─── Modal: Delete ─────────────────────────────────────────────────────────────

function openDeleteModal(id) {
  deleteId = id;
  document.getElementById('delete-modal').classList.add('open');
}

function closeDeleteModal() {
  deleteId = null;
  document.getElementById('delete-modal').classList.remove('open');
}

async function confirmDelete() {
  if (!deleteId) return;
  try {
    const res = await fetch(`/api/work-items/${deleteId}`, {
      method: 'DELETE',
      credentials: 'include'
    });
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error || 'Failed to delete task');
    }
    closeDeleteModal();
    await fetchTasks();
  } catch (err) {
    alert('Error deleting task: ' + err.message);
  }
}

// ─── Utils ─────────────────────────────────────────────────────────────────────

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str || '';
  return div.innerHTML;
}

function isOverdue(task) {
  return (
    task.due_date &&
    task.status !== 'completed' &&
    new Date(task.due_date) < new Date()
  );
}

function formatDate(dateStr) {
  if (!dateStr) return '—';
  return new Date(dateStr).toLocaleDateString('en-IN', {
    day: 'numeric', month: 'short', year: 'numeric'
  });
}

function formatCurrency(amount) {
  if (!amount) return '—';
  return '₹' + parseFloat(amount).toLocaleString('en-IN');
}