// server.js — Unified router for ClientPM
// Single Node.js server serving static HTML/CSS/JS + API endpoints
// With full authentication and role-based access control

require('dotenv').config();

const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const path = require('path');

const { pool, migrate, makeUniqueSlug } = require('./lib/db');
const {
  createUser,
  createDefaultAdmin,
  authenticateUser,
  createSession,
  validateSession,
  deleteSession,
  verifyPassword,
  hashPassword
} = require('./lib/auth');
const { requireAuth, requireRole, optionalAuth } = require('./middleware/auth');

// ── Redis ──────────────────────────────────────────────────────────────────────
const { createClient } = require('redis');
const redisClient = createClient({
  url: process.env.REDIS_URL || 'redis://localhost:6379'
});
redisClient.on('error', (err) => {
  // Silently ignore Redis errors in development if Redis is not available
  if (process.env.NODE_ENV !== 'production') {
    // console.error('Redis Client Error:', err.message);
  } else {
    console.error('Redis Client Error:', err.message);
  }
});
redisClient.on('connect', () => console.log('✅ Redis connected'));
// Attempt to connect but don't fail if Redis is unavailable
redisClient.connect().catch(err => {
  if (process.env.NODE_ENV !== 'production') {
    console.warn('⚠️  Redis not available, continuing without caching');
  } else {
    console.error('❌ Redis connect failed:', err.message);
  }
});

// ── App setup ──────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, 'public');
const app = express();

app.use(express.json());
app.use(cookieParser());
app.use(cors({
  origin: process.env.NODE_ENV === 'production' ? process.env.APP_URL : 'http://localhost:3000',
  credentials: true
}));

// ══════════════════════════════════════════════════════════════════════════════
// AUTH ROUTES  (public — no requireAuth)
// ══════════════════════════════════════════════════════════════════════════════

// Login
app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password)
      return res.status(400).json({ error: 'Email and password are required' });

    const user = await authenticateUser(email, password);
    if (!user)
      return res.status(401).json({ error: 'Invalid email or password' });

    const token = await createSession(user.id);
    res.cookie('session_token', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 7 * 24 * 60 * 60 * 1000
    });
    res.json({ id: user.id, email: user.email, fullName: user.full_name, role: user.role });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Signup
