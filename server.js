// server.js — Unified router for ClientPM
// Single Node.js server serving static HTML/CSS/JS + API endpoints
// With full authentication and role-based access control

require('dotenv').config();

const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const path = require('path');
const { URL } = require('url');
const fs = require('fs');

const { pool, migrate, makeUniqueSlug } = require('./lib/db');
const { logger, errorLogger } = require('./middleware/logger');
const { 
  createUser, 
  createDefaultAdmin,
  authenticateUser, 
  createSession, 
  validateSession, 
  deleteSession,
  getUserById,
  hasRole,
  verifyPassword,
  hashPassword
} = require('./lib/auth');
const { requireAuth, requireRole, optionalAuth } = require('./middleware/auth');

// Redis client setup
const { createClient } = require('redis');
const redisClient = createClient({
  url: process.env.REDIS_URL || 'redis://default:pZlavLQOvIlqmJCzRqCsgqWBhQWXgxPx@localhost:6379'
});

redisClient.on('error', (err) => console.error('Redis Client Error:', err));
redisClient.on('connect', () => console.log('Redis Client Connected'));

// Initialize Redis connection
(async () => {
  try {
    await redisClient.connect();
    console.log('✅ Redis connected successfully');
  } catch (err) {
    console.error('❌ Failed to connect to Redis:', err.message);
    // Continue without Redis for development
  }
})();

const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, 'public');

// CORS configuration
const corsOptions = {
  origin: true,
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
};
const app = express();

// ============ MIDDLEWARE ============

// Parse JSON bodies
app.use(express.json());

// Parse cookies
app.use(cookieParser());

// Enable CORS for development
app.use(cors({
  origin: process.env.NODE_ENV === 'production' ? process.env.APP_URL : 'http://localhost:3000',
  credentials: true
}));

// ============ DATABASE INITIALIZATION ============

// Initialize database connection and run migrations on startup
if (process.env.NODE_ENV === 'production') {
  migrate().catch(err => {
    console.error('Failed to run migrations:', err);
    process.exit(1);
  });
}

// ============ AUTH ROUTES (Public) ============

