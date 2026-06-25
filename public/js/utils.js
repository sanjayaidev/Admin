// public/js/utils.js
// Small shared helpers. Load this script BEFORE any page-specific script
// (dashboard.js, tasks.js, etc.) so these functions are already defined.

function formatCurrency(amount) {
  const n = Number(amount || 0);
  return '₹' + n.toLocaleString('en-IN', { maximumFractionDigits: 2 });
}

function formatDate(dateStr) {
  if (!dateStr) return '—';
  return new Date(dateStr).toLocaleDateString('en-IN');
}

// True if a task's due date has passed and it isn't marked completed.
// Defined ONCE here so dashboard, tasks, and reminders all agree on
// what "overdue" means — no risk of one page disagreeing with another.
function isOverdue(item) {
  if (!item.due_date || item.status === 'completed') return false;
  return new Date(item.due_date) < new Date();
}
