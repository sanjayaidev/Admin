// public/js/clients.js
// Plain JavaScript for Clients page - CRUD operations

let allClients = [];
let deleteId = null;

// Load clients on page load
async function loadClients() {
  const res = await fetch('/api/clients');
  allClients = await res.json();
  
  document.getElementById('client-count').textContent = `${allClients.length} client${allClients.length !== 1 ? 's' : ''}`;
  
  if (allClients.length === 0) {
    document.getElementById('clients-list').innerHTML = `
      <div class="empty-state">
        <p>No clients yet. Click "Add Client" to get started.</p>
      </div>
    `;
    return;
  }
  
  document.getElementById('clients-list').innerHTML = `
    <div class="grid cols-3">
      ${allClients.map(clientCardHtml).join('')}
    </div>
  `;
}

function clientCardHtml(client) {
  return `
    <div class="card">
      <h2>${escapeHtml(client.name)}</h2>
      <div class="muted">${escapeHtml(client.company || 'No company')}</div>
      <div style="margin-top:12px; font-size:13px;">
        ${client.email ? `<div>📧 ${escapeHtml(client.email)}</div>` : ''}
        ${client.phone ? `<div>📱 ${escapeHtml(client.phone)}</div>` : ''}
        ${client.address ? `<div>📍 ${escapeHtml(client.address)}</div>` : ''}
      </div>
      <div style="margin-top:16px; display:flex; gap:8px;">
        <a href="/share/${escapeHtml(client.slug)}" target="_blank" class="muted-link">View Portal</a>
        <button class="btn outline" style="padding:4px 8px; font-size:12px;" onclick="editClient(${client.id})">Edit</button>
        <button class="btn danger" style="padding:4px 8px; font-size:12px;" onclick="openDeleteModal(${client.id})">Delete</button>
      </div>
    </div>
  `;
}

// Modal functions
function openCreateModal() {
  document.getElementById('modal-title').textContent = 'Add Client';
  document.getElementById('edit-id').value = '';
  document.getElementById('save-btn').textContent = 'Create';
  
  // Reset form
  document.getElementById('f-name').value = '';
  document.getElementById('f-company').value = '';
  document.getElementById('f-email').value = '';
  document.getElementById('f-phone').value = '';
  document.getElementById('f-address').value = '';
  document.getElementById('f-notes').value = '';
  
  document.getElementById('client-modal').classList.add('open');
}

function editClient(id) {
  const client = allClients.find(c => c.id == id);
  if (!client) return;
  
  document.getElementById('modal-title').textContent = 'Edit Client';
  document.getElementById('edit-id').value = client.id;
  document.getElementById('save-btn').textContent = 'Update';
  
  document.getElementById('f-name').value = client.name;
  document.getElementById('f-company').value = client.company || '';
  document.getElementById('f-email').value = client.email || '';
  document.getElementById('f-phone').value = client.phone || '';
  document.getElementById('f-address').value = client.address || '';
  document.getElementById('f-notes').value = client.notes || '';
  
  document.getElementById('client-modal').classList.add('open');
}

function closeModal() {
  document.getElementById('client-modal').classList.remove('open');
}

async function saveClient() {
  const id = document.getElementById('edit-id').value;
  const name = document.getElementById('f-name').value.trim();
  
  if (!name) {
    alert('Name is required');
    return;
  }
  
  const data = {
    name: name,
    company: document.getElementById('f-company').value.trim(),
    email: document.getElementById('f-email').value.trim(),
    phone: document.getElementById('f-phone').value.trim(),
    address: document.getElementById('f-address').value.trim(),
    notes: document.getElementById('f-notes').value.trim()
  };
  
  try {
    const url = id ? `/api/clients/${id}` : '/api/clients';
    const method = id ? 'PUT' : 'POST';
    
    const res = await fetch(url, {
      method: method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    });
    
    if (!res.ok) {
      const error = await res.json();
      throw new Error(error.error || 'Failed to save client');
    }
    
    closeModal();
    await loadClients();
  } catch (error) {
    alert('Error saving client: ' + error.message);
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
    const res = await fetch(`/api/clients/${deleteId}`, {
      method: 'DELETE'
    });
    
    if (!res.ok) {
      const error = await res.json();
      throw new Error(error.error || 'Failed to delete client');
    }
    
    closeDeleteModal();
    await loadClients();
  } catch (error) {
    alert('Error deleting client: ' + error.message);
  }
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str || '';
  return div.innerHTML;
}

// Initialize
loadClients();
