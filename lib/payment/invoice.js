// lib/payment/invoice.js
// Invoice generation and PDF creation

const { pool } = require('../db');

// Generate unique invoice number (scoped per organization so two orgs don't collide/leak counts)
async function generateInvoiceNumber(orgId) {
  const year = new Date().getFullYear();

  const { rows } = await pool.query(`
    SELECT invoice_number FROM invoices
    WHERE invoice_number LIKE $1 AND ($2::uuid IS NULL OR org_id = $2)
    ORDER BY invoice_number DESC
    LIMIT 1
  `, [`INV-${year}-%`, orgId || null]);

  let nextNum = 1;
  if (rows.length > 0) {
    const lastNum = parseInt(rows[0].invoice_number.split('-')[2]);
    nextNum = lastNum + 1;
  }

  return `INV-${year}-${String(nextNum).padStart(4, '0')}`;
}

// Calculate subtotal/tax/total from a mix of billed work items + free-form custom line items.
// Shared by both the create step and the live-preview endpoint so the numbers always match.
function calculateTotals(workItems, customItems, taxRate) {
  const workTotal = (workItems || []).reduce((sum, item) => sum + (parseFloat(item.amount) || 0), 0);
  const customTotal = (customItems || []).reduce((sum, item) => sum + (parseFloat(item.amount) || 0), 0);
  const subtotal = workTotal + customTotal;
  const rate = taxRate ?? 0.18;
  const tax = subtotal * rate;
  const total = subtotal + tax;
  return { subtotal, tax, total, taxRate: rate };
}

// Create invoice as a draft. workItemIds may be empty (invoice made entirely of custom line items).
async function createInvoiceFromTasks(clientId, workItemIds, userId, options = {}) {
  const clientQuery = await pool.query('SELECT * FROM clients WHERE id = $1', [clientId]);
  if (clientQuery.rows.length === 0) {
    throw new Error('Client not found');
  }

  let workItems = [];
  if (workItemIds && workItemIds.length > 0) {
    const placeholders = workItemIds.map((_, i) => `$${i + 1}`).join(',');
    const workItemsQuery = await pool.query(`
      SELECT * FROM work_items WHERE id IN (${placeholders}) AND client_id = $${workItemIds.length + 1}
    `, [...workItemIds, clientId]);
    workItems = workItemsQuery.rows;
  }

  const customItems = (options.customItems || []).map(ci => ({
    title: ci.title || 'Item',
    description: ci.description || '',
    amount: parseFloat(ci.amount) || 0
  }));

  if (workItems.length === 0 && customItems.length === 0) {
    throw new Error('Add at least one work item or custom line item');
  }

  const { subtotal, tax, total, taxRate } = calculateTotals(workItems, customItems, options.taxRate);
  const invoiceNumber = await generateInvoiceNumber(options.orgId);

  const issueDate = options.issueDate || new Date().toISOString().split('T')[0];
  const dueDate = options.dueDate || new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

  const { rows } = await pool.query(`
    INSERT INTO invoices (
      client_id, work_item_ids, invoice_number, issue_date, due_date,
      subtotal, tax, total, tax_rate, status, notes, custom_items, created_by, org_id
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
    RETURNING *
  `, [
    clientId,
    JSON.stringify(workItemIds || []),
    invoiceNumber,
    issueDate,
    dueDate,
    subtotal,
    tax,
    total,
    taxRate,
    options.status || 'draft',
    options.notes || null,
    JSON.stringify(customItems),
    userId,
    options.orgId || null
  ]);

  // Only flip work items to "partial" once the invoice is actually sent, not while it's a draft
  if (options.status === 'sent' && workItemIds && workItemIds.length > 0) {
    await pool.query(`UPDATE work_items SET payment_status = 'partial' WHERE id = ANY($1)`, [workItemIds]);
  }

  return rows[0];
}

// Update a draft invoice's line items / dates / notes / tax rate, recalculating totals.
// Only drafts can be edited — once sent, the numbers are frozen for audit purposes.
async function updateInvoiceDraft(invoiceId, userId, options = {}) {
  const existing = await pool.query('SELECT * FROM invoices WHERE id = $1', [invoiceId]);
  if (existing.rows.length === 0) throw new Error('Invoice not found');
  if (existing.rows[0].status !== 'draft') throw new Error('Only draft invoices can be edited');

  const workItemIds = options.workItemIds ?? existing.rows[0].work_item_ids ?? [];
  let workItems = [];
  if (workItemIds.length > 0) {
    const placeholders = workItemIds.map((_, i) => `$${i + 1}`).join(',');
    const wiQuery = await pool.query(`SELECT * FROM work_items WHERE id IN (${placeholders})`, workItemIds);
    workItems = wiQuery.rows;
  }
  const customItems = (options.customItems ?? existing.rows[0].custom_items ?? []).map(ci => ({
    title: ci.title || 'Item',
    description: ci.description || '',
    amount: parseFloat(ci.amount) || 0
  }));

  const taxRate = options.taxRate ?? existing.rows[0].tax_rate;
  const { subtotal, tax, total } = calculateTotals(workItems, customItems, taxRate);

  const { rows } = await pool.query(`
    UPDATE invoices SET
      work_item_ids = $1, custom_items = $2, tax_rate = $3,
      subtotal = $4, tax = $5, total = $6,
      issue_date = $7, due_date = $8, notes = $9,
      updated_at = CURRENT_TIMESTAMP
    WHERE id = $10
    RETURNING *
  `, [
    JSON.stringify(workItemIds),
    JSON.stringify(customItems),
    taxRate,
    subtotal, tax, total,
    options.issueDate || existing.rows[0].issue_date,
    options.dueDate || existing.rows[0].due_date,
    options.notes ?? existing.rows[0].notes,
    invoiceId
  ]);

  return rows[0];
}