app.post('/api/auth/signup', async (req, res) => {
  try {
    const { fullName, email, password, role } = req.body;
    if (!fullName || !email || !password)
      return res.status(400).json({ error: 'Full name, email, and password are required' });
    if (password.length < 6)
      return res.status(400).json({ error: 'Password must be at least 6 characters' });
    if (role && !['admin', 'team', 'client'].includes(role))
      return res.status(400).json({ error: 'Invalid role' });

    const user = await createUser(email, password, fullName, role || 'team');
    const token = await createSession(user.id);
    res.cookie('session_token', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 7 * 24 * 60 * 60 * 1000
    });
    res.status(201).json({ id: user.id, email: user.email, fullName: user.full_name, role: user.role });
  } catch (err) {
    console.error('Signup error:', err);
    if (err.code === '23505' && err.constraint === 'users_email_key')
      return res.status(400).json({ error: 'Email already registered' });
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Session check
app.get('/api/auth/me', async (req, res) => {
  try {
    const token = req.cookies.session_token;
    if (!token) return res.status(401).json({ error: 'Not authenticated' });

    const user = await validateSession(token);
    if (!user) {
      res.clearCookie('session_token');
      return res.status(401).json({ error: 'Invalid or expired session' });
    }
    res.json({ id: user.id, email: user.email, fullName: user.fullName, role: user.role });
  } catch (err) {
    console.error('Auth check error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Logout
app.post('/api/auth/logout', async (req, res) => {
  try {
    const token = req.cookies.session_token;
    if (token) await deleteSession(token);
    res.clearCookie('session_token');
    res.json({ success: true });
  } catch (err) {
    console.error('Logout error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Share link — public, no auth (must be before requireAuth middleware)
app.get('/api/share/:slug', optionalAuth, async (req, res) => {
  try {
    await migrate();
    const { slug } = req.params;
    const { start_date, end_date, status } = req.query;

    const { rows: clientRows } = await pool.query('SELECT * FROM clients WHERE slug = $1', [slug]);
    if (clientRows.length === 0) return res.status(404).json({ error: 'Client not found' });
    const client = clientRows[0];

    let query = 'SELECT * FROM work_items WHERE client_id = $1';
    const params = [client.id];
    let i = 2;
    if (start_date) { query += ` AND due_date >= $${i++}`; params.push(start_date); }
    if (end_date)   { query += ` AND due_date <= $${i++}`; params.push(end_date); }
    if (status)     { query += ` AND status = $${i++}`;    params.push(status); }
    query += ' ORDER BY due_date ASC NULLS LAST, created_at DESC';

    const { rows: workItems } = await pool.query(query, params);

    const summary = { total: 0, paid: 0, partial: 0, unpaid: 0 };
    workItems.forEach(item => {
      const amount = Number(item.amount) || 0;
      summary.total += amount;
      if (item.payment_status === 'paid')        summary.paid    += amount;
      else if (item.payment_status === 'partial') summary.partial += amount;
      else                                        summary.unpaid  += amount;
    });

    res.json({ client, workItems, summary });
  } catch (err) {
    console.error('Error fetching share data:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ══════════════════════════════════════════════════════════════════════════════
// PROTECTED API ROUTES  (requireAuth applied to all /api/* below)
// ══════════════════════════════════════════════════════════════════════════════

app.use('/api', requireAuth);

// Change password
app.post('/api/auth/change-password', async (req, res) => {
  try {
    const { current_password, new_password } = req.body;
    if (!current_password || !new_password)
      return res.status(400).json({ error: 'Both passwords are required' });
    if (new_password.length < 6)
      return res.status(400).json({ error: 'New password must be at least 6 characters' });

    const { rows } = await pool.query('SELECT password_hash FROM users WHERE id = $1', [req.user.id]);
    if (rows.length === 0) return res.status(404).json({ error: 'User not found' });

    const valid = await verifyPassword(current_password, rows[0].password_hash);
    if (!valid) return res.status(401).json({ error: 'Current password is incorrect' });

    const hash = await hashPassword(new_password);
    await pool.query('UPDATE users SET password_hash=$1, updated_at=CURRENT_TIMESTAMP WHERE id=$2', [hash, req.user.id]);
    res.json({ success: true, message: 'Password changed successfully' });
  } catch (err) {
    console.error('Change password error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── Profile ────────────────────────────────────────────────────────────────────

// GET current user profile
app.get('/api/profile/me', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, email, full_name, phone, avatar, bio, role, custom_role, 
              notification_preferences, google_calendar_sync, google_drive_sync,
              created_at
       FROM users WHERE id = $1`,
      [req.user.id]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'User not found' });
    res.json(rows[0]);
  } catch (err) {
    console.error('Error fetching profile:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT update current user profile
app.put('/api/profile/me', async (req, res) => {
  try {
    const { full_name, email, phone, bio } = req.body;
    if (!full_name?.trim() || !email?.trim())
      return res.status(400).json({ error: 'Name and email are required' });

    // Check if email is already taken by another user
    const existing = await pool.query('SELECT id FROM users WHERE email=$1 AND id!=$2', [email, req.user.id]);
    if (existing.rows.length > 0)
      return res.status(400).json({ error: 'Email already in use' });

    const { rows } = await pool.query(
      `UPDATE users SET full_name=$1, email=$2, phone=$3, bio=$4, updated_at=CURRENT_TIMESTAMP
       WHERE id=$5 RETURNING id, email, full_name, phone, avatar, bio, role, custom_role, created_at`,
      [full_name.trim(), email.trim(), phone||null, bio||null, req.user.id]
    );
    res.json(rows[0]);
  } catch (err) {
    console.error('Error updating profile:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT update avatar (base64 image)
app.put('/api/profile/avatar', async (req, res) => {
  try {
    const { avatar } = req.body;
    if (avatar === undefined)
      return res.status(400).json({ error: 'Avatar data is required' });

    const { rows } = await pool.query(
      `UPDATE users SET avatar=$1, updated_at=CURRENT_TIMESTAMP
       WHERE id=$2 RETURNING id, avatar`,
      [avatar, req.user.id]
    );
    res.json(rows[0]);
  } catch (err) {
    console.error('Error updating avatar:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT update notification preferences
app.put('/api/profile/notifications', async (req, res) => {
  try {
    const { email_notifications, whatsapp_notifications } = req.body;
    const prefs = {
      email: email_notifications || false,
      whatsapp: whatsapp_notifications || false
    };

    const { rows } = await pool.query(
      `UPDATE users SET notification_preferences=$1, updated_at=CURRENT_TIMESTAMP
       WHERE id=$2 RETURNING notification_preferences`,
      [JSON.stringify(prefs), req.user.id]
    );
    res.json(rows[0]);
  } catch (err) {
    console.error('Error updating notifications:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});


// ── Clients ────────────────────────────────────────────────────────────────────

// GET all clients (scoped by role)
app.get('/api/clients', async (req, res) => {
  try {
    await migrate();
    let query, params = [];
    if (req.user.role === 'admin') {
      query = 'SELECT * FROM clients ORDER BY created_at DESC';
    } else {
      query = `
        SELECT DISTINCT c.* FROM clients c
        INNER JOIN work_items w ON w.client_id = c.id
        WHERE w.assigned_to = $1
        ORDER BY c.created_at DESC
      `;
      params = [req.user.id];
    }
    const { rows } = await pool.query(query, params);
    res.json(rows);
  } catch (err) {
    console.error('Error fetching clients:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST create client
app.post('/api/clients', async (req, res) => {
  try {
    await migrate();
    const { name, email, phone, company, address, notes } = req.body;
    if (!name?.trim()) return res.status(400).json({ error: 'Name is required' });

    const slug = await makeUniqueSlug(name);
    const { rows } = await pool.query(
      `INSERT INTO clients (name, email, phone, company, address, notes, slug, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
      [name.trim(), email||null, phone||null, company||null, address||null, notes||null, slug, req.user.id]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    console.error('Error creating client:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET single client
app.get('/api/clients/:id', async (req, res) => {
  try {
    await migrate();
    const { rows } = await pool.query('SELECT * FROM clients WHERE id=$1', [req.params.id]);
    if (rows.length === 0) return res.status(404).json({ error: 'Client not found' });
    res.json(rows[0]);
  } catch (err) {
    console.error('Error fetching client:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT update client
app.put('/api/clients/:id', async (req, res) => {
  try {
    await migrate();
    const { name, email, phone, company, address, notes } = req.body;
    if (!name?.trim()) return res.status(400).json({ error: 'Name is required' });

    const { rows } = await pool.query(
      `UPDATE clients SET name=$1,email=$2,phone=$3,company=$4,address=$5,notes=$6,updated_at=CURRENT_TIMESTAMP
       WHERE id=$7 RETURNING *`,
      [name.trim(), email||null, phone||null, company||null, address||null, notes||null, req.params.id]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Client not found' });
    res.json(rows[0]);
  } catch (err) {
    console.error('Error updating client:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// DELETE client (admin only)
app.delete('/api/clients/:id', requireRole(['admin']), async (req, res) => {
  try {
    await migrate();
    const { rows } = await pool.query('DELETE FROM clients WHERE id=$1 RETURNING id', [req.params.id]);
    if (rows.length === 0) return res.status(404).json({ error: 'Client not found' });
    res.json({ deleted: true });
  } catch (err) {
    console.error('Error deleting client:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── Work Items ─────────────────────────────────────────────────────────────────

// GET all work items (scoped by role)
app.get('/api/work-items', async (req, res) => {
  try {
    await migrate();
    const { client_id, status, payment_status } = req.query;

    let query = `
      SELECT w.*, c.name AS client_name, c.slug AS client_slug,
             u.full_name AS assigned_name
      FROM work_items w
      LEFT JOIN clients c ON c.id = w.client_id
      LEFT JOIN users u ON u.id = w.assigned_to
      WHERE 1=1
    `;
    const params = [];
    let i = 1;

    if (req.user.role !== 'admin') {
      query += ` AND w.assigned_to = $${i++}`;
      params.push(req.user.id);
    }
    if (client_id)      { query += ` AND w.client_id = $${i++}`;      params.push(client_id); }
    if (status)         { query += ` AND w.status = $${i++}`;          params.push(status); }
    if (payment_status) { query += ` AND w.payment_status = $${i++}`;  params.push(payment_status); }

    query += ' ORDER BY w.due_date ASC NULLS LAST, w.created_at DESC';

    const { rows } = await pool.query(query, params);
    res.json(rows);
  } catch (err) {
    console.error('Error fetching work items:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST create work item
app.post('/api/work-items', async (req, res) => {
  try {
    await migrate();
    const { client_id, title, description, status, priority, due_date, amount, payment_status, assigned_to } = req.body;
    if (!client_id || !title) return res.status(400).json({ error: 'client_id and title are required' });

    const { rows } = await pool.query(
      `INSERT INTO work_items (client_id,title,description,status,priority,due_date,amount,payment_status,assigned_to,created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
      [client_id, title.trim(), description||null, status||'pending', priority||'medium',
       due_date||null, amount||null, payment_status||'unpaid', assigned_to||null, req.user.id]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    console.error('Error creating work item:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET single work item
app.get('/api/work-items/:id', async (req, res) => {
  try {
    await migrate();
    const { rows } = await pool.query(
      `SELECT w.*, c.name AS client_name, c.slug AS client_slug
       FROM work_items w LEFT JOIN clients c ON c.id = w.client_id
       WHERE w.id = $1`,
      [req.params.id]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Work item not found' });
    res.json(rows[0]);
  } catch (err) {
    console.error('Error fetching work item:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT update work item
app.put('/api/work-items/:id', async (req, res) => {
  try {
    await migrate();
    const { client_id, title, description, status, priority, due_date, amount, payment_status, assigned_to } = req.body;
    const { rows } = await pool.query(
      `UPDATE work_items
       SET client_id=$1,title=$2,description=$3,status=$4,priority=$5,due_date=$6,
           amount=$7,payment_status=$8,assigned_to=$9,updated_at=CURRENT_TIMESTAMP
       WHERE id=$10 RETURNING *`,
      [client_id, title.trim(), description||null, status||'pending', priority||'medium',
       due_date||null, amount||null, payment_status||'unpaid', assigned_to||null, req.params.id]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Work item not found' });
    res.json(rows[0]);
  } catch (err) {
    console.error('Error updating work item:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// DELETE work item (admin only)
app.delete('/api/work-items/:id', requireRole(['admin']), async (req, res) => {
  try {
    await migrate();
    const { rows } = await pool.query('DELETE FROM work_items WHERE id=$1 RETURNING id', [req.params.id]);
    if (rows.length === 0) return res.status(404).json({ error: 'Work item not found' });
    res.json({ deleted: true });
  } catch (err) {
    console.error('Error deleting work item:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── Calendar Events ────────────────────────────────────────────────────────────

app.get('/api/calendar-events', async (req, res) => {
  try {
    await migrate();
    const { user_id, work_item_id, start_date, end_date } = req.query;
    let query = `
      SELECT e.*, w.title AS work_item_title, w.client_id
      FROM calendar_events e
      LEFT JOIN work_items w ON w.id = e.work_item_id
      WHERE 1=1
    `;
    const params = [];
    let i = 1;
    if (user_id)      { query += ` AND e.user_id = $${i++}`;       params.push(user_id); }
    if (work_item_id) { query += ` AND e.work_item_id = $${i++}`;  params.push(work_item_id); }
    if (start_date)   { query += ` AND e.event_date >= $${i++}`;   params.push(start_date); }
    if (end_date)     { query += ` AND e.event_date <= $${i++}`;   params.push(end_date); }
    query += ' ORDER BY e.event_date ASC';
    const { rows } = await pool.query(query, params);
    res.json(rows);
  } catch (err) {
    console.error('Error fetching calendar events:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.post('/api/calendar-events', async (req, res) => {
  try {
    await migrate();
    const { work_item_id, user_id, title, description, event_date, event_type, external_calendar_id } = req.body;
    if (!user_id || !title || !event_date)
      return res.status(400).json({ error: 'user_id, title, and event_date are required' });

    const { rows } = await pool.query(
      `INSERT INTO calendar_events (work_item_id,user_id,title,description,event_date,event_type,external_calendar_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [work_item_id||null, user_id, title.trim(), description||null, event_date, event_type||'task', external_calendar_id||null]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    console.error('Error creating calendar event:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.put('/api/calendar-events/:id', async (req, res) => {
  try {
    await migrate();
    const { work_item_id, user_id, title, description, event_date, event_type } = req.body;
    const { rows } = await pool.query(
      `UPDATE calendar_events
       SET work_item_id=$1,user_id=$2,title=$3,description=$4,event_date=$5,event_type=$6
       WHERE id=$7 RETURNING *`,
      [work_item_id||null, user_id, title.trim(), description||null, event_date, event_type||'task', req.params.id]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Event not found' });
    res.json(rows[0]);
  } catch (err) {
    console.error('Error updating calendar event:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.delete('/api/calendar-events/:id', async (req, res) => {
  try {
    await migrate();
    const { rows } = await pool.query('DELETE FROM calendar_events WHERE id=$1 RETURNING id', [req.params.id]);
    if (rows.length === 0) return res.status(404).json({ error: 'Event not found' });
    res.json({ deleted: true });
  } catch (err) {
    console.error('Error deleting calendar event:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── Work Comments ──────────────────────────────────────────────────────────────

app.get('/api/work-comments', async (req, res) => {
  try {
    await migrate();
    const { work_item_id } = req.query;
    let query = `
      SELECT c.*, u.full_name AS user_name FROM work_comments c
      LEFT JOIN users u ON u.id = c.user_id WHERE 1=1
    `;
    const params = [];
    if (work_item_id) { query += ' AND c.work_item_id = $1'; params.push(work_item_id); }
    query += ' ORDER BY c.created_at ASC';
    const { rows } = await pool.query(query, params);
    res.json(rows);
  } catch (err) {
    console.error('Error fetching comments:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.post('/api/work-comments', async (req, res) => {
  try {
    await migrate();
    const { work_item_id, comment } = req.body;
    if (!work_item_id || !comment)
      return res.status(400).json({ error: 'work_item_id and comment are required' });

    const { rows } = await pool.query(
      `INSERT INTO work_comments (work_item_id,user_id,comment) VALUES ($1,$2,$3) RETURNING *`,
      [work_item_id, req.user.id, comment.trim()]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    console.error('Error creating comment:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── Dashboard ──────────────────────────────────────────────────────────────────

app.get('/api/dashboard', async (req, res) => {
  try {
    await migrate();
    const { client_id, start_date, end_date } = req.query;

    let where = 'WHERE 1=1';
    const params = [];
    let i = 1;
    if (client_id)  { where += ` AND w.client_id = $${i++}`;  params.push(client_id); }
    if (start_date) { where += ` AND w.due_date >= $${i++}`;  params.push(start_date); }
    if (end_date)   { where += ` AND w.due_date <= $${i++}`;  params.push(end_date); }

    const [statusRes, paymentRes, overdueRes, recentRes] = await Promise.all([
      pool.query(`SELECT status, COUNT(*) as count FROM work_items ${where} GROUP BY status`, params),
      pool.query(`SELECT
        COALESCE(SUM(amount),0) as total,
        COALESCE(SUM(CASE WHEN payment_status='paid' THEN amount ELSE 0 END),0) as paid,
        COALESCE(SUM(CASE WHEN payment_status!='paid' THEN amount ELSE 0 END),0) as outstanding
        FROM work_items ${where}`, params),
      pool.query(`SELECT w.*, c.name AS client_name, c.slug AS client_slug
        FROM work_items w LEFT JOIN clients c ON c.id=w.client_id
        ${where.replace('WHERE 1=1', "WHERE 1=1 AND w.status!='completed' AND w.due_date<CURRENT_DATE")}
        ORDER BY w.due_date ASC`, params),
      pool.query(`SELECT w.*, c.name AS client_name, c.slug AS client_slug
        FROM work_items w LEFT JOIN clients c ON c.id=w.client_id
        ${where} ORDER BY w.created_at DESC LIMIT 20`, params)
    ]);

    const byStatus = {};
    statusRes.rows.forEach(r => { byStatus[r.status] = parseInt(r.count); });

    res.json({
      byStatus,
      payments: paymentRes.rows[0],
      overdue: overdueRes.rows,
      recent: recentRes.rows
    });
  } catch (err) {
    console.error('Error fetching dashboard:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── Team Members ───────────────────────────────────────────────────────────────

// GET all team members
app.get('/api/team/members', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, full_name, email, phone, role, custom_role, avatar, is_active, created_at
       FROM users ORDER BY created_at DESC`
    );
    res.json(rows);
  } catch (err) {
    console.error('Error fetching team members:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST create team member (admin only)
app.post('/api/team/members', requireRole(['admin']), async (req, res) => {
  try {
    const { full_name, email, phone, role, custom_role, password } = req.body;
    if (!full_name || !email || !role)
      return res.status(400).json({ error: 'Name, email, and role are required' });

    const existing = await pool.query('SELECT id FROM users WHERE email=$1', [email]);
    if (existing.rows.length > 0)
      return res.status(400).json({ error: 'Email already exists' });

    const tempPassword = password || Math.random().toString(36).slice(-8);
    const { rows } = await pool.query(
      `INSERT INTO users (full_name,email,phone,role,custom_role,password_hash)
       VALUES ($1,$2,$3,$4,$5,crypt($6,gen_salt('bf')))
       RETURNING id, full_name, email, phone, role, custom_role, avatar, is_active, created_at`,
      [full_name, email, phone||null, role, custom_role||null, tempPassword]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    console.error('Error creating team member:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT update team member (admin only)
app.put('/api/team/members/:id', requireRole(['admin']), async (req, res) => {
  try {
    const { id } = req.params;
    const { full_name, email, phone, role, custom_role, password } = req.body;
    if (!full_name || !email || !role)
      return res.status(400).json({ error: 'Name, email, and role are required' });

    const existing = await pool.query('SELECT id FROM users WHERE email=$1 AND id!=$2', [email, id]);
    if (existing.rows.length > 0)
      return res.status(400).json({ error: 'Email already exists' });

    let query, params;
    if (password) {
      query = `UPDATE users SET full_name=$1,email=$2,phone=$3,role=$4,custom_role=$5,
               password_hash=crypt($6,gen_salt('bf')) WHERE id=$7
               RETURNING id, full_name, email, phone, role, custom_role, avatar, is_active, created_at`;
      params = [full_name, email, phone||null, role, custom_role||null, password, id];
    } else {
      query = `UPDATE users SET full_name=$1,email=$2,phone=$3,role=$4,custom_role=$5
               WHERE id=$6
               RETURNING id, full_name, email, phone, role, custom_role, avatar, is_active, created_at`;
      params = [full_name, email, phone||null, role, custom_role||null, id];
    }

    const { rows } = await pool.query(query, params);
    if (rows.length === 0) return res.status(404).json({ error: 'Member not found' });
    res.json(rows[0]);
  } catch (err) {
    console.error('Error updating team member:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// DELETE team member (admin only)
app.delete('/api/team/members/:id', requireRole(['admin']), async (req, res) => {
  try {
    const { id } = req.params;
    if (parseInt(id) === req.user.id)
      return res.status(400).json({ error: 'Cannot delete your own account' });

    const { rowCount } = await pool.query('DELETE FROM users WHERE id=$1', [id]);
    if (rowCount === 0) return res.status(404).json({ error: 'Member not found' });
    res.json({ success: true });
  } catch (err) {
    console.error('Error deleting team member:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT toggle member active status (admin only)
app.put('/api/team/members/:id/status', requireRole(['admin']), async (req, res) => {
  try {
    const { is_active } = req.body;
    const { rows } = await pool.query(
      `UPDATE users SET is_active=$1 WHERE id=$2
       RETURNING id, full_name, email, phone, role, custom_role, avatar, is_active, created_at`,
      [is_active, req.params.id]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Member not found' });
    res.json(rows[0]);
  } catch (err) {
    console.error('Error toggling member status:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET workload distribution
app.get('/api/team/workload', async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT u.id AS user_id, u.full_name AS member_name,
        COUNT(w.id) AS task_count,
        COUNT(CASE WHEN w.status='pending'     THEN 1 END) AS pending,
        COUNT(CASE WHEN w.status='in-progress' THEN 1 END) AS in_progress,
        COUNT(CASE WHEN w.status='completed'   THEN 1 END) AS completed
      FROM users u
      LEFT JOIN work_items w ON w.assigned_to = u.id
      WHERE u.role IN ('admin','team')
      GROUP BY u.id, u.full_name
      ORDER BY task_count DESC
    `);
    res.json(rows);
  } catch (err) {
    console.error('Error fetching workload:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── Custom Roles ───────────────────────────────────────────────────────────────

// GET all roles
app.get('/api/roles', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM roles ORDER BY name ASC');
    res.json(rows);
  } catch (err) {
    console.error('Error fetching roles:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST create role (admin only)
app.post('/api/roles', requireRole(['admin']), async (req, res) => {
  try {
    const { name, description, color } = req.body;
    if (!name?.trim()) return res.status(400).json({ error: 'Role name is required' });

    const { rows } = await pool.query(
      `INSERT INTO roles (name,description,color,created_by) VALUES ($1,$2,$3,$4) RETURNING *`,
      [name.trim(), description||null, color||'#4f46e5', req.user.id]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    if (err.code === '23505') return res.status(400).json({ error: 'A role with this name already exists' });
    console.error('Error creating role:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT update role (admin only)
app.put('/api/roles/:id', requireRole(['admin']), async (req, res) => {
  try {
    const { name, description, color } = req.body;
    if (!name?.trim()) return res.status(400).json({ error: 'Role name is required' });

    const { rows } = await pool.query(
      `UPDATE roles SET name=$1,description=$2,color=$3 WHERE id=$4 RETURNING *`,
      [name.trim(), description||null, color||'#4f46e5', req.params.id]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Role not found' });
    res.json(rows[0]);
  } catch (err) {
    if (err.code === '23505') return res.status(400).json({ error: 'A role with this name already exists' });
    console.error('Error updating role:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// DELETE role (admin only)
app.delete('/api/roles/:id', requireRole(['admin']), async (req, res) => {
  try {
    const { id } = req.params;
    await pool.query(
      `UPDATE users SET custom_role=NULL WHERE custom_role=(SELECT name FROM roles WHERE id=$1)`,
      [id]
    );
    const { rowCount } = await pool.query('DELETE FROM roles WHERE id=$1', [id]);
    if (rowCount === 0) return res.status(404).json({ error: 'Role not found' });
    res.json({ success: true });
  } catch (err) {
    console.error('Error deleting role:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ══════════════════════════════════════════════════════════════════════════════
// STATIC FILES  (must come after all API routes)
// ══════════════════════════════════════════════════════════════════════════════

app.use(express.static(PUBLIC_DIR));

app.get('/share/:slug', (req, res) =>
  res.sendFile(path.join(PUBLIC_DIR, 'share.html'))
);

app.get('*', (req, res) =>
  res.sendFile(path.join(PUBLIC_DIR, 'index.html'))
);

// Global error handler
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

// ══════════════════════════════════════════════════════════════════════════════
// START SERVER
// ══════════════════════════════════════════════════════════════════════════════

migrate()
  .then(() => createDefaultAdmin())
  .then(() => {
    app.listen(PORT, () => {
      console.log(`✅ ClientPM running at http://localhost:${PORT}`);
      console.log(`📊 Environment: ${process.env.NODE_ENV || 'development'}`);
      console.log('🔒 Authentication enabled');
    });
  })
  .catch(err => {
    console.error('❌ Failed to initialize:', err);
    process.exit(1);
  });