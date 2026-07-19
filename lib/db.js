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
    CREATE TABLE IF NOT EXISTS organizations (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      name TEXT NOT NULL,
      slug TEXT UNIQUE,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_organizations_slug ON organizations (slug);`);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      org_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
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
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS phone TEXT;`);
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar TEXT;`);
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS bio TEXT;`);
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS custom_role TEXT;`);
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT TRUE;`);
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS google_refresh_token TEXT;`);
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS google_calendar_sync BOOLEAN DEFAULT FALSE;`);
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS google_drive_sync BOOLEAN DEFAULT FALSE;`);
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS notification_preferences JSONB DEFAULT '{"email": true, "whatsapp": false}';`);
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS org_id UUID;`);
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
      org_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
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
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_clients_org_id ON clients (org_id);`);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS work_items (
      id SERIAL PRIMARY KEY,
      org_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
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
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_work_items_org_id ON work_items (org_id);`);

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
  // Multi-tenancy: events were previously unscoped, meaning any authenticated
  // user of ANY organization could read/write any other org's calendar.
  await pool.query(`ALTER TABLE calendar_events ADD COLUMN IF NOT EXISTS org_id UUID REFERENCES organizations(id) ON DELETE CASCADE;`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_calendar_events_org_id ON calendar_events (org_id);`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_calendar_events_user_id ON calendar_events (user_id);`);
  // Backfill org_id for any pre-existing rows from before this column existed,
  // derived from the event's owning user.
  await pool.query(`
    UPDATE calendar_events e SET org_id = u.org_id
    FROM users u WHERE e.user_id = u.id AND e.org_id IS NULL;
  `);

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
  // Multitenancy + invoice-designer support (added alongside the invoice designer page)
  await pool.query(`ALTER TABLE invoices ADD COLUMN IF NOT EXISTS org_id UUID REFERENCES organizations(id) ON DELETE CASCADE;`);
  await pool.query(`ALTER TABLE invoices ADD COLUMN IF NOT EXISTS tax_rate NUMERIC(5,4) DEFAULT 0.18;`);
  await pool.query(`ALTER TABLE invoices ADD COLUMN IF NOT EXISTS custom_items JSONB DEFAULT '[]';`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_invoices_org_id ON invoices (org_id);`);

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
  // Multi-tenancy: custom roles previously had a single global-unique `name`,
  // so two organizations couldn't both have a "Designer" role, and any org's
  // roles were visible/editable by any other org. Scope roles per org.
  await pool.query(`ALTER TABLE roles ADD COLUMN IF NOT EXISTS org_id UUID REFERENCES organizations(id) ON DELETE CASCADE;`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_roles_org_id ON roles (org_id);`);
  await pool.query(`ALTER TABLE roles DROP CONSTRAINT IF EXISTS roles_name_key;`);
  await pool.query(`
    DO $$
    BEGIN
      ALTER TABLE roles ADD CONSTRAINT roles_org_id_name_key UNIQUE (org_id, name);
    EXCEPTION WHEN duplicate_object THEN NULL;
    END $$;
  `);

  // Automation/Integration tables (sm_ prefix for separation)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS sm_connections (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      org_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
      provider TEXT NOT NULL,
      module TEXT,
      account_label TEXT,
      access_token TEXT NOT NULL,
      refresh_token TEXT,
      expires_at TIMESTAMP NOT NULL,
      scopes JSONB DEFAULT '[]',
      status TEXT DEFAULT 'active' CHECK (status = ANY (ARRAY['active','inactive','revoked'])),
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_sm_connections_org_id ON sm_connections (org_id);`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_sm_connections_provider ON sm_connections (provider);`);

  // Organization join requests table for team member approval flow
  await pool.query(`
    CREATE TABLE IF NOT EXISTS org_join_requests (
      id SERIAL PRIMARY KEY,
      org_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
      user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
      user_email TEXT NOT NULL,
      user_name TEXT NOT NULL,
      status TEXT DEFAULT 'pending' CHECK (status = ANY (ARRAY['pending','approved','rejected'])),
      requested_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      reviewed_at TIMESTAMP,
      UNIQUE (org_id, user_id)
    );
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_org_join_requests_org_id ON org_join_requests (org_id);`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_org_join_requests_user_id ON org_join_requests (user_id);`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_org_join_requests_status ON org_join_requests (status);`);

  // Client dashboard share links — a client is given a URL containing a
  // random, high-entropy token. We store only a SHA-256 hash of the token
  // (never the raw token itself), so a database leak alone doesn't expose
  // working links. Each link is scoped to exactly one client, is revocable,
  // and can optionally expire.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS client_share_links (
      id SERIAL PRIMARY KEY,
      org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      client_id INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
      token_hash TEXT NOT NULL UNIQUE,
      token_prefix TEXT NOT NULL,
      label TEXT,
      created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
      expires_at TIMESTAMP,
      revoked_at TIMESTAMP,
      last_accessed_at TIMESTAMP,
      access_count INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_share_links_token_hash ON client_share_links (token_hash);`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_share_links_client_id ON client_share_links (client_id);`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_share_links_org_id ON client_share_links (org_id);`);

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