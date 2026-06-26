// public/js/tasks.js
// Plain JavaScript for Tasks page - CRUD operations for work items

let allTasks = [];
let allClients = [];
let deleteId = null;

// Load data on page load
async function loadTasks() {
  await loadClients();
  
  const res = await fetch('/api/work-items');
  allTasks = await res.json();
  
  populateClientFilters();
  render();
}

async function loadClients() {
  const res = await fetch('/api/clients');
  allClients = await res.json();
}

function populateClientFilters() {
  const filterSelect = document.getElementById('filter-client');
  const formSelect = document.getElementById('f-client');
  
  // Clear existing options (keep first "All Clients" option)
  filterSelect.innerHTML = '<option value="">All Clients</option>';
  formSelect.innerHTML = '';
  
  allClients.forEach(client => {
    const option = `<option value="${client.id}">${escapeHtml(client.name)}</option>`;
    filterSelect.innerHTML += option;
    formSelect.innerHTML += option;
  });
}

function getFilteredTasks() {
  const clientId = document.getElementById('filter-client').value;
  const status = document.getElementById('filter-status').value;
  const paymentStatus = document.getElementById('filter-payment').value;
  
  return allTasks.filter(task => {
    if (clientId && task.client_id != clientId) return false;
    if (status && task.status !== status) return false;
    if (paymentStatus && task.payment_status !== paymentStatus) return false;
    return true;
  });
}

function render() {
  const tasks = getFilteredTasks();
  document.getElementById('task-count').textContent = `${tasks.length} task${tasks.length !== 1 ? 's' : ''}`;
  
  if (tasks.length === 0) {
    document.getElementById('tasks-list').innerHTML = `
      <div class="empty-state">
        <p>No tasks found</p>
      </div>
    `;
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
            <th>Actions</th>
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
  const overdueClass = isOverdue(task) ? 'style="color:#dc2626; font-weight:600;"' : '';
  return `
    <tr>
      <td>${escapeHtml(task.title)}</td>
      <td>${escapeHtml(task.client_name || '—')}</td>
      <td><span class="badge ${task.status}">${task.status}</span></td>
      <td><span class="badge ${task.priority}">${task.priority}</span></td>
      <td ${overdueClass}>${formatDate(task.due_date)}</td>
      <td>${formatCurrency(task.amount)}</td>
      <td><span class="badge ${task.payment_status}">${task.payment_status}</span></td>
      <td>
        <button class="btn outline" style="padding:4px 8px; font-size:12px;" onclick="editTask(${task.id})">Edit</button>
        <button class="btn danger" style="padding:4px 8px; font-size:12px;" onclick="openDeleteModal(${task.id})">Delete</button>
      </td>
    </tr>
  `;
}

function clearFilters() {
  document.getElementById('filter-client').value = '';
  document.getElementById('filter-status').value = '';
  document.getElementById('filter-payment').value = '';
  render();
}

// Modal functions
function openCreateModal() {
  document.getElementById('modal-title').textContent = 'Add Task';
  document.getElementById('edit-id').value = '';
  document.getElementById('save-btn').textContent = 'Create';
  
  // Reset form
  document.getElementById('f-client').value = allClients[0]?.id || '';
  document.getElementById('f-title').value = '';
  document.getElementById('f-description').value = '';
  document.getElementById('f-status').value = 'pending';
  document.getElementById('f-priority').value = 'medium';
  document.getElementById('f-due-date').value = '';
  document.getElementById('f-amount').value = '';
  document.getElementById('f-payment-status').value = 'unpaid';
  
  document.getElementById('task-modal').classList.add('open');
}

function editTask(id) {
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
  
  const data = {
    client_id: parseInt(clientId),
    title: title,
    description: document.getElementById('f-description').value.trim(),
    status: document.getElementById('f-status').value,
    priority: document.getElementById('f-priority').value,
    due_date: document.getElementById('f-due-date').value || null,
    amount: document.getElementById('f-amount').value ? parseFloat(document.getElementById('f-amount').value) : null,
    payment_status: document.getElementById('f-payment-status').value
  };
  
  try {
    const url = id ? `/api/work-items/${id}` : '/api/work-items';
    const method = id ? 'PUT' : 'POST';
    
    const res = await fetch(url, {
      method: method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    });
    
    if (!res.ok) {
      const error = await res.json();
      throw new Error(error.error || 'Failed to save task');
    }
    
    closeModal();
    await loadTasks();
  } catch (error) {
    alert('Error saving task: ' + error.message);
  }
}

// Delete functions
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
      method: 'DELETE'
    });
    
    if (!res.ok) {
      const error = await res.json();
      throw new Error(error.error || 'Failed to delete task');
    }
    
    closeDeleteModal();
    await loadTasks();
  } catch (error) {
    alert('Error deleting task: ' + error.message);
  }
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str || '';
  return div.innerHTML;
}

// Initialize - loadTasks() is now called from auth.js after authentication check
