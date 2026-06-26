// public/js/clients.js
// Plain JavaScript for Clients page - CRUD operations

let allClients = [];
let deleteId = null;
let searchTerm = '';

// Load clients on page load
async function loadClients() {
  const res = await fetch('/api/clients');
  allClients = await res.json();
  
  document.getElementById('client-count').textContent = `${allClients.length} client${allClients.length !== 1 ? 's' : ''}`;
  
  // Filter clients based on search
  let filteredClients = allClients;
  if (searchTerm.trim()) {
    const term = searchTerm.toLowerCase().trim();
    filteredClients = allClients.filter(c => 
      c.name.toLowerCase().includes(term) ||
      (c.company && c.company.toLowerCase().includes(term)) ||
      (c.email && c.email.toLowerCase().includes(term)) ||
      (c.phone && c.phone.includes(term))
    );
  }
  
  const container = document.getElementById('clients-list');
  
  if (filteredClients.length === 0) {
    container.innerHTML = `
      <div class="empty-state" style="grid-column: 1 / -1;">
        <div class="empty-state-icon">👤</div>
        <h3>${allClients.length === 0 ? 'No clients yet' : 'No clients match your search'}</h3>
        <p>${allClients.length === 0 ? 'Click "Add Client" to get started.' : 'Try adjusting your search term.'}</p>
      </div>
    `;
    return;
  }
  
  container.innerHTML = filteredClients.map(clientCardHtml).join('');
}

function clientCardHtml(client) {
  // Get task count for this client (if available)
  const taskCount = client.taskCount || 0;
  
  return `
    <div class="client-card">
      <div class="client-card-header">
        <h3>${escapeHtml(client.name)}</h3>
        <span class="badge ${taskCount > 0 ? 'info' : 'neutral'}">${taskCount} task${taskCount !== 1 ? 's' : ''}</span>
      </div>
      ${client.company ? `<div class="client-company">🏢 ${escapeHtml(client.company)}</div>` : ''}
      <div class="client-info">
        ${client.email ? `<div class="client-info-item">✉️ ${escapeHtml(client.email)}</div>` : ''}
        ${client.phone ? `<div class="client-info-item">📱 ${escapeHtml(client.phone)}</div>` : ''}
        ${client.address ? `<div class="client-info-item">📍 ${escapeHtml(client.address)}</div>` : ''}
      </div>
      <div class="client-card-actions">
        <a href="/share/${escapeHtml(client.slug)}" target="_blank" class="btn small outline">🔗 Portal</a>
        <button class="btn small outline" onclick="editClient(${client.id})">✏️ Edit</button>
        <button class="btn small danger" onclick="openDeleteModal(${client.id})">🗑️ Delete</button>
      </div>
    </div>
  `;
}

// Search function
function searchClients() {
  const input = document.getElementById('search-input');
  searchTerm = input ? input.value : '';
}

// Modal functions
function openCreateModal() {
  document.getElementById('modal-title').textContent = 'Add Client';
  document.getElementById('edit-id').value = '';
  document.getElementById('save-btn').textContent = 'Create Client';
  
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
  document.getElementById('save-btn').textContent = 'Update Client';
  
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

// Initialize - loadClients() is now called from auth.js after authentication check
document.addEventListener('DOMContentLoaded', () => {
  
  // Set up search with debounce
  const searchInput = document.getElementById('search-input');
  if (searchInput) {
    let timeout;
    searchInput.addEventListener('input', () => {
      clearTimeout(timeout);
      timeout = setTimeout(searchClients, 300);
    });
  }
});
