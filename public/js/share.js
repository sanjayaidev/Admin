// public/js/share.js
// Public share page for clients to view their tasks and payment summary

let allTasks = [];
let clientData = null;

// Get slug from URL path
const pathParts = window.location.pathname.split('/');
const slug = pathParts[pathParts.length - 1];

async function loadShareData() {
  try {
    const res = await fetch(`/api/share/${slug}`);
    
    if (!res.ok) {
      if (res.status === 404) {
        document.getElementById('client-header').innerHTML = '<h1>Client Not Found</h1><p>The requested client portal does not exist.</p>';
        document.getElementById('tasks-body').innerHTML = '<tr><td colspan="6" style="text-align:center; padding:40px;">No data available</td></tr>';
        return;
      }
      throw new Error('Failed to load data');
    }
    
    const data = await res.json();
    clientData = data.client;
    allTasks = data.workItems;
    
    // Update page title and header
    document.title = `${clientData.name} · ClientPM`;
    document.getElementById('client-header').innerHTML = `
      <h1>${escapeHtml(clientData.name)}</h1>
      <p>${escapeHtml(clientData.company || 'Your project overview and payment summary')}</p>
    `;
    
    // Update payment summary
    document.getElementById('total-amount').textContent = formatCurrency(data.summary.total);
    document.getElementById('paid-amount').textContent = formatCurrency(data.summary.paid);
    document.getElementById('partial-amount').textContent = formatCurrency(data.summary.partial);
    document.getElementById('unpaid-amount').textContent = formatCurrency(data.summary.unpaid);
    
    renderTasks();
    
  } catch (error) {
    console.error('Error loading share data:', error);
    document.getElementById('client-header').innerHTML = '<h1>Error</h1><p>Failed to load client data.</p>';
  }
}

function getFilteredTasks() {
  const fromDate = document.getElementById('filter-from').value;
  const toDate = document.getElementById('filter-to').value;
  const status = document.getElementById('filter-status').value;
  
  return allTasks.filter(task => {
    if (fromDate && task.due_date && task.due_date < fromDate) return false;
    if (toDate && task.due_date && task.due_date > toDate) return false;
    if (status && task.status !== status) return false;
    return true;
  });
}

function renderTasks() {
  const tasks = getFilteredTasks();
  const tbody = document.getElementById('tasks-body');
  
  if (tasks.length === 0) {
    tbody.innerHTML = '<tr><td colspan="6" style="text-align:center; padding:40px; color:#9ca3af;">No tasks found</td></tr>';
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

function applyFilters() {
  renderTasks();
}

function clearFilters() {
  document.getElementById('filter-from').value = '';
  document.getElementById('filter-to').value = '';
  document.getElementById('filter-status').value = '';
  renderTasks();
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str || '';
  return div.innerHTML;
}

// Initialize
loadShareData();
