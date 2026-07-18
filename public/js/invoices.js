// public/js/invoices.js
// Invoices list + Invoice Designer (design/preview an invoice before saving it)

let allInvoices = [];
let allClientsCache = [];
let customItemCounter = 0;
let editingDraftId = null; // set when re-opening an existing draft for edits

// ── List page ─────────────────────────────────────────────────────────────────

async function loadInvoices() {
  const status = document.getElementById('status-filter').value;
  const res = await fetch('/api/invoices' + (status ? `?status=${status}` : ''));
  allInvoices = await res.json();

  document.getElementById('invoice-count').textContent =
    `${allInvoices.length} invoice${allInvoices.length !== 1 ? 's' : ''}`;

  const container = document.getElementById('invoices-list');
  if (allInvoices.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <div class="empty-state-icon">🧾</div>
        <h3>No invoices yet</h3>
        <p>Click "New Invoice" to design your first one.</p>
      </div>
    `;
    return;
  }

  container.innerHTML = allInvoices.map(invoiceRowHtml).join('');
}

function invoiceRowHtml(inv) {
  return `
    <div class="invoice-row" onclick="openView(${inv.id})">
      <div class="invoice-row-left">
        <span class="invoice-number">${escapeHtml(inv.invoice_number)}</span>
        <span class="invoice-client">${escapeHtml(inv.client_name || 'Unknown client')}</span>
        <span class="invoice-dates">${formatDate(inv.issue_date)} → ${formatDate(inv.due_date)}</span>
        <span class="badge ${inv.status}">${inv.status}</span>
      </div>
      <div class="invoice-total">${formatCurrency(inv.total)}</div>
    </div>
  `;
}

function escapeHtml(str) {
  if (str == null) return '';
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

// ── Designer ──────────────────────────────────────────────────────────────────

async function openDesigner() {
  editingDraftId = null;
  document.getElementById('d-client').innerHTML = '<option value="">Select a client…</option>';
  document.getElementById('d-billable-items').innerHTML = '';
  document.getElementById('d-billable-section').style.display = 'none';
  document.getElementById('d-custom-items').innerHTML = '';
  document.getElementById('d-notes').value = '';
  document.getElementById('d-tax-rate').value = 18;
  document.getElementById('d-error').style.display = 'none';
  customItemCounter = 0;

  const today = new Date().toISOString().split('T')[0];
  const in30 = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
  document.getElementById('d-issue-date').value = today;
  document.getElementById('d-due-date').value = in30;

  if (allClientsCache.length === 0) {
    const res = await fetch('/api/clients');
    allClientsCache = await res.json();
  }
  const sel = document.getElementById('d-client');
  allClientsCache.forEach(c => {
    const opt = document.createElement('option');
    opt.value = c.id;
    opt.textContent = c.company ? `${c.name} (${c.company})` : c.name;
    sel.appendChild(opt);
  });

  document.getElementById('designer-modal').classList.add('active', 'open');
  refreshPreview();
}

function closeDesigner() {
  document.getElementById('designer-modal').classList.remove('active', 'open');
}

async function onClientChange() {
  const clientId = document.getElementById('d-client').value;
  const section = document.getElementById('d-billable-section');
  const container = document.getElementById('d-billable-items');

  if (!clientId) {
    section.style.display = 'none';
    container.innerHTML = '';
    refreshPreview();
    return;
  }

  const res = await fetch(`/api/invoices/billable-items/${clientId}`);
  const items = await res.json();

  if (items.length === 0) {
    section.style.display = 'block';
    container.innerHTML = '<p style="color: var(--gray-500); font-size: 13px; margin: 4px 0;">No unbilled work items for this client — add a custom line item below.</p>';
  } else {
    section.style.display = 'block';
    container.innerHTML = items.map(item => `
      <div class="billable-item">
        <input type="checkbox" data-item-id="${item.id}" onchange="refreshPreview()" />
        <label>
          <span>${escapeHtml(item.title)}</span>
          <strong>${formatCurrency(item.amount)}</strong>
        </label>
      </div>
    `).join('');
  }

  refreshPreview();
}

function addCustomItem() {
  const id = `ci-${++customItemCounter}`;
  const container = document.getElementById('d-custom-items');
  const row = document.createElement('div');
  row.className = 'custom-item-row';
  row.id = id;
  row.innerHTML = `
    <input type="text" placeholder="Description" oninput="refreshPreview()" />
    <input type="number" placeholder="Amount" min="0" step="0.01" oninput="refreshPreview()" />
    <button type="button" onclick="document.getElementById('${id}').remove(); refreshPreview();">✕</button>
  `;
  container.appendChild(row);
  refreshPreview();
}

function collectCustomItems() {
  return Array.from(document.querySelectorAll('.custom-item-row')).map(row => {
    const inputs = row.querySelectorAll('input');
    return {
      title: inputs[0].value.trim() || 'Item',
      amount: parseFloat(inputs[1].value) || 0
    };
  }).filter(ci => ci.amount > 0 || ci.title !== 'Item');
}

function collectSelectedWorkItemIds() {
  return Array.from(document.querySelectorAll('#d-billable-items input[type="checkbox"]:checked'))
    .map(cb => parseInt(cb.dataset.itemId));
}

let previewTimer = null;
function refreshPreview() {
  clearTimeout(previewTimer);
  previewTimer = setTimeout(doRefreshPreview, 250); // debounce while typing
}

async function doRefreshPreview() {
  const clientId = document.getElementById('d-client').value;
  const frame = document.getElementById('d-preview-frame');
  const errorBox = document.getElementById('d-error');
  errorBox.style.display = 'none';

  if (!clientId) {
    frame.srcdoc = `<div style="font-family: sans-serif; color: #999; padding: 40px; text-align: center;">Select a client to see the invoice preview</div>`;
    return;
  }

  const payload = {
    clientId,
    workItemIds: collectSelectedWorkItemIds(),
    customItems: collectCustomItems(),
    taxRate: (parseFloat(document.getElementById('d-tax-rate').value) || 0) / 100,
    notes: document.getElementById('d-notes').value,
    issueDate: document.getElementById('d-issue-date').value,
    dueDate: document.getElementById('d-due-date').value
  };

  try {
    const res = await fetch('/api/invoices/preview', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data = await res.json();
    if (!res.ok) {
      errorBox.textContent = data.error || 'Could not generate preview';
      errorBox.style.display = 'block';
      return;
    }
    frame.srcdoc = data.html;
  } catch (err) {
    errorBox.textContent = 'Network error while generating preview';
    errorBox.style.display = 'block';
  }
}

async function saveDraft() {
  const clientId = document.getElementById('d-client').value;
  const errorBox = document.getElementById('d-error');
  errorBox.style.display = 'none';

  if (!clientId) {
    errorBox.textContent = 'Please select a client';
    errorBox.style.display = 'block';
    return;
  }

  const payload = {
    clientId,
    workItemIds: collectSelectedWorkItemIds(),
    customItems: collectCustomItems(),
    taxRate: (parseFloat(document.getElementById('d-tax-rate').value) || 0) / 100,
    notes: document.getElementById('d-notes').value,
    issueDate: document.getElementById('d-issue-date').value,
    dueDate: document.getElementById('d-due-date').value
  };

  const saveBtn = document.getElementById('d-save-btn');
  saveBtn.disabled = true;
  saveBtn.textContent = 'Saving…';

  try {
    const url = editingDraftId ? `/api/invoices/${editingDraftId}` : '/api/invoices';
    const method = editingDraftId ? 'PUT' : 'POST';
    const res = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data = await res.json();
    if (!res.ok) {
      errorBox.textContent = data.error || 'Could not save invoice';
      errorBox.style.display = 'block';
      return;
    }
    closeDesigner();
    loadInvoices();
  } catch (err) {
    errorBox.textContent = 'Network error while saving';
    errorBox.style.display = 'block';
  } finally {
    saveBtn.disabled = false;
    saveBtn.textContent = '💾 Save as Draft';
  }
}

// ── View / send / pay an existing invoice ──────────────────────────────────────

async function openView(id) {
  const inv = allInvoices.find(i => i.id === id);
  if (!inv) return;

  document.getElementById('view-title').textContent = `${inv.invoice_number} — ${inv.client_name || ''}`;
  document.getElementById('view-frame').src = `/api/invoices/${id}/html`;

  const actions = document.getElementById('view-actions');
  actions.innerHTML = '';

  if (inv.status === 'draft') {
    actions.innerHTML = `
      <button class="btn outline" onclick="editDraft(${id})">✏️ Edit</button>
      <button class="btn" onclick="sendInvoice(${id})">📤 Mark as Sent</button>
    `;
  } else if (inv.status === 'sent' || inv.status === 'overdue') {
    actions.innerHTML = `<button class="btn" onclick="markPaid(${id})">✅ Mark as Paid</button>`;
  }

  document.getElementById('view-modal').classList.add('active', 'open');
}

function closeView() {
  document.getElementById('view-modal').classList.remove('active', 'open');
  document.getElementById('view-frame').src = '';
}

async function editDraft(id) {
  closeView();
  const res = await fetch(`/api/invoices/${id}`);
  const inv = await res.json();
  editingDraftId = id;

  await openDesigner(); // resets fields + loads client list
  document.getElementById('d-client').value = inv.client_id;
  await onClientChange();

  // Re-check the work items that belong to this draft
  (inv.work_item_ids || []).forEach(wid => {
    const cb = document.querySelector(`#d-billable-items input[data-item-id="${wid}"]`);
    if (cb) cb.checked = true;
  });

  // Repopulate custom items
  document.getElementById('d-custom-items').innerHTML = '';
  (inv.custom_items || []).forEach(ci => {
    addCustomItem();
    const rows = document.querySelectorAll('.custom-item-row');
    const last = rows[rows.length - 1];
    const inputs = last.querySelectorAll('input');
    inputs[0].value = ci.title;
    inputs[1].value = ci.amount;
  });

  document.getElementById('d-tax-rate').value = Math.round((inv.tax_rate ?? 0.18) * 100);
  document.getElementById('d-notes').value = inv.notes || '';
  document.getElementById('d-issue-date').value = inv.issue_date?.split('T')[0] || '';
  document.getElementById('d-due-date').value = inv.due_date?.split('T')[0] || '';

  refreshPreview();
}

async function sendInvoice(id) {
  if (!confirm('Send this invoice? Once sent, line items and totals can no longer be edited.')) return;
  await fetch(`/api/invoices/${id}/send`, { method: 'POST' });
  closeView();
  loadInvoices();
}

async function markPaid(id) {
  if (!confirm('Mark this invoice as paid?')) return;
  await fetch(`/api/invoices/${id}/pay`, { method: 'POST' });
  closeView();
  loadInvoices();
}

// ── Init ──────────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', loadInvoices);