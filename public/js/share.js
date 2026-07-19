// public/js/share.js
// Public, read-only client dashboard. Reachable only via a high-entropy
// share token issued by an admin (see lib/shareLinks.js) — there is no
// login here, and no route on this page can mutate any data.

let clientData = null;

// Token comes from the URL path: /share/:token
const pathParts = window.location.pathname.split('/');
const token = pathParts[pathParts.length - 1];

function buildQuery() {
  const from = document.getElementById('filter-from').value;
  const to = document.getElementById('filter-to').value;
  const status = document.getElementById('filter-status').value;

  const params = new URLSearchParams();
  if (from) params.set('start_date', from);
  if (to) params.set('end_date', to);
  if (status) params.set('status', status);
  const qs = params.toString();
  return qs ? `?${qs}` : '';
}

// Every filter change re-fetches from the server with the new date range /
// status as real query parameters — the server (not this script) decides
// which rows come back, so there's no way to bypass the filter by reading
// network responses.
async function loadShareData() {
  try {
    const res = await fetch(`/api/public/share/${token}${buildQuery()}`);

    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      document.getElementById('client-header').innerHTML =
        `<h1>Link unavailable</h1><p>${escapeHtml(body.error || 'This share link is invalid, expired, or has been revoked.')}</p>`;
      document.getElementById('payment-summary').style.display = 'none';
      document.querySelector('.filter-section').style.display = 'none';
      document.getElementById('tasks-body').innerHTML =
        '<tr><td colspan="6" style="text-align:center; padding:40px;">No data available</td></tr>';
      return;
    }

    const data = await res.json();
    clientData = data.client;

    document.title = `${clientData.name} · ClientPM`;
    document.getElementById('client-header').innerHTML = `
      <h1>${escapeHtml(clientData.name)}</h1>
      <p>${escapeHtml(clientData.company || 'Your project overview and payment summary')}</p>
    `;

    document.getElementById('total-amount').textContent = formatCurrency(data.summary.total);
    document.getElementById('paid-amount').textContent = formatCurrency(data.summary.paid);
    document.getElementById('partial-amount').textContent = formatCurrency(data.summary.partial);
    document.getElementById('unpaid-amount').textContent = formatCurrency(data.summary.unpaid);

    renderTasks(data.workItems);
  } catch (error) {
    console.error('Error loading share data:', error);
    document.getElementById('client-header').innerHTML = '<h1>Error</h1><p>Failed to load client data.</p>';
  }
}

function renderTasks(tasks) {
  const tbody = document.getElementById('tasks-body');

  if (!tasks || tasks.length === 0) {
    tbody.innerHTML = '<tr><td colspan="6" style="text-align:center; padding:40px; color:#9ca3af;">No tasks found for this range</td></tr>';
    return;
  }

  tbody.innerHTML = tasks.map(task => {
    const overdueClass = isOverdue(task) ? 'style="color:#dc2626; font-weight:600;"' : '';
    return `
      <tr>
        <td>${escapeHtml(task.title)}${task.description ? `<br/><small style="color:#6b7280;">${escapeHtml(task.description.substring(0, 50))}${task.description.length > 50 ? '...' : ''}</small>` : ''}</td>
        <td><span class="badge ${task.status}">${task.status}</span></td>
        <td><span class="badge ${task.priority}">${task.priority}</span></td>
        <td ${overdueClass}>${formatDate(task.due_date)}</td>
        <td>${formatCurrency(task.amount)}</td>
        <td><span class="badge ${task.payment_status}">${task.payment_status}</span></td>
      </tr>
    `;
  }).join('');
}

// Re-fetch from the server with the new filters — this IS the filter, not a
// client-side re-render of already-fetched data.
function applyFilters() {
  loadShareData();
}

function clearFilters() {
  document.getElementById('filter-from').value = '';
  document.getElementById('filter-to').value = '';
  document.getElementById('filter-status').value = '';
  loadShareData();
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str || '';
  return div.innerHTML;
}

// Initialize
loadShareData();
