// lib/cron.js
// Cron job scheduler for notifications and reminders

const cron = require('node-cron');
const { pool } = require('./db');
const { sendTaskReminder, sendInvoiceEmail } = require('./google/gmail');
const { sendWhatsApp } = require('./whatsapp/gowa');

let jobsStarted = false;

// Job: Send overdue task reminders daily at 8:00 AM
async function overdueReminder() {
  console.log('[CRON] Running overdue task reminder job...');
  
  try {
    const { rows } = await pool.query(`
      SELECT w.*, c.name AS client_name, c.email AS client_email, 
             u.email AS user_email, u.full_name AS user_name
      FROM work_items w
      LEFT JOIN clients c ON c.id = w.client_id
      LEFT JOIN users u ON u.id = w.assigned_to
      WHERE w.status != 'completed' 
        AND w.due_date < CURRENT_DATE
        AND w.payment_status != 'paid'
    `);

    for (const task of rows) {
      // Send email notification
      if (task.user_email) {
        await sendTaskReminder(task, task.user_email, task.assigned_to);
      }

      // Store in notifications table
      await pool.query(`
        INSERT INTO notifications (user_id, type, subject, body, channel, status, scheduled_for)
        VALUES ($1, 'email', 'Overdue Task Alert', 
                $2, 'email', 'pending', CURRENT_TIMESTAMP)
      `, [task.assigned_to, `Task "${task.title}" is overdue. Client: ${task.client_name || 'N/A'}`]);

      // Store in reminders table
      await pool.query(`
        INSERT INTO reminders (user_id, client_id, work_item_id, type, scheduled_for, status)
        VALUES ($1, $2, $3, 'overdue', CURRENT_TIMESTAMP, 'sent')
      `, [task.assigned_to, task.client_id, task.id]);

      console.log(`[CRON] Sent overdue reminder for task ${task.id}: ${task.title}`);
    }

    console.log(`[CRON] Overdue reminder job completed. Processed ${rows.length} tasks.`);
  } catch (error) {
    console.error('[CRON] Error in overdue reminder job:', error);
  }
}

// Job: Send upcoming task notifications (24 hours before due date)
async function upcomingReminder() {
  console.log('[CRON] Running upcoming task reminder job...');
  
  try {
    const { rows } = await pool.query(`
      SELECT w.*, c.name AS client_name, c.email AS client_email,
             u.email AS user_email, u.full_name AS user_name
      FROM work_items w
      LEFT JOIN clients c ON c.id = w.client_id
      LEFT JOIN users u ON u.id = w.assigned_to
      WHERE w.status != 'completed'
        AND w.due_date = CURRENT_DATE + INTERVAL '1 day'
    `);

    for (const task of rows) {
      if (task.user_email) {
        await sendTaskReminder(task, task.user_email, task.assigned_to);
      }

      await pool.query(`
        INSERT INTO reminders (user_id, client_id, work_item_id, type, scheduled_for, status)
        VALUES ($1, $2, $3, 'upcoming', CURRENT_TIMESTAMP, 'sent')
      `, [task.assigned_to, task.client_id, task.id]);

      console.log(`[CRON] Sent upcoming reminder for task ${task.id}: ${task.title}`);
    }

    console.log(`[CRON] Upcoming reminder job completed. Processed ${rows.length} tasks.`);
  } catch (error) {
    console.error('[CRON] Error in upcoming reminder job:', error);
  }
}

