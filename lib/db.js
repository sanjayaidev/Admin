// lib/db.js
// One shared Postgres connection pool, reused across all API routes.
// Also handles auto-creating tables on first use (no manual migration step needed).

const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }, // required for Neon
});

let migrated = false;

// Creates all tables if they don't exist yet. Safe to call every request —
// CREATE TABLE IF NOT EXISTS does nothing if the table is already there.
// We cache `migrated` so we only actually run this once per server instance.
async function migrate() {
  if (migrated) return;

  await pool.query(`
    CREATE TABLE IF NOT EXISTS clients (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT,
      phone TEXT,
      company TEXT,
      address TEXT,
      notes TEXT,
      slug TEXT UNIQUE NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS work_items (
      id SERIAL PRIMARY KEY,
      client_id INTEGER REFERENCES clients(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      description TEXT,
      status TEXT DEFAULT 'pending',
      priority TEXT DEFAULT 'medium',
      due_date DATE,
      amount NUMERIC DEFAULT 0,
      payment_status TEXT DEFAULT 'unpaid',
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS reminders (
      id SERIAL PRIMARY KEY,
      client_id INTEGER REFERENCES clients(id) ON DELETE CASCADE,
      work_item_id INTEGER REFERENCES work_items(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      remind_at TIMESTAMPTZ NOT NULL,
      note TEXT,
      done BOOLEAN DEFAULT FALSE,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
  `);

  migrated = true;
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
