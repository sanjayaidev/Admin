// lib/db.js
// One shared Postgres connection pool, reused across all API routes.
// Also handles auto-creating tables on first use (no manual migration step needed).

const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
});

let migrated = false;

// Creates all tables if they don't exist yet. Safe to call every request —
// CREATE TABLE IF NOT EXISTS does nothing if the table is already there.
// We cache `migrated` so we only actually run this once per server instance.
async function migrate() {
  if (migrated) return;

  // Order matters: tables being referenced by a foreign key must be
  // created first (users before clients, clients before work_items, etc.)

  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      full_name TEXT NOT NULL,
      phone TEXT,
      avatar TEXT,
      bio TEXT,
      role TEXT DEFAULT 'team' CHECK (role = ANY (ARRAY['admin','team','client'])),
      custom_role TEXT,
      is_active BOOLEAN DEFAULT TRUE,
      google_refresh_token TEXT,
      google_calendar_sync BOOLEAN DEFAULT FALSE,
      google_drive_sync BOOLEAN DEFAULT FALSE,
      notification_preferences JSONB DEFAULT '{"email": true, "whatsapp": false}',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS sessions (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      session_token TEXT NOT NULL UNIQUE,
      expires_at TIMESTAMP NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_sessions_token ON sessions (session_token);`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions (user_id);`);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS clients (
      id SERIAL PRIMARY KEY,
      slug TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      email TEXT,
      phone TEXT,
      company TEXT,
      address TEXT,
      notes TEXT,
      created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_clients_slug ON clients (slug);`);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS work_items (
      id SERIAL PRIMARY KEY,
      client_id INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      description TEXT,
      status TEXT DEFAULT 'pending' CHECK (status = ANY (ARRAY['pending','in-progress','review','completed'])),
      priority TEXT DEFAULT 'medium' CHECK (priority = ANY (ARRAY['low','medium','high','urgent'])),
      due_date DATE,
      amount NUMERIC(10,2),
      payment_status TEXT DEFAULT 'unpaid' CHECK (payment_status = ANY (ARRAY['unpaid','paid','partial'])),
      created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
      assigned_to INTEGER REFERENCES users(id) ON DELETE SET NULL,
      google_calendar_event_id TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_work_items_client_id ON work_items (client_id);`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_work_items_status ON work_items (status);`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_work_items_due_date ON work_items (due_date);`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_work_items_assigned_to ON work_items (assigned_to);`);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS work_comments (
      id SERIAL PRIMARY KEY,
      work_item_id INTEGER NOT NULL REFERENCES work_items(id) ON DELETE CASCADE,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      comment TEXT NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS calendar_events (
      id SERIAL PRIMARY KEY,
      work_item_id INTEGER REFERENCES work_items(id) ON DELETE SET NULL,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      description TEXT,
      event_date TIMESTAMP NOT NULL,
      event_type TEXT DEFAULT 'task' CHECK (event_type = ANY (ARRAY['task','meeting','deadline'])),
      external_calendar_id TEXT,
      google_meet_link TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_calendar_events_date ON calendar_events (event_date);`);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS invoices (
      id SERIAL PRIMARY KEY,
      client_id INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
      work_item_ids JSONB DEFAULT '[]',
      invoice_number TEXT NOT NULL UNIQUE,
      issue_date DATE NOT NULL,
      due_date DATE NOT NULL,
      subtotal NUMERIC(10,2) DEFAULT 0,
      tax NUMERIC(10,2) DEFAULT 0,
      total NUMERIC(10,2) DEFAULT 0,
      status TEXT DEFAULT 'draft' CHECK (status = ANY (ARRAY['draft','sent','paid','overdue'])),
      notes TEXT,
      payment_id TEXT,
      created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_invoices_client_id ON invoices (client_id);`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_invoices_status ON invoices (status);`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_invoices_number ON invoices (invoice_number);`);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS integrations (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      provider TEXT NOT NULL CHECK (provider = ANY (ARRAY['google_drive','google_sheets','google_calendar','gmail'])),
      access_token TEXT,
      refresh_token TEXT,
      expiry_date TIMESTAMP,
      is_active BOOLEAN DEFAULT TRUE,
      settings JSONB DEFAULT '{}',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      UNIQUE (user_id, provider)
    );
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_integrations_user_id ON integrations (user_id);`);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS notifications (
      id SERIAL PRIMARY KEY,
      user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      type TEXT CHECK (type = ANY (ARRAY['email','whatsapp'])),
      subject TEXT,
      body TEXT NOT NULL,
      channel TEXT CHECK (channel = ANY (ARRAY['email','whatsapp','in-app'])),
      status TEXT DEFAULT 'pending' CHECK (status = ANY (ARRAY['pending','sent','failed'])),
      scheduled_for TIMESTAMP,
      sent_at TIMESTAMP,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_notifications_status ON notifications (status);`);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS reminders (
      id SERIAL PRIMARY KEY,
      user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      client_id INTEGER REFERENCES clients(id) ON DELETE SET NULL,
      work_item_id INTEGER REFERENCES work_items(id) ON DELETE SET NULL,
      type TEXT CHECK (type = ANY (ARRAY['overdue','upcoming','invoice_due'])),
      scheduled_for TIMESTAMP NOT NULL,
      sent_at TIMESTAMP,
      status TEXT DEFAULT 'pending' CHECK (status = ANY (ARRAY['pending','sent','failed'])),
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_reminders_status ON reminders (status);`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_reminders_scheduled ON reminders (scheduled_for);`);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS client_assignments (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      client_id INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
      permission TEXT DEFAULT 'view' CHECK (permission = ANY (ARRAY['view','edit'])),
      assigned_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      UNIQUE (user_id, client_id)
    );
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_assignments_user_id ON client_assignments (user_id);`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_assignments_client_id ON client_assignments (client_id);`);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS activity_log (
      id SERIAL PRIMARY KEY,
      user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      action TEXT NOT NULL CHECK (action = ANY (ARRAY['create','update','delete','login','logout'])),
      entity_type TEXT NOT NULL,
      entity_id INTEGER,
      old_value JSONB,
      new_value JSONB,
      ip_address TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_activity_log_user_id ON activity_log (user_id);`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_activity_log_created_at ON activity_log (created_at);`);

  // Roles table for custom job roles
  await pool.query(`
    CREATE TABLE IF NOT EXISTS roles (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      description TEXT,
      color TEXT DEFAULT '#4f46e5',
      created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_roles_name ON roles (name);`);

  migrated = true;
  console.log('✅ Database migrations completed');
}

// Turns "Jane Doe" into a unique slug like "jane-doe" or "jane-doe-2" if taken.
async function makeUniqueSlug(name) {
  const base = name.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') || 'client';
  let slug = base;
  let i = 1;
  while (true) {
    const { rows } = await pool.query('SELECT 1 FROM clients WHERE slug = $1', [slug]);
    if (rows.length === 0) return slug;
    i += 1;
    slug = `${base}-${i}`;
  }
}

module.exports = { pool, migrate, makeUniqueSlug };