// Login
app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    
    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }
    
    const user = await authenticateUser(email, password);
    if (!user) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }
    
    const token = await createSession(user.id);
    
    res.cookie('session_token', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 7 * 24 * 60 * 60 * 1000 // 7 days
    });
    
    res.json({
      id: user.id,
      email: user.email,
      fullName: user.full_name,
      role: user.role
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Signup
app.post('/api/auth/signup', async (req, res) => {
  try {
    const { fullName, email, password, role } = req.body;
    
    if (!fullName || !email || !password) {
      return res.status(400).json({ error: 'Full name, email, and password are required' });
    }
    
    if (password.length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters' });
    }
    
    if (role && !['admin', 'team', 'client'].includes(role)) {
      return res.status(400).json({ error: 'Invalid role' });
    }
    
    const user = await createUser(email, password, fullName, role || 'team');
    const token = await createSession(user.id);
    
    res.cookie('session_token', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 7 * 24 * 60 * 60 * 1000
    });
    
    res.status(201).json({
      id: user.id,
      email: user.email,
      fullName: user.full_name,
      role: user.role
    });
  } catch (error) {
    console.error('Signup error:', error);
    if (error.code === '23505' && error.constraint === 'users_email_key') {
      return res.status(400).json({ error: 'Email already registered' });
    }
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get current user (auto-login check)
app.get('/api/auth/me', async (req, res) => {
  try {
    const token = req.cookies.session_token;
    
    if (!token) {
      return res.status(401).json({ error: 'Not authenticated' });
    }
    
    const user = await validateSession(token);
    if (!user) {
      res.clearCookie('session_token');
      return res.status(401).json({ error: 'Invalid or expired session' });
    }
    
    res.json({
      id: user.id,
      email: user.email,
      fullName: user.fullName,
      role: user.role
    });
  } catch (error) {
    console.error('Auth check error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Logout
app.post('/api/auth/logout', async (req, res) => {
  try {
    const token = req.cookies.session_token;
    if (token) {
      await deleteSession(token);
    }
    res.clearCookie('session_token');
    res.json({ success: true });
  } catch (error) {
    console.error('Logout error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Change password
app.post('/api/auth/change-password', requireAuth, async (req, res) => {
  try {
    const { current_password, new_password } = req.body;
    
    if (!current_password || !new_password) {
      return res.status(400).json({ error: 'Current password and new password are required' });
    }
    
    if (new_password.length < 6) {
      return res.status(400).json({ error: 'New password must be at least 6 characters' });
    }
    
    // Get current user's password hash
    const { rows } = await pool.query(
      'SELECT password_hash FROM users WHERE id = $1',
      [req.user.id]
    );
    
    if (rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    const user = rows[0];
    
    // Verify current password
    const isValid = await verifyPassword(current_password, user.password_hash);
    if (!isValid) {
      return res.status(401).json({ error: 'Current password is incorrect' });
    }
    
    // Hash new password
    const newPasswordHash = await hashPassword(new_password);
    
    // Update password
    await pool.query(
      'UPDATE users SET password_hash = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2',
      [newPasswordHash, req.user.id]
    );
    
    res.json({ success: true, message: 'Password changed successfully' });
  } catch (error) {
    console.error('Change password error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ============ PROTECTED API ROUTES ============

// All API routes below require authentication
app.use('/api/*', requireAuth);

// Get all clients
app.get('/api/clients', async (req, res) => {
  try {
    await migrate();
    const { rows } = await pool.query('SELECT * FROM clients ORDER BY created_at DESC');
    res.json(rows);
  } catch (error) {
    console.error('Error fetching clients:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Create client
app.post('/api/clients', async (req, res) => {
  try {
    await migrate();
    const { name, email, phone, company, address, notes } = req.body;
    
    if (!name || !name.trim()) {
      return res.status(400).json({ error: 'Name is required' });
    }
    
    const slug = await makeUniqueSlug(name);
    const { rows } = await pool.query(
      `INSERT INTO clients (name, email, phone, company, address, notes, slug, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
      [name.trim(), email || null, phone || null, company || null, address || null, notes || null, slug, req.user.id]
    );
    res.status(201).json(rows[0]);
  } catch (error) {
    console.error('Error creating client:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get single client
app.get('/api/clients/:id', async (req, res) => {
  try {
    await migrate();
    const { id } = req.params;
    const { rows } = await pool.query('SELECT * FROM clients WHERE id = $1', [id]);
    
    if (rows.length === 0) {
      return res.status(404).json({ error: 'Client not found' });
    }
    res.json(rows[0]);
  } catch (error) {
    console.error('Error fetching client:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Update client
app.put('/api/clients/:id', async (req, res) => {
  try {
    await migrate();
    const { id } = req.params;
    const { name, email, phone, company, address, notes } = req.body;
    
    if (!name || !name.trim()) {
      return res.status(400).json({ error: 'Name is required' });
    }
    
    const { rows } = await pool.query(
      `UPDATE clients 
       SET name=$1, email=$2, phone=$3, company=$4, address=$5, notes=$6, updated_at=CURRENT_TIMESTAMP
       WHERE id=$7 RETURNING *`,
      [name.trim(), email || null, phone || null, company || null, address || null, notes || null, id]
    );
    
    if (rows.length === 0) {
      return res.status(404).json({ error: 'Client not found' });
    }
    res.json(rows[0]);
  } catch (error) {
    console.error('Error updating client:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Delete client (requires admin)
app.delete('/api/clients/:id', requireRole(['admin']), async (req, res) => {
  try {
    await migrate();
    const { id } = req.params;
    const { rows } = await pool.query('DELETE FROM clients WHERE id=$1 RETURNING id', [id]);
    
    if (rows.length === 0) {
      return res.status(404).json({ error: 'Client not found' });
    }
    res.json({ deleted: true });
  } catch (error) {
    console.error('Error deleting client:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get all work items
app.get('/api/work-items', async (req, res) => {
  try {
    await migrate();
    const { client_id, status, payment_status } = req.query;
    
    let query = `
      SELECT w.*, c.name AS client_name, c.slug AS client_slug
      FROM work_items w
      LEFT JOIN clients c ON c.id = w.client_id
      WHERE 1=1
    `;
    const params = [];
    let paramIndex = 1;
    
    if (client_id) {
      query += ` AND w.client_id = $${paramIndex}`;
      params.push(client_id);
      paramIndex++;
    }
    if (status) {
      query += ` AND w.status = $${paramIndex}`;
      params.push(status);
      paramIndex++;
    }
    if (payment_status) {
      query += ` AND w.payment_status = $${paramIndex}`;
      params.push(payment_status);
      paramIndex++;
    }
    
    query += ' ORDER BY w.due_date ASC NULLS LAST, w.created_at DESC';
    
    const { rows } = await pool.query(query, params);
    res.json(rows);
  } catch (error) {
    console.error('Error fetching work items:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Create work item
app.post('/api/work-items', async (req, res) => {
  try {
    await migrate();
    const { client_id, title, description, status, priority, due_date, amount, payment_status, assigned_to } = req.body;
    
    if (!client_id || !title) {
      return res.status(400).json({ error: 'client_id and title are required' });
    }
    
    const { rows } = await pool.query(
      `INSERT INTO work_items (client_id, title, description, status, priority, due_date, amount, payment_status, assigned_to, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING *`,
      [client_id, title.trim(), description || null, status || 'pending', priority || 'medium', due_date || null, amount || null, payment_status || 'unpaid', assigned_to || null, req.user.id]
    );
    res.status(201).json(rows[0]);
  } catch (error) {
    console.error('Error creating work item:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get single work item
app.get('/api/work-items/:id', async (req, res) => {
  try {
    await migrate();
    const { id } = req.params;
    const { rows } = await pool.query(
      `SELECT w.*, c.name AS client_name, c.slug AS client_slug
       FROM work_items w
       LEFT JOIN clients c ON c.id = w.client_id
       WHERE w.id = $1`,
      [id]
    );
    
    if (rows.length === 0) {
      return res.status(404).json({ error: 'Work item not found' });
    }
    res.json(rows[0]);
  } catch (error) {
    console.error('Error fetching work item:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Update work item
app.put('/api/work-items/:id', async (req, res) => {
  try {
    await migrate();
    const { id } = req.params;
    const { client_id, title, description, status, priority, due_date, amount, payment_status, assigned_to } = req.body;
    
    const { rows } = await pool.query(
      `UPDATE work_items 
       SET client_id=$1, title=$2, description=$3, status=$4, priority=$5, due_date=$6, amount=$7, payment_status=$8, assigned_to=$9, updated_at=CURRENT_TIMESTAMP
       WHERE id=$10 RETURNING *`,
      [client_id, title.trim(), description || null, status || 'pending', priority || 'medium', due_date || null, amount || null, payment_status || 'unpaid', assigned_to || null, id]
    );
    
    if (rows.length === 0) {
      return res.status(404).json({ error: 'Work item not found' });
    }
    res.json(rows[0]);
  } catch (error) {
    console.error('Error updating work item:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Delete work item (requires admin)
app.delete('/api/work-items/:id', requireRole(['admin']), async (req, res) => {
  try {
    await migrate();
    const { id } = req.params;
    const { rows } = await pool.query('DELETE FROM work_items WHERE id=$1 RETURNING id', [id]);
    
    if (rows.length === 0) {
      return res.status(404).json({ error: 'Work item not found' });
    }
    res.json({ deleted: true });
  } catch (error) {
    console.error('Error deleting work item:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get calendar events
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
    let paramIndex = 1;
    
    if (user_id) {
      query += ` AND e.user_id = $${paramIndex}`;
      params.push(user_id);
      paramIndex++;
    }
    if (work_item_id) {
      query += ` AND e.work_item_id = $${paramIndex}`;
      params.push(work_item_id);
      paramIndex++;
    }
    if (start_date) {
      query += ` AND e.event_date >= $${paramIndex}`;
      params.push(start_date);
      paramIndex++;
    }
    if (end_date) {
      query += ` AND e.event_date <= $${paramIndex}`;
      params.push(end_date);
      paramIndex++;
    }
    
    query += ' ORDER BY e.event_date ASC';
    
    const { rows } = await pool.query(query, params);
    res.json(rows);
  } catch (error) {
    console.error('Error fetching calendar events:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Create calendar event
app.post('/api/calendar-events', async (req, res) => {
  try {
    await migrate();
    const { work_item_id, user_id, title, description, event_date, event_type, external_calendar_id } = req.body;
    
    if (!user_id || !title || !event_date) {
      return res.status(400).json({ error: 'user_id, title, and event_date are required' });
    }
    
    const { rows } = await pool.query(
      `INSERT INTO calendar_events (work_item_id, user_id, title, description, event_date, event_type, external_calendar_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
      [work_item_id || null, user_id, title.trim(), description || null, event_date, event_type || 'task', external_calendar_id || null]
    );
    res.status(201).json(rows[0]);
  } catch (error) {
    console.error('Error creating calendar event:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Update calendar event
app.put('/api/calendar-events/:id', async (req, res) => {
  try {
    await migrate();
    const { id } = req.params;
    const { work_item_id, user_id, title, description, event_date, event_type } = req.body;
    
    const { rows } = await pool.query(
      `UPDATE calendar_events 
       SET work_item_id=$1, user_id=$2, title=$3, description=$4, event_date=$5, event_type=$6
       WHERE id=$7 RETURNING *`,
      [work_item_id || null, user_id, title.trim(), description || null, event_date, event_type || 'task', id]
    );
    
    if (rows.length === 0) {
      return res.status(404).json({ error: 'Event not found' });
    }
    res.json(rows[0]);
  } catch (error) {
    console.error('Error updating calendar event:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Delete calendar event
app.delete('/api/calendar-events/:id', async (req, res) => {
  try {
    await migrate();
    const { id } = req.params;
    const { rows } = await pool.query('DELETE FROM calendar_events WHERE id=$1 RETURNING id', [id]);
    
    if (rows.length === 0) {
      return res.status(404).json({ error: 'Event not found' });
    }
    res.json({ deleted: true });
  } catch (error) {
    console.error('Error deleting calendar event:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get work comments
app.get('/api/work-comments', async (req, res) => {
  try {
    await migrate();
    const { work_item_id } = req.query;
    
    let query = `
      SELECT c.*, u.full_name AS user_name
      FROM work_comments c
      LEFT JOIN users u ON u.id = c.user_id
      WHERE 1=1
    `;
    const params = [];
    
    if (work_item_id) {
      query += ' AND c.work_item_id = $1';
      params.push(work_item_id);
    }
    
    query += ' ORDER BY c.created_at ASC';
    
    const { rows } = await pool.query(query, params);
    res.json(rows);
  } catch (error) {
    console.error('Error fetching comments:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Create work comment
app.post('/api/work-comments', async (req, res) => {
  try {
    await migrate();
    const { work_item_id, comment } = req.body;
    
    if (!work_item_id || !comment) {
      return res.status(400).json({ error: 'work_item_id and comment are required' });
    }
    
    const { rows } = await pool.query(
      `INSERT INTO work_comments (work_item_id, user_id, comment) VALUES ($1, $2, $3) RETURNING *`,
      [work_item_id, req.user.id, comment.trim()]
    );
    res.status(201).json(rows[0]);
  } catch (error) {
    console.error('Error creating comment:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Dashboard stats
app.get('/api/dashboard', async (req, res) => {
  try {
    await migrate();
    const { client_id, start_date, end_date } = req.query;
    
    let whereClause = 'WHERE 1=1';
    const params = [];
    let paramIndex = 1;
    
    if (client_id) {
      whereClause += ` AND w.client_id = $${paramIndex}`;
      params.push(client_id);
      paramIndex++;
    }
    if (start_date) {
      whereClause += ` AND w.due_date >= $${paramIndex}`;
      params.push(start_date);
      paramIndex++;
    }
    if (end_date) {
      whereClause += ` AND w.due_date <= $${paramIndex}`;
      params.push(end_date);
      paramIndex++;
    }
    
    // Get task counts by status
    const statusQuery = `
      SELECT status, COUNT(*) as count
      FROM work_items ${whereClause}
      GROUP BY status
    `;
    const { rows: statusRows } = await pool.query(statusQuery, params);
    
    // Get payment totals
    const paymentQuery = `
      SELECT 
        COALESCE(SUM(amount), 0) as total,
        COALESCE(SUM(CASE WHEN payment_status = 'paid' THEN amount ELSE 0 END), 0) as paid,
        COALESCE(SUM(CASE WHEN payment_status != 'paid' THEN amount ELSE 0 END), 0) as outstanding
      FROM work_items ${whereClause}
    `;
    const { rows: paymentRows } = await pool.query(paymentQuery, params);
    
    // Get overdue tasks
    const overdueQuery = `
      SELECT w.*, c.name AS client_name, c.slug AS client_slug
      FROM work_items w
      LEFT JOIN clients c ON c.id = w.client_id
      ${whereClause.replace('WHERE 1=1', 'WHERE 1=1 AND w.status != \'completed\' AND w.due_date < CURRENT_DATE')}
      ORDER BY w.due_date ASC
    `;
    const { rows: overdueRows } = await pool.query(overdueQuery, params);
    
    // Get recent tasks
    const recentQuery = `
      SELECT w.*, c.name AS client_name, c.slug AS client_slug
      FROM work_items w
      LEFT JOIN clients c ON c.id = w.client_id
      ${whereClause}
      ORDER BY w.created_at DESC
      LIMIT 20
    `;
    const { rows: recentRows } = await pool.query(recentQuery, params);
    
    const stats = {
      byStatus: {},
      payments: paymentRows[0],
      overdue: overdueRows,
      recent: recentRows
    };
    
    statusRows.forEach(row => {
      stats.byStatus[row.status] = parseInt(row.count);
    });
    
    res.json(stats);
  } catch (error) {
    console.error('Error fetching dashboard:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Share link (public client view - no auth required)
app.get('/api/share/:slug', optionalAuth, async (req, res) => {
  try {
    await migrate();
    const { slug } = req.params;
    const { start_date, end_date, status } = req.query;
    
    // Get client by slug
    const { rows: clientRows } = await pool.query(
      'SELECT * FROM clients WHERE slug = $1',
      [slug]
    );
    
    if (clientRows.length === 0) {
      return res.status(404).json({ error: 'Client not found' });
    }
    
    const client = clientRows[0];
    
    // Build query for work items
    let query = `
      SELECT * FROM work_items
      WHERE client_id = $1
    `;
    const params = [client.id];
    let paramIndex = 2;
    
    if (start_date) {
      query += ` AND due_date >= $${paramIndex}`;
      params.push(start_date);
      paramIndex++;
    }
    if (end_date) {
      query += ` AND due_date <= $${paramIndex}`;
      params.push(end_date);
      paramIndex++;
    }
    if (status) {
      query += ` AND status = $${paramIndex}`;
      params.push(status);
      paramIndex++;
    }
    
    query += ' ORDER BY due_date ASC NULLS LAST, created_at DESC';
    
    const { rows: workItems } = await pool.query(query, params);
    
    // Calculate payment summary
    const summary = {
      total: 0,
      paid: 0,
      partial: 0,
      unpaid: 0
    };
    
    workItems.forEach(item => {
      const amount = Number(item.amount) || 0;
      summary.total += amount;
      if (item.payment_status === 'paid') {
        summary.paid += amount;
      } else if (item.payment_status === 'partial') {
        summary.partial += amount;
      } else {
        summary.unpaid += amount;
      }
    });
    
    res.json({
      client,
      workItems,
      summary
    });
  } catch (error) {
    console.error('Error fetching share data:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ============ TEAM MANAGEMENT API ============

// Get all team members
app.get('/api/team/members', requireAuth, async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT id, full_name, email, phone, role, avatar, is_active, created_at FROM users ORDER BY created_at DESC'
    );
    res.json(rows);
  } catch (error) {
    console.error('Error fetching team members:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Create new team member
app.post('/api/team/members', requireRole(['admin']), async (req, res) => {
  try {
    const { full_name, email, phone, role, password } = req.body;
    
    if (!full_name || !email || !role) {
      return res.status(400).json({ error: 'Name, email, and role are required' });
    }
    
    // Check if email already exists
    const existing = await pool.query('SELECT id FROM users WHERE email = $1', [email]);
    if (existing.rows.length > 0) {
      return res.status(400).json({ error: 'Email already exists' });
    }
    
    const tempPassword = password || Math.random().toString(36).slice(-8);
    
    const { rows } = await pool.query(
      `INSERT INTO users (full_name, email, phone, role, password_hash)
       VALUES ($1, $2, $3, $4, crypt($5, gen_salt('bf')))
       RETURNING id, full_name, email, phone, role, avatar, is_active, created_at`,
      [full_name, email, phone || null, role, tempPassword]
    );
    
    res.status(201).json(rows[0]);
  } catch (error) {
    console.error('Error creating team member:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Update team member
app.put('/api/team/members/:id', requireRole(['admin']), async (req, res) => {
  try {
    const { id } = req.params;
    const { full_name, email, phone, role, password } = req.body;
    
    if (!full_name || !email || !role) {
      return res.status(400).json({ error: 'Name, email, and role are required' });
    }
    
    // Check if email is taken by another user
    const existing = await pool.query('SELECT id FROM users WHERE email = $1 AND id != $2', [email, id]);
    if (existing.rows.length > 0) {
      return res.status(400).json({ error: 'Email already exists' });
    }
    
    let query;
    let params;
    
    if (password) {
      query = `
        UPDATE users 
        SET full_name = $1, email = $2, phone = $3, role = $4, password_hash = crypt($5, gen_salt('bf'))
        WHERE id = $6
        RETURNING id, full_name, email, phone, role, avatar, is_active, created_at
      `;
      params = [full_name, email, phone || null, role, password, id];
    } else {
      query = `
        UPDATE users 
        SET full_name = $1, email = $2, phone = $3, role = $4
        WHERE id = $5
        RETURNING id, full_name, email, phone, role, avatar, is_active, created_at
      `;
      params = [full_name, email, phone || null, role, id];
    }
    
    const { rows } = await pool.query(query, params);
    
    if (rows.length === 0) {
      return res.status(404).json({ error: 'Member not found' });
    }
    
    res.json(rows[0]);
  } catch (error) {
    console.error('Error updating team member:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Delete team member
app.delete('/api/team/members/:id', requireRole(['admin']), async (req, res) => {
  try {
    const { id } = req.params;
    
    // Prevent deleting yourself
    if (id === req.user.id) {
      return res.status(400).json({ error: 'Cannot delete your own account' });
    }
    
    const { rowCount } = await pool.query('DELETE FROM users WHERE id = $1', [id]);
    
    if (rowCount === 0) {
      return res.status(404).json({ error: 'Member not found' });
    }
    
    res.json({ success: true });
  } catch (error) {
    console.error('Error deleting team member:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Toggle member status
app.put('/api/team/members/:id/status', requireRole(['admin']), async (req, res) => {
  try {
    const { id } = req.params;
    const { is_active } = req.body;
    
    const { rows } = await pool.query(
      'UPDATE users SET is_active = $1 WHERE id = $2 RETURNING id, full_name, email, phone, role, avatar, is_active, created_at',
      [is_active, id]
    );
    
    if (rows.length === 0) {
      return res.status(404).json({ error: 'Member not found' });
    }
    
    res.json(rows[0]);
  } catch (error) {
    console.error('Error toggling member status:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get workload distribution
app.get('/api/team/workload', requireAuth, async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT 
        u.id AS user_id,
        u.full_name AS member_name,
        COUNT(w.id) AS task_count,
        COUNT(CASE WHEN w.status = 'pending' THEN 1 END) AS pending,
        COUNT(CASE WHEN w.status = 'in-progress' THEN 1 END) AS in_progress,
        COUNT(CASE WHEN w.status = 'completed' THEN 1 END) AS completed
      FROM users u
      LEFT JOIN work_items w ON w.assigned_to = u.id
      WHERE u.role IN ('admin', 'team')
      GROUP BY u.id, u.full_name
      ORDER BY task_count DESC
    `);
    
    res.json(rows);
  } catch (error) {
    console.error('Error fetching workload:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Share link (public client view - no auth required)
app.get('/api/share/:slug', optionalAuth, async (req, res) => {
  try {
    await migrate();
    const { slug } = req.params;
    const { start_date, end_date, status } = req.query;
    
    // Get client by slug
    const { rows: clientRows } = await pool.query('SELECT * FROM clients WHERE slug = $1', [slug]);
    if (clientRows.length === 0) {
      return res.status(404).json({ error: 'Client not found' });
    }
    const client = clientRows[0];
    
    // Build query for work items
    let query = `
      SELECT * FROM work_items
      WHERE client_id = $1
    `;
    const params = [client.id];
    let paramIndex = 2;
    
    if (start_date) {
      query += ` AND due_date >= $${paramIndex}`;
      params.push(start_date);
      paramIndex++;
    }
    if (end_date) {
      query += ` AND due_date <= $${paramIndex}`;
      params.push(end_date);
      paramIndex++;
    }
    if (status) {
      query += ` AND status = $${paramIndex}`;
      params.push(status);
      paramIndex++;
    }
    
    query += ' ORDER BY due_date ASC NULLS LAST, created_at DESC';
    
    const { rows: workItems } = await pool.query(query, params);
    
    // Calculate payment summary
    const summary = {
      total: 0,
      paid: 0,
      partial: 0,
      unpaid: 0
    };
    
    workItems.forEach(item => {
      const amount = Number(item.amount) || 0;
      summary.total += amount;
      if (item.payment_status === 'paid') {
        summary.paid += amount;
      } else if (item.payment_status === 'partial') {
        summary.partial += amount;
      } else {
        summary.unpaid += amount;
      }
    });
    
    res.json({
      client,
      workItems,
      summary
    });
  } catch (error) {
    console.error('Error fetching share data:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ============ STATIC FILE SERVING ============

// Serve static files
app.use(express.static(PUBLIC_DIR));

// Serve share.html for /share/:slug routes
app.get('/share/:slug', (req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, 'share.html'));
});

// For SPA routing - all other routes serve index.html
app.get('*', (req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, 'index.html'));
});

// ============ ERROR HANDLING ============

// Global error handler
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

// ============ START SERVER ============

// Ensure database migrations run before starting
migrate()
  .then(() => createDefaultAdmin())
  .then(() => {
    app.listen(PORT, () => {
      console.log(`✅ ClientPM server running at http://localhost:${PORT}`);
      console.log(`📊 Environment: ${process.env.NODE_ENV || 'development'}`);
      console.log('🔒 Authentication enabled');
      console.log('Press Ctrl+C to stop');
    });
  })
  .catch(err => {
    console.error('❌ Failed to initialize database:', err);
    process.exit(1);
  });
