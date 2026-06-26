// lib/google/gmail.js
// Gmail integration - STUB for Apps Script
// In production, this would use Google Apps Script to send emails

const { pool } = require('../db');

/**
 * STUB: Send email via Google Apps Script
 * 
 * Production implementation would:
 * 1. Use Google Apps Script deployed as a web app
 * 2. Call the Apps Script endpoint with email details
 * 3. Apps Script uses GmailApp.sendEmail() to send
 * 
 * Example Apps Script code:
 * ```javascript
 * function doPost(e) {
 *   const data = JSON.parse(e.postData.contents);
 *   GmailApp.sendEmail(data.to, data.subject, data.body, {
 *     htmlBody: data.htmlBody,
 *     cc: data.cc,
 *     bcc: data.bcc
 *   });
 *   return ContentService.createTextOutput(JSON.stringify({success: true}));
 * }
 * ```
 */

// Send email via Apps Script (STUB)
async function sendEmailViaAppsScript(to, subject, body, options = {}) {
  // TODO: Implement Apps Script integration
  // const APPS_SCRIPT_URL = process.env.APPS_SCRIPT_EMAIL_URL;
  
  console.log('[GMAIL STUB] Would send email:', {
    to,
    subject,
    body: body.substring(0, 100) + '...',
    options
  });

  // Simulate successful send
  return {
    success: true,
    messageId: `stub-${Date.now()}`,
    message: 'Email sent (stub - configure Apps Script for production)'
  };
}

// Send invoice email (STUB)
async function sendInvoiceEmail(invoiceData, clientEmail, userId) {
  // TODO: Implement with actual email service or Apps Script
  
  const subject = `Invoice ${invoiceData.invoice_number} from ClientPM`;
  const htmlBody = `
    <html>
      <body>
        <h2>Invoice ${invoiceData.invoice_number}</h2>
        <p>Dear Client,</p>
        <p>Please find your invoice details below:</p>
        <table border="1" cellpadding="10">
          <tr><td><strong>Amount:</strong></td><td>$${invoiceData.total}</td></tr>
          <tr><td><strong>Due Date:</strong></td><td>${invoiceData.due_date}</td></tr>
          <tr><td><strong>Status:</strong></td><td>${invoiceData.status}</td></tr>
        </table>
        <p>${invoiceData.notes || ''}</p>
        <p>Thank you for your business!</p>
      </body>
    </html>
  `;

  console.log('[GMAIL STUB] Would send invoice email:', {
    to: clientEmail,
    subject,
    invoiceNumber: invoiceData.invoice_number
  });

  // Store notification in database
  await pool.query(`
    INSERT INTO notifications (user_id, type, subject, body, channel, status, sent_at)
    VALUES ($1, 'email', $2, $3, 'email', 'sent', CURRENT_TIMESTAMP)
  `, [userId, subject, htmlBody]);

  return {
    success: true,
    messageId: `stub-invoice-${Date.now()}`,
    message: 'Invoice email sent (stub)'
  };
}

// Send task reminder email (STUB)
async function sendTaskReminder(taskData, userEmail, userId) {
  // TODO: Implement with actual email service or Apps Script
  
  const subject = `Task Reminder: ${taskData.title}`;
  const body = `
    Hi,
    
    This is a reminder about your task:
    
    Title: ${taskData.title}
    Due Date: ${taskData.due_date}
    Status: ${taskData.status}
    Priority: ${taskData.priority}
    
    Please complete this task on time.
    
    Thanks,
    ClientPM Team
  `;

  console.log('[GMAIL STUB] Would send task reminder:', {
    to: userEmail,
    subject,
    taskTitle: taskData.title
  });

  // Store notification in database
  await pool.query(`
    INSERT INTO notifications (user_id, type, subject, body, channel, status, sent_at)
    VALUES ($1, 'email', $2, $3, 'email', 'sent', CURRENT_TIMESTAMP)
  `, [userId, subject, body]);

  return {
    success: true,
    messageId: `stub-reminder-${Date.now()}`,
    message: 'Task reminder sent (stub)'
  };
}

module.exports = {
  sendEmailViaAppsScript,
  sendInvoiceEmail,
  sendTaskReminder
};