// Get invoice with details
async function getInvoiceDetails(invoiceId) {
  const { rows } = await pool.query(`
    SELECT i.*, c.name AS client_name, c.email AS client_email, c.phone AS client_phone,
           c.company, c.address
    FROM invoices i
    LEFT JOIN clients c ON c.id = i.client_id
    WHERE i.id = $1
  `, [invoiceId]);

  if (rows.length === 0) {
    throw new Error('Invoice not found');
  }

  const invoice = rows[0];

  // Get associated work items
  const workItemIds = invoice.work_item_ids || [];
  let workItems = [];
  if (workItemIds.length > 0) {
    const placeholders = workItemIds.map((_, i) => `$${i + 1}`).join(',');
    const wiQuery = await pool.query(`
      SELECT * FROM work_items WHERE id IN (${placeholders})
    `, workItemIds);
    workItems = wiQuery.rows || [];
  }

  return {
    ...invoice,
    work_items: workItems
  };
}

// Generate HTML for invoice PDF
function generateInvoiceHTML(invoice) {
  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Invoice ${invoice.invoice_number}</title>
  <style>
    body { font-family: Arial, sans-serif; padding: 40px; }
    .header { display: flex; justify-content: space-between; margin-bottom: 40px; }
    .company-info { color: #666; }
    .invoice-title { font-size: 32px; color: #333; margin: 0; }
    .invoice-number { color: #666; margin-top: 10px; }
    table { width: 100%; border-collapse: collapse; margin: 30px 0; }
    th, td { padding: 12px; text-align: left; border-bottom: 1px solid #ddd; }
    th { background-color: #f5f5f5; }
    .totals { float: right; width: 300px; }
    .totals-row { display: flex; justify-content: space-between; padding: 8px 12px; }
    .totals-row.total { font-weight: bold; font-size: 18px; border-top: 2px solid #333; }
    .notes { clear: both; margin-top: 40px; color: #666; }
    .status { padding: 6px 12px; border-radius: 4px; font-size: 14px; }
    .status-draft { background: #ffeaa7; color: #d63031; }
    .status-sent { background: #74b9ff; color: #0984e3; }
    .status-paid { background: #55efc4; color: #00b894; }
    .status-overdue { background: #fab1a0; color: #d63031; }
  </style>
</head>
<body>
  <div class="header">
    <div>
      <h1 class="invoice-title">INVOICE</h1>
      <p class="invoice-number">#${invoice.invoice_number}</p>
      <span class="status status-${invoice.status}">${invoice.status.toUpperCase()}</span>
    </div>
    <div class="company-info">
      <strong>ClientPM</strong><br>
      Project Management System<br>
    </div>
  </div>

  <div style="margin-bottom: 30px;">
    <strong>Bill To:</strong><br>
    ${invoice.client_name}<br>
    ${invoice.company || ''}<br>
    ${invoice.address || ''}<br>
    ${invoice.client_email || ''}<br>
  </div>

  <table>
    <thead>
      <tr>
        <th>Description</th>
        <th style="width: 120px;">Amount</th>
      </tr>
    </thead>
    <tbody>
      ${(invoice.work_items || []).map(item => `
        <tr>
          <td>${item.title}${item.description ? '<br><small>' + item.description + '</small>' : ''}</td>
          <td>₹${parseFloat(item.amount || 0).toFixed(2)}</td>
        </tr>
      `).join('')}
      ${(invoice.custom_items || []).map(item => `
        <tr>
          <td>${item.title}${item.description ? '<br><small>' + item.description + '</small>' : ''}</td>
          <td>₹${parseFloat(item.amount || 0).toFixed(2)}</td>
        </tr>
      `).join('')}
    </tbody>
  </table>

  <div class="totals">
    <div class="totals-row">
      <span>Subtotal:</span>
      <span>₹${parseFloat(invoice.subtotal || 0).toFixed(2)}</span>
    </div>
    <div class="totals-row">
      <span>Tax (${Math.round((invoice.tax_rate ?? 0.18) * 100)}%):</span>
      <span>₹${parseFloat(invoice.tax || 0).toFixed(2)}</span>
    </div>
    <div class="totals-row total">
      <span>Total:</span>
      <span>₹${parseFloat(invoice.total || 0).toFixed(2)}</span>
    </div>
  </div>

  <div class="notes">
    <p><strong>Issue Date:</strong> ${new Date(invoice.issue_date).toLocaleDateString()}</p>
    <p><strong>Due Date:</strong> ${new Date(invoice.due_date).toLocaleDateString()}</p>
    ${invoice.notes ? `<p><strong>Notes:</strong> ${invoice.notes}</p>` : ''}
  </div>
</body>
</html>
  `.trim();
}

// Mark invoice as paid
async function markInvoicePaid(invoiceId, paymentId = null) {
  const { rows } = await pool.query(`
    UPDATE invoices 
    SET status = 'paid', payment_id = $2, updated_at = CURRENT_TIMESTAMP
    WHERE id = $1
    RETURNING *
  `, [invoiceId, paymentId]);

  if (rows.length === 0) {
    throw new Error('Invoice not found');
  }

  // Update associated work items
  const invoice = rows[0];
  const workItemIds = invoice.work_item_ids || [];
  if (workItemIds.length > 0) {
    await pool.query(`
      UPDATE work_items SET payment_status = 'paid' WHERE id = ANY($1)
    `, [workItemIds]);
  }

  return rows[0];
}

module.exports = {
  generateInvoiceNumber,
  createInvoiceFromTasks,
  updateInvoiceDraft,
  calculateTotals,
  getInvoiceDetails,
  generateInvoiceHTML,
  markInvoicePaid
};