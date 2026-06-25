// public/js/clients.js
// Plain JavaScript — no build step, no framework. Runs directly in the browser.

let clients = [];     // holds the current list of clients in memory
let deleteTargetId = null;

// ---- Load data ----
async function loadClients() {
  const res = await fetch('/api/clients');
  clients = await res.json();
  renderClients();
}

function renderClients() {
  document.getElementById('client-count').textContent =
    `${clients.length} client${clients.length !== 1 ? 's' : ''}`;

  const container = document.getElementById('clients-list');

  if (clients.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <p>No clients yet</p>
        <button class="btn" onclick="openCreateModal()">+ Add your first client</button>
      </div>`;
    return;
  }

  container.innerHTML = `<div class="grid cols-3">${clients.map(clientCardHtml).join('')}</div>`;
}

function clientCardHtml(c) {
  return `
    <div class="card">
      <div style="display:flex; justify-content:space-between; align-items:flex-start;">
        <div>
          <h2>${escapeHtml(c.name)}</h2>
          ${c.company ? `<p class="muted">${escapeHtml(c.company)}</p>` : ''}
        </div>
        <div>
          <button class="btn outline" style="padding:4px 8px;" onclick="openEditModal(${c.id})">Edit</button>
          <button class="btn danger" style="padding:4px 8px;" onclick="openDeleteModal(${c.id})">Delete</button>
        </div>
      </div>
      <div style="font-size:13px; color:#6b7280; margin-top:10px; line-height:1.6;">
        ${c.email ? `<div>✉ ${escapeHtml(c.email)}</div>` : ''}
        ${c.phone ? `<div>☎ ${escapeHtml(c.phone)}</div>` : ''}
        ${c.address ? `<div>📍 ${escapeHtml(c.address)}</div>` : ''}
      </div>
      <div style="margin-top:12px; padding-top:10px; border-top:1px solid #f3f4f6;">
        <a class="muted-link" href="/share/${c.slug}" target="_blank">Share Page →</a>
      </div>
    </div>`;
}

// Basic protection against HTML injection when rendering client-entered text
function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

// ---- Create / Edit modal ----
function openCreateModal() {
  document.getElementById('modal-title').textContent = 'Add Client';
  document.getElementById('save-btn').textContent = 'Create';
  document.getElementById('edit-id').value = '';
  ['f-name', 'f-company', 'f-email', 'f-phone', 'f-address', 'f-notes'].forEach(id => {
    document.getElementById(id).value = '';
  });
  document.getElementById('client-modal').classList.add('open');
}

function openEditModal(id) {
  const c = clients.find(x => x.id === id);
  if (!c) return;
  document.getElementById('modal-title').textContent = 'Edit Client';
  document.getElementById('save-btn').textContent = 'Update';
  document.getElementById('edit-id').value = c.id;
  document.getElementById('f-name').value = c.name || '';
  document.getElementById('f-company').value = c.company || '';
  document.getElementById('f-email').value = c.email || '';
  document.getElementById('f-phone').value = c.phone || '';
  document.getElementById('f-address').value = c.address || '';
  document.getElementById('f-notes').value = c.notes || '';
  document.getElementById('client-modal').classList.add('open');
}

function closeModal() {
  document.getElementById('client-modal').classList.remove('open');
}

async function saveClient() {
  const id = document.getElementById('edit-id').value;
  const body = {
    name: document.getElementById('f-name').value.trim(),
    company: document.getElementById('f-company').value.trim(),
    email: document.getElementById('f-email').value.trim(),
    phone: document.getElementById('f-phone').value.trim(),
    address: document.getElementById('f-address').value.trim(),
    notes: document.getElementById('f-notes').value.trim(),
  };

  if (!body.name) {
    alert('Name is required');
    return;
  }

  const url = id ? `/api/clients/${id}` : '/api/clients';
  const method = id ? 'PUT' : 'POST';

  await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

  closeModal();
  await loadClients();
}

// ---- Delete ----
function openDeleteModal(id) {
  deleteTargetId = id;
  document.getElementById('delete-modal').classList.add('open');
}

function closeDeleteModal() {
  deleteTargetId = null;
  document.getElementById('delete-modal').classList.remove('open');
}

async function confirmDelete() {
  if (!deleteTargetId) return;
  await fetch(`/api/clients/${deleteTargetId}`, { method: 'DELETE' });
  closeDeleteModal();
  await loadClients();
}

// ---- Init ----
loadClients();
