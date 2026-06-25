// public/js/dashboard.js
// Plain JavaScript. Depends on utils.js being loaded first (formatCurrency,
// formatDate, isOverdue).

let allItems = [];          // every task, unfiltered, loaded once from the API
let activeRange = 'all';    // which preset chip is currently selected
let customFrom = null;      // custom date range (used when chips are "all" is overridden by Apply)
let customTo = null;

// ---- Load data once ----
async function loadDashboard() {
  const res = await fetch('/api/work-items');
  allItems = await res.json();
  setActiveChip('all');
  render();
}

// ---- Date range logic ----
// Returns { from: Date|null, to: Date|null } for the currently selected range.
function getCurrentRange() {
  if (customFrom || customTo) {
    return {
      from: customFrom ? new Date(customFrom) : null,
      to: customTo ? new Date(customTo + 'T23:59:59') : null, // include the whole "to" day
    };
  }

  const now = new Date();
  const startOfDay = d => new Date(d.getFullYear(), d.getMonth(), d.getDate());

  if (activeRange === 'today') {
    const start = startOfDay(now);
    const end = new Date(start); end.setHours(23, 59, 59);
    return { from: start, to: end };
  }
  if (activeRange === 'week') {
    const start = startOfDay(now);
    start.setDate(start.getDate() - start.getDay()); // back to Sunday
    const end = new Date(start); end.setDate(end.getDate() + 6); end.setHours(23, 59, 59);
    return { from: start, to: end };
  }
  if (activeRange === 'month') {
    const start = new Date(now.getFullYear(), now.getMonth(), 1);
    const end = new Date(now.getFullYear(), now.getMonth() + 1, 0); end.setHours(23, 59, 59);
    return { from: start, to: end };
  }
  return { from: null, to: null }; // 'all'
}

function itemsInRange() {
  const { from, to } = getCurrentRange();
  if (!from && !to) return allItems; // "all time" — no filtering

  return allItems.filter(item => {
    if (!item.due_date) return false; // tasks with no due date are excluded from a date-range view
    const due = new Date(item.due_date);
    if (from && due < from) return false;
    if (to && due > to) return false;
    return true;
  });
}

// ---- Chip clicks ----
function setActiveChip(range) {
  activeRange = range;
  customFrom = null;
  customTo = null;
  document.getElementById('range-from').value = '';
  document.getElementById('range-to').value = '';
  document.querySelectorAll('.chip').forEach(chip => {
    chip.classList.toggle('active', chip.dataset.range === range);
  });
}

document.querySelectorAll('.chip').forEach(chip => {
  chip.addEventListener('click', () => {
    setActiveChip(chip.dataset.range);
    render();
  });
});

document.getElementById('apply-range').addEventListener('click', () => {
  customFrom = document.getElementById('range-from').value || null;
  customTo = document.getElementById('range-to').value || null;
  if (customFrom || customTo) {
    document.querySelectorAll('.chip').forEach(chip => chip.classList.remove('active'));
  }
  render();
});

// ---- Render ----
function render() {
  const items = itemsInRange();
  renderRangeSummary(items);

  const stats = {
    pending: items.filter(i => i.status === 'pending').length,
    inProgress: items.filter(i => i.status === 'in-progress').length,
    review: items.filter(i => i.status === 'review').length,
    completed: items.filter(i => i.status === 'completed').length,
    totalAmount: items.reduce((s, i) => s + Number(i.amount || 0), 0),
    paid: items.filter(i => i.payment_status === 'paid').reduce((s, i) => s + Number(i.amount || 0), 0),
    outstanding: items.filter(i => i.payment_status !== 'paid').reduce((s, i) => s + Number(i.amount || 0), 0),
  };

  const overdue = items.filter(isOverdue);

  document.getElementById('dashboard-content').innerHTML = `
    <div class="grid cols-4" style="margin-bottom: 24px;">
      ${statCard('Pending', stats.pending)}
      ${statCard('In Progress', stats.inProgress)}
      ${statCard('In Review', stats.review)}
      ${statCard('Completed', stats.completed)}
    </div>

    <div class="grid cols-3" style="margin-bottom: 24px;">
      ${statCard('Total Billed', formatCurrency(stats.totalAmount))}
      ${statCard('Collected', formatCurrency(stats.paid))}
      ${statCard('Outstanding', formatCurrency(stats.outstanding))}
    </div>

    ${overdue.length > 0 ? `
      <div class="card" style="background:#fef2f2; border-color:#fecaca; margin-bottom:20px;">
        <strong style="color:#991b1b; font-size:14px;">${overdue.length} overdue task${overdue.length > 1 ? 's' : ''}</strong>
        <p style="color:#b91c1c; font-size:13px; margin:4px 0 0;">${overdue.map(i => escapeHtml(i.title)).join(', ')}</p>
      </div>
    ` : ''}

    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Task</th><th>Client</th><th>Status</th><th>Priority</th><th>Due</th><th>Amount</th><th>Payment</th>
          </tr>
        </thead>
        <tbody>
          ${items.length === 0
            ? `<tr><td colspan="7" style="text-align:center; padding:40px; color:#9ca3af;">No tasks in this range</td></tr>`
            : items.slice(0, 20).map(taskRowHtml).join('')}
        </tbody>
      </table>
    </div>
  `;
}

function renderRangeSummary(items) {
  const { from, to } = getCurrentRange();
  const label = (!from && !to)
    ? 'Showing all tasks'
    : `Showing tasks due ${from ? formatDate(from) : '…'} to ${to ? formatDate(to) : '…'}`;
  document.getElementById('range-summary').textContent = `${label} (${items.length} task${items.length !== 1 ? 's' : ''})`;
}

function statCard(label, value) {
  return `<div class="card"><div class="muted" style="font-size:13px;">${label}</div><div class="stat-value">${value}</div></div>`;
}

function taskRowHtml(item) {
  const overdueClass = isOverdue(item) ? 'style="color:#dc2626; font-weight:600;"' : '';
  return `
    <tr>
      <td>${escapeHtml(item.title)}</td>
      <td>${escapeHtml(item.client_name || '—')}</td>
      <td><span class="badge ${item.status}">${item.status}</span></td>
      <td><span class="badge ${item.priority}">${item.priority}</span></td>
      <td ${overdueClass}>${formatDate(item.due_date)}</td>
      <td>${formatCurrency(item.amount)}</td>
      <td><span class="badge ${item.payment_status}">${item.payment_status}</span></td>
    </tr>`;
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str || '';
  return div.innerHTML;
}

// ---- Init ----
loadDashboard();
