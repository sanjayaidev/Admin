// lib/payment/invoice.js
// Invoice generation and PDF creation

const { pool } = require('../db');

// Generate unique invoice number
async function generateInvoiceNumber() {
  const year = new Date().getFullYear();
  
  // Get the last invoice number for this year
  const { rows } = await pool.query(`
    SELECT invoice_number FROM invoices 
    WHERE invoice_number LIKE $1 
    ORDER BY invoice_number DESC 
    LIMIT 1
  `, [`INV-${year}-%`]);

  let nextNum = 1;
  if (rows.length > 0) {
    const lastNum = parseInt(rows[0].invoice_number.split('-')[2]);
    nextNum = lastNum + 1;
  }

  return `INV-${year}-${String(nextNum).padStart(4, '0')}`;
}

// Create invoice from work items
async function createInvoiceFromTasks(clientId, workItemIds, userId, options = {}) {
  const clientQuery = await pool.query('SELECT * FROM clients WHERE id = $1', [clientId]);
  if (clientQuery.rows.length === 0) {
    throw new Error('Client not found');
  }
  const client = clientQuery.rows[0];

  // Get work items
  const placeholders = workItemIds.map((_, i) => `$${i + 1}`).join(',');
  const workItemsQuery = await pool.query(`
    SELECT * FROM work_items WHERE id IN (${placeholders}) AND client_id = $${workItemIds.length + 1}
  `, [...workItemIds, clientId]);

  if (workItemsQuery.rows.length === 0) {
    throw new Error('No valid work items found');
  }

  const workItems = workItemsQuery.rows;

  // Calculate totals
  const subtotal = workItems.reduce((sum, item) => sum + (parseFloat(item.amount) || 0), 0);
  const taxRate = options.taxRate || 0.18; // Default 18% GST
  const tax = subtotal * taxRate;
  const total = subtotal + tax;

  // Generate invoice number
  const invoiceNumber = await generateInvoiceNumber();

  // Set dates
  const issueDate = options.issueDate || new Date().toISOString().split('T')[0];
  const dueDate = options.dueDate || new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

  // Create invoice
  const { rows } = await pool.query(`
    INSERT INTO invoices (
      client_id, work_item_ids, invoice_number, issue_date, due_date,
      subtotal, tax, total, status, notes, created_by
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
    RETURNING *
  `, [
    clientId,
    JSON.stringify(workItemIds),
    invoiceNumber,
    issueDate,
    dueDate,
    subtotal,
    tax,
    total,
    options.status || 'draft',
    options.notes || null,
    userId
  ]);

  // Update work items payment status
  await pool.query(`
    UPDATE work_items SET payment_status = 'partial' WHERE id = ANY($1)
  `, [workItemIds]);

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
          <td>$${parseFloat(item.amount || 0).toFixed(2)}</td>
        </tr>
      `).join('')}
    </tbody>
  </table>

  <div class="totals">
    <div class="totals-row">
      <span>Subtotal:</span>
      <span>$${parseFloat(invoice.subtotal || 0).toFixed(2)}</span>
    </div>
    <div class="totals-row">
      <span>Tax (18%):</span>
      <span>$${parseFloat(invoice.tax || 0).toFixed(2)}</span>
    </div>
    <div class="totals-row total">
      <span>Total:</span>
      <span>$${parseFloat(invoice.total || 0).toFixed(2)}</span>
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
  getInvoiceDetails,
  generateInvoiceHTML,
  markInvoicePaid
};