// Job: Send invoice due reminders (3 days before due date)
async function invoiceReminder() {
  console.log('[CRON] Running invoice reminder job...');
  
  try {
    const { rows } = await pool.query(`
      SELECT i.*, c.name AS client_name, c.email AS client_email,
             u.email AS user_email, u.full_name AS user_name
      FROM invoices i
      LEFT JOIN clients c ON c.id = i.client_id
      LEFT JOIN users u ON u.id = i.created_by
      WHERE i.status IN ('draft', 'sent')
        AND i.due_date = CURRENT_DATE + INTERVAL '3 days'
    `);

    for (const invoice of rows) {
      if (invoice.client_email) {
        await sendInvoiceEmail(invoice, invoice.client_email, invoice.created_by);
      }

      await pool.query(`
        INSERT INTO reminders (user_id, client_id, type, scheduled_for, status)
        VALUES ($1, $2, 'invoice_due', CURRENT_TIMESTAMP, 'sent')
      `, [invoice.created_by, invoice.client_id]);

      console.log(`[CRON] Sent invoice reminder for invoice ${invoice.invoice_number}`);
    }

    console.log(`[CRON] Invoice reminder job completed. Processed ${rows.length} invoices.`);
  } catch (error) {
    console.error('[CRON] Error in invoice reminder job:', error);
  }
}

// Job: Weekly digest every Monday at 9:00 AM
async function weeklyDigest() {
  console.log('[CRON] Running weekly digest job...');
  
  try {
    const { rows: users } = await pool.query('SELECT id, email, full_name FROM users WHERE is_active = TRUE');

    for (const user of users) {
      // Get user's stats
      const { rows: stats } = await pool.query(`
        SELECT 
          COUNT(*) FILTER (WHERE status = 'completed') as completed,
          COUNT(*) FILTER (WHERE status = 'in-progress') as in_progress,
          COUNT(*) FILTER (WHERE status = 'pending') as pending,
          COUNT(*) FILTER (WHERE due_date < CURRENT_DATE AND status != 'completed') as overdue
        FROM work_items
        WHERE assigned_to = $1
      `, [user.id]);

      const summary = stats[0];

      const emailBody = `
        Hi ${user.full_name},
        
        Here's your weekly summary:
        
        ✅ Completed: ${summary.completed || 0}
        🔄 In Progress: ${summary.in_progress || 0}
        ⏳ Pending: ${summary.pending || 0}
        ⚠️ Overdue: ${summary.overdue || 0}
        
        Have a great week!
        ClientPM Team
      `;

      await pool.query(`
        INSERT INTO notifications (user_id, type, subject, body, channel, status, sent_at)
        VALUES ($1, 'email', 'Weekly Summary', $2, 'email', 'sent', CURRENT_TIMESTAMP)
      `, [user.id, emailBody]);

      console.log(`[CRON] Sent weekly digest to user ${user.id}: ${user.email}`);
    }

    console.log(`[CRON] Weekly digest job completed. Sent to ${users.length} users.`);
  } catch (error) {
    console.error('[CRON] Error in weekly digest job:', error);
  }
}

// Start all cron jobs
function startCronJobs() {
  if (jobsStarted) {
    console.log('[CRON] Jobs already started');
    return;
  }

  if (process.env.NODE_ENV === 'production' || process.env.ENABLE_CRON === 'true') {
    // Daily overdue reminders at 8:00 AM
    cron.schedule('0 8 * * *', () => {
      overdueReminder();
    }, {
      timezone: 'UTC'
    });

    // Daily upcoming reminders at 8:00 AM
    cron.schedule('0 8 * * *', () => {
      upcomingReminder();
    }, {
      timezone: 'UTC'
    });

    // Daily invoice reminders at 8:00 AM
    cron.schedule('0 8 * * *', () => {
      invoiceReminder();
    }, {
      timezone: 'UTC'
    });

    // Weekly digest every Monday at 9:00 AM
    cron.schedule('0 9 * * 1', () => {
      weeklyDigest();
    }, {
      timezone: 'UTC'
    });

    jobsStarted = true;
    console.log('[CRON] All cron jobs started successfully');
  } else {
    console.log('[CRON] Cron jobs disabled (set ENABLE_CRON=true to enable)');
  }
}

module.exports = {
  startCronJobs,
  overdueReminder,
  upcomingReminder,
  invoiceReminder,
  weeklyDigest
};
