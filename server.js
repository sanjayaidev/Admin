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
  createOrganization,
  getOrganizationById,
  getOrganizationBySlug,
  createDefaultAdmin,
  authenticateUser,
  createSession,
  validateSession,
  deleteSession,
  verifyPassword,
  hashPassword,
  createOrgJoinRequest,
  getPendingJoinRequests,
  updateJoinRequestStatus,
  getUserPendingJoinRequest
} = require('./lib/auth');
const { requireAuth, requireRole, requireAdmin, optionalAuth } = require('./middleware/auth');
const {
  createInvoiceFromTasks,
  updateInvoiceDraft,
  calculateTotals,
  getInvoiceDetails,
  generateInvoiceHTML,
  markInvoicePaid
} = require('./lib/payment/invoice');
const { createShareLink, listShareLinks, revokeShareLink, resolveShareToken } = require('./lib/shareLinks');
const rateLimit = require('express-rate-limit');

// ── Google Modules Integration (Flow Builder) ─────────────────────────────────
// Mount the modules API routes for Gmail, Calendar, Sheets, Docs, Drive, Forms, GBP
// These routes are protected by requireAuth middleware above
const oauthRouter = require('./src/routes/oauth');
const connectionsRouter = require('./src/routes/connections');
const webhooksRouter = require('./src/routes/webhooks');
const actionRouter = require('./src/routes/actionRouter');

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

// Slows down credential stuffing / brute-force login attempts. Keyed by IP
// since these routes run before a session exists.
const authRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many attempts. Please try again later.' }
});

// The public client-dashboard share endpoint has no login wall by design,
// so it gets its own (more generous, since a real client may refresh a lot)
// limiter to slow down anyone trying to brute-force share tokens.
const shareRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests. Please try again later.' }
});

// ══════════════════════════════════════════════════════════════════════════════
// AUTH ROUTES  (public — no requireAuth)
// ══════════════════════════════════════════════════════════════════════════════

// Login
app.post('/api/auth/login', authRateLimiter, async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password)
      return res.status(400).json({ error: 'Email and password are required' });

    const result = await authenticateUser(email, password);

    if (result.status === 'invalid')
      return res.status(401).json({ error: 'Invalid email or password' });

    if (result.status === 'pending_activation')
      return res.status(403).json({
        error: 'Your account is pending activation by an admin. Please contact your organization admin.',
        code: 'PENDING_ACTIVATION'
      });

    const user = result.user;
    const token = await createSession(user.id);
    res.cookie('session_token', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 7 * 24 * 60 * 60 * 1000
    });
    res.json({ id: user.id, email: user.email, fullName: user.full_name, role: user.role, token });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Signup - Two paths: Create Org (Admin) or Join Org (Team, pending approval)
app.post('/api/auth/signup', authRateLimiter, async (req, res) => {
  try {
    const { fullName, email, password, orgId, orgSlug, orgName, mode } = req.body;
    if (!fullName || !email || !password)
      return res.status(400).json({ error: 'Full name, email, and password are required' });
    if (password.length < 6)
      return res.status(400).json({ error: 'Password must be at least 6 characters' });

    // Check if user already exists
    const existingUser = await pool.query('SELECT id FROM users WHERE email = $1', [email]);
    if (existingUser.rows.length > 0)
      return res.status(400).json({ error: 'Email already registered' });

    let user, org;

    // Determine intent explicitly from `mode` (sent by the signup form) rather
    // than inferring it from whether orgId/orgSlug happen to be filled in.
    // Previously, filling in the *optional* "Organization ID" field on the
    // "Create Organization" form was enough to make the server treat the
    // signup as a "join existing org" request, silently creating the user as
    // an inactive team member instead of an active admin.
    const isJoin = mode === 'join' || (!mode && (orgSlug || (orgId && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(orgId))));

    // Path 1: Join existing organization (team member)
    if (isJoin) {
      // Find the organization - always use orgSlug for lookup when joining
      // orgId should only be used if it's a valid UUID
      if (orgSlug) {
        org = await getOrganizationBySlug(orgSlug);
        if (!org) return res.status(404).json({ error: 'Organization not found' });
      } else if (orgId) {
        // Only use orgId if it's provided and valid (UUID format)
        // Validate UUID format before querying
        const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
        if (!uuidRegex.test(orgId)) {
          // If orgId is not a UUID, treat it as a slug
          org = await getOrganizationBySlug(orgId);
        } else {
          org = await getOrganizationById(orgId);
        }
        if (!org) return res.status(404).json({ error: 'Organization not found' });
      }

      // Create user as inactive team member
      user = await createUser(email, password, fullName, 'team', org.id, false);

      // Create join request (pending approval)
      const joinRequest = await createOrgJoinRequest(org.id, user.id, email, fullName);

      const token = await createSession(user.id);
      res.cookie('session_token', token, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        maxAge: 7 * 24 * 60 * 60 * 1000
      });

      return res.status(201).json({
        id: user.id,
        email: user.email,
        fullName: user.full_name,
        role: user.role,
        orgId: user.org_id,
        orgName: org.name,
        isActive: user.is_active,
        pendingApproval: true,
        token
      });
    }

    // Path 2: Create new organization (becomes admin immediately)
    // orgName contains the organization name, orgId is optional custom ID (must be valid UUID)
    const finalOrgName = orgName || (fullName + "'s Organization");
    
    // Generate the slug that would be used for this organization
    const generatedSlug = finalOrgName.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') || 'org';
    
    // Check if the slug is already taken before attempting to create the organization
    const existingOrg = await getOrganizationBySlug(generatedSlug);
    if (existingOrg) {
      return res.status(400).json({ 
        error: 'Organization name is already taken',
        detail: `An organization with a similar name already exists. Please choose a different organization name or try adding numbers or modifiers (e.g., "${finalOrgName} Inc", "${finalOrgName} LLC").`,
        suggestedNames: [`${finalOrgName} Inc`, `${finalOrgName} LLC`, `${finalOrgName} Co`, `${finalOrgName} ${Math.floor(Math.random() * 100)}`]
      });
    }
    
    // Only pass orgId if it's explicitly provided and is a valid UUID
    let newOrg;
    if (orgId) {
      const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      if (uuidRegex.test(orgId)) {
        newOrg = await createOrganization(finalOrgName, orgId);
      } else {
        // If orgId is not a valid UUID, ignore it and auto-generate
        newOrg = await createOrganization(finalOrgName);
      }
    } else {
      newOrg = await createOrganization(finalOrgName);
    }
    org = newOrg;
    user = await createUser(email, password, fullName, 'admin', org.id, true);

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
      role: user.role,
      orgId: user.org_id,
      orgName: org.name,
      isActive: true,
      isNewOrg: true,
      token
    });
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
    // Get organization name for the user
    let orgName = null;
    let orgSlug = null;
    if (user.orgId) {
      const org = await getOrganizationById(user.orgId);
      orgName = org ? org.name : null;
      orgSlug = org ? org.slug : null;
    }
    res.json({ id: user.id, email: user.email, fullName: user.fullName, role: user.role, orgId: user.orgId, orgSlug, orgName });
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

// Validate organization ID (for join mode)
app.get('/api/auth/validate-org', async (req, res) => {
  try {
    const orgId = req.query.id;
    if (!orgId) {
      return res.status(400).json({ error: 'Organization ID is required' });
    }
    
    // Check if it's a UUID or slug format
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(orgId);
    
    let org;
    if (isUuid) {
      org = await getOrganizationById(orgId);
    } else {
      org = await getOrganizationBySlug(orgId);
    }
    
    if (org) {
      res.json({ valid: true, orgId: org.id, orgName: org.name, slug: org.slug });
    } else {
      res.status(404).json({ valid: false, error: 'Organization not found' });
    }
  } catch (err) {
    console.error('Validate org error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Validate organization slug (for join mode using slug)
app.get('/api/auth/validate-org-slug', async (req, res) => {
  try {
    const orgSlug = req.query.slug;
    if (!orgSlug) {
      return res.status(400).json({ error: 'Organization slug is required' });
    }
    
    const org = await getOrganizationBySlug(orgSlug);
    
    if (org) {
      res.json({ valid: true, orgId: org.id, orgName: org.name, slug: org.slug });
    } else {
      res.status(404).json({ valid: false, error: 'Organization not found' });
    }
  } catch (err) {
    console.error('Validate org slug error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Client dashboard share link — public, no auth (must be before requireAuth
// middleware below). Access is gated entirely by possession of a
// high-entropy token (see lib/shareLinks.js), not by guessing a client's
// name-derived slug. The token resolves to exactly one org+client pair, so
// no query parameter can widen access to other clients or organizations.
// This endpoint is intentionally read-only: no route exists that accepts a
// share token and mutates anything.
app.get('/api/public/share/:token', shareRateLimiter, async (req, res) => {
  try {
    await migrate();
    const resolved = await resolveShareToken(req.params.token);
    if (!resolved) return res.status(404).json({ error: 'This share link is invalid, expired, or has been revoked.' });
    const { orgId, clientId } = resolved;

    const { rows: clientRows } = await pool.query(
      'SELECT id, name, email, phone, company FROM clients WHERE id = $1 AND org_id = $2',
      [clientId, orgId]
    );
    if (clientRows.length === 0) return res.status(404).json({ error: 'Client not found' });
    const client = clientRows[0];

    const { start_date, end_date, status } = req.query;
    let query = `
      SELECT id, title, description, status, priority, due_date, amount, payment_status, created_at
      FROM work_items WHERE client_id = $1 AND org_id = $2
    `;
    const params = [clientId, orgId];
    let i = 3;
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

// ── Google Modules Integration Routes ─────────────────────────────────────────
// These routes use session auth from requireAuth above
app.use('/api/oauth', oauthRouter);
app.use('/api/connections', connectionsRouter);
app.use('/api/webhooks', webhooksRouter);
app.use('/api/actions', actionRouter);

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
// Admin-only: team members are scoped to viewing their own assigned tasks
// and calendar events only (see Work Items / Calendar Events below), and do
// not get client-management access.

// GET all clients (org scoped)
app.get('/api/clients', requireRole(['admin']), async (req, res) => {
  try {
    await migrate();
    const { rows } = await pool.query(
      'SELECT * FROM clients WHERE org_id = $1 ORDER BY created_at DESC',
      [req.user.org_id]
    );
    res.json(rows);
  } catch (err) {
    console.error('Error fetching clients:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST create client
app.post('/api/clients', requireRole(['admin']), async (req, res) => {
  try {
    await migrate();
    const { name, email, phone, company, address, notes } = req.body;
    if (!name?.trim()) return res.status(400).json({ error: 'Name is required' });

    const slug = await makeUniqueSlug(name);
    const { rows } = await pool.query(
      `INSERT INTO clients (name, email, phone, company, address, notes, slug, created_by, org_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
      [name.trim(), email||null, phone||null, company||null, address||null, notes||null, slug, req.user.id, req.user.org_id]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    console.error('Error creating client:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET single client (org scoped)
app.get('/api/clients/:id', requireRole(['admin']), async (req, res) => {
  try {
    await migrate();
    const { rows } = await pool.query('SELECT * FROM clients WHERE id=$1 AND org_id=$2', [req.params.id, req.user.org_id]);
    if (rows.length === 0) return res.status(404).json({ error: 'Client not found' });
    res.json(rows[0]);
  } catch (err) {
    console.error('Error fetching client:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT update client (org scoped)
app.put('/api/clients/:id', requireRole(['admin']), async (req, res) => {
  try {
    await migrate();
    const { name, email, phone, company, address, notes } = req.body;
    if (!name?.trim()) return res.status(400).json({ error: 'Name is required' });

    const { rows } = await pool.query(
      `UPDATE clients SET name=$1,email=$2,phone=$3,company=$4,address=$5,notes=$6,updated_at=CURRENT_TIMESTAMP
       WHERE id=$7 AND org_id=$8 RETURNING *`,
      [name.trim(), email||null, phone||null, company||null, address||null, notes||null, req.params.id, req.user.org_id]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Client not found' });
    res.json(rows[0]);
  } catch (err) {
    console.error('Error updating client:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// DELETE client (admin only, org scoped)
app.delete('/api/clients/:id', requireRole(['admin']), async (req, res) => {
  try {
    await migrate();
    const { rows } = await pool.query('DELETE FROM clients WHERE id=$1 AND org_id=$2 RETURNING id', [req.params.id, req.user.org_id]);
    if (rows.length === 0) return res.status(404).json({ error: 'Client not found' });
    res.json({ deleted: true });
  } catch (err) {
    console.error('Error deleting client:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── Client Dashboard Share Links (admin only) ──────────────────────────────────
// Lets an admin generate a secure, revocable, read-only link they can hand
// to a client so the client can view their own work dashboard (adjusting
// the date range themselves) without any login or edit access. See
// lib/shareLinks.js and the public GET /api/public/share/:token endpoint.

// POST create a new share link for a client
app.post('/api/clients/:id/share-links', requireRole(['admin']), async (req, res) => {
  try {
    await migrate();
    const clientCheck = await pool.query('SELECT id FROM clients WHERE id=$1 AND org_id=$2', [req.params.id, req.user.org_id]);
    if (clientCheck.rows.length === 0) return res.status(404).json({ error: 'Client not found' });

    const { label, expiresInDays } = req.body || {};
    const { token, link } = await createShareLink(req.user.org_id, req.params.id, req.user.id, { label, expiresInDays });

    // The raw token is only ever returned here, at creation time.
    res.status(201).json({
      ...link,
      token,
      shareUrl: `/share/${token}`
    });
  } catch (err) {
    console.error('Error creating share link:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET list share links for a client (never includes the raw token)
app.get('/api/clients/:id/share-links', requireRole(['admin']), async (req, res) => {
  try {
    await migrate();
    const clientCheck = await pool.query('SELECT id FROM clients WHERE id=$1 AND org_id=$2', [req.params.id, req.user.org_id]);
    if (clientCheck.rows.length === 0) return res.status(404).json({ error: 'Client not found' });

    const links = await listShareLinks(req.user.org_id, req.params.id);
    res.json(links);
  } catch (err) {
    console.error('Error listing share links:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// DELETE revoke a share link
app.delete('/api/clients/:id/share-links/:linkId', requireRole(['admin']), async (req, res) => {
  try {
    await migrate();
    const revoked = await revokeShareLink(req.user.org_id, req.params.id, req.params.linkId);
    if (!revoked) return res.status(404).json({ error: 'Share link not found or already revoked' });
    res.json({ revoked: true });
  } catch (err) {
    console.error('Error revoking share link:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── Work Items (Tasks) ─────────────────────────────────────────────────────────

// GET all work items (org scoped; team members see only their own)
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
      WHERE w.org_id = $1
    `;
    const params = [req.user.org_id];
    let i = 2;

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

// POST create work item (admin only — team members don't create/assign tasks)
app.post('/api/work-items', requireRole(['admin']), async (req, res) => {
  try {
    await migrate();
    const { client_id, title, description, status, priority, due_date, amount, payment_status, assigned_to } = req.body;
    if (!client_id || !title) return res.status(400).json({ error: 'client_id and title are required' });

    const { rows } = await pool.query(
      `INSERT INTO work_items (client_id,title,description,status,priority,due_date,amount,payment_status,assigned_to,created_by,org_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
      [client_id, title.trim(), description||null, status||'pending', priority||'medium',
       due_date||null, amount||null, payment_status||'unpaid', assigned_to||null, req.user.id, req.user.org_id]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    console.error('Error creating work item:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET single work item (org scoped; team members can only view their own)
app.get('/api/work-items/:id', async (req, res) => {
  try {
    await migrate();
    const { rows } = await pool.query(
      `SELECT w.*, c.name AS client_name, c.slug AS client_slug
       FROM work_items w LEFT JOIN clients c ON c.id = w.client_id
       WHERE w.id = $1 AND w.org_id = $2`,
      [req.params.id, req.user.org_id]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Work item not found' });
    if (req.user.role !== 'admin' && rows[0].assigned_to !== req.user.id) {
      return res.status(403).json({ error: 'You can only view tasks assigned to you' });
    }
    res.json(rows[0]);
  } catch (err) {
    console.error('Error fetching work item:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT full update of a work item (admin only — team members may only mark
// their own tasks complete/incomplete via the dedicated endpoint below)
app.put('/api/work-items/:id', requireRole(['admin']), async (req, res) => {
  try {
    await migrate();
    const { client_id, title, description, status, priority, due_date, amount, payment_status, assigned_to } = req.body;
    const { rows } = await pool.query(
      `UPDATE work_items
       SET client_id=$1,title=$2,description=$3,status=$4,priority=$5,due_date=$6,
           amount=$7,payment_status=$8,assigned_to=$9,updated_at=CURRENT_TIMESTAMP
       WHERE id=$10 AND org_id=$11 RETURNING *`,
      [client_id, title.trim(), description||null, status||'pending', priority||'medium',
       due_date||null, amount||null, payment_status||'unpaid', assigned_to||null, req.params.id, req.user.org_id]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Work item not found' });
    res.json(rows[0]);
  } catch (err) {
    console.error('Error updating work item:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PATCH mark own task complete / not complete — the ONLY write access a team
// member has to a work item. Every other field (client, title, amount,
// assignment, due date, payment status, ...) stays admin-only via PUT above.
app.patch('/api/work-items/:id/complete', async (req, res) => {
  try {
    await migrate();
    const { completed } = req.body;
    if (typeof completed !== 'boolean')
      return res.status(400).json({ error: '`completed` (boolean) is required' });

    const existing = await pool.query(
      'SELECT id, assigned_to FROM work_items WHERE id=$1 AND org_id=$2',
      [req.params.id, req.user.org_id]
    );
    if (existing.rows.length === 0) return res.status(404).json({ error: 'Work item not found' });

    const isOwner = existing.rows[0].assigned_to === req.user.id;
    if (req.user.role !== 'admin' && !isOwner)
      return res.status(403).json({ error: 'You can only update tasks assigned to you' });

    const { rows } = await pool.query(
      `UPDATE work_items SET status=$1, updated_at=CURRENT_TIMESTAMP
       WHERE id=$2 AND org_id=$3 RETURNING *`,
      [completed ? 'completed' : 'pending', req.params.id, req.user.org_id]
    );
    res.json(rows[0]);
  } catch (err) {
    console.error('Error updating task completion:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// DELETE work item (admin only, org scoped)
app.delete('/api/work-items/:id', requireRole(['admin']), async (req, res) => {
  try {
    await migrate();
    const { rows } = await pool.query('DELETE FROM work_items WHERE id=$1 AND org_id=$2 RETURNING id', [req.params.id, req.user.org_id]);
    if (rows.length === 0) return res.status(404).json({ error: 'Work item not found' });
    res.json({ deleted: true });
  } catch (err) {
    console.error('Error deleting work item:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── Calendar Events ────────────────────────────────────────────────────────────
// Team members: read-only, and only their own events. Admins: full control
// over any event within their organization.

app.get('/api/calendar-events', async (req, res) => {
  try {
    await migrate();
    const { user_id, work_item_id, start_date, end_date } = req.query;
    let query = `
      SELECT e.*, w.title AS work_item_title, w.client_id
      FROM calendar_events e
      LEFT JOIN work_items w ON w.id = e.work_item_id
      WHERE e.org_id = $1
    `;
    const params = [req.user.org_id];
    let i = 2;

    if (req.user.role !== 'admin') {
      // Team members can only ever see their own events, regardless of
      // what user_id they pass in the query string.
      query += ` AND e.user_id = $${i++}`;
      params.push(req.user.id);
    } else if (user_id) {
      query += ` AND e.user_id = $${i++}`;
      params.push(user_id);
    }
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

app.post('/api/calendar-events', requireRole(['admin']), async (req, res) => {
  try {
    await migrate();
    const { work_item_id, user_id, title, description, event_date, event_type, external_calendar_id } = req.body;
    if (!user_id || !title || !event_date)
      return res.status(400).json({ error: 'user_id, title, and event_date are required' });

    const targetUser = await pool.query('SELECT id FROM users WHERE id=$1 AND org_id=$2', [user_id, req.user.org_id]);
    if (targetUser.rows.length === 0) return res.status(400).json({ error: 'Invalid user_id for this organization' });

    const { rows } = await pool.query(
      `INSERT INTO calendar_events (work_item_id,user_id,title,description,event_date,event_type,external_calendar_id,org_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
      [work_item_id||null, user_id, title.trim(), description||null, event_date, event_type||'task', external_calendar_id||null, req.user.org_id]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    console.error('Error creating calendar event:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.put('/api/calendar-events/:id', requireRole(['admin']), async (req, res) => {
  try {
    await migrate();
    const { work_item_id, user_id, title, description, event_date, event_type } = req.body;

    const targetUser = await pool.query('SELECT id FROM users WHERE id=$1 AND org_id=$2', [user_id, req.user.org_id]);
    if (targetUser.rows.length === 0) return res.status(400).json({ error: 'Invalid user_id for this organization' });

    const { rows } = await pool.query(
      `UPDATE calendar_events
       SET work_item_id=$1,user_id=$2,title=$3,description=$4,event_date=$5,event_type=$6
       WHERE id=$7 AND org_id=$8 RETURNING *`,
      [work_item_id||null, user_id, title.trim(), description||null, event_date, event_type||'task', req.params.id, req.user.org_id]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Event not found' });
    res.json(rows[0]);
  } catch (err) {
    console.error('Error updating calendar event:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.delete('/api/calendar-events/:id', requireRole(['admin']), async (req, res) => {
  try {
    await migrate();
    const { rows } = await pool.query('DELETE FROM calendar_events WHERE id=$1 AND org_id=$2 RETURNING id', [req.params.id, req.user.org_id]);
    if (rows.length === 0) return res.status(404).json({ error: 'Event not found' });
    res.json({ deleted: true });
  } catch (err) {
    console.error('Error deleting calendar event:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── Work Comments (admin only) ─────────────────────────────────────────────────
// Team members' only write access anywhere in the system is the task
// completion toggle above; internal collaboration notes on a task are an
// admin tool.

app.get('/api/work-comments', requireRole(['admin']), async (req, res) => {
  try {
    await migrate();
    const { work_item_id } = req.query;
    if (!work_item_id) return res.status(400).json({ error: 'work_item_id is required' });

    const owned = await pool.query('SELECT id FROM work_items WHERE id=$1 AND org_id=$2', [work_item_id, req.user.org_id]);
    if (owned.rows.length === 0) return res.status(404).json({ error: 'Work item not found' });

    const { rows } = await pool.query(
      `SELECT c.*, u.full_name AS user_name FROM work_comments c
       LEFT JOIN users u ON u.id = c.user_id
       WHERE c.work_item_id = $1
       ORDER BY c.created_at ASC`,
      [work_item_id]
    );
    res.json(rows);
  } catch (err) {
    console.error('Error fetching comments:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.post('/api/work-comments', requireRole(['admin']), async (req, res) => {
  try {
    await migrate();
    const { work_item_id, comment } = req.body;
    if (!work_item_id || !comment)
      return res.status(400).json({ error: 'work_item_id and comment are required' });

    const owned = await pool.query('SELECT id FROM work_items WHERE id=$1 AND org_id=$2', [work_item_id, req.user.org_id]);
    if (owned.rows.length === 0) return res.status(404).json({ error: 'Work item not found' });

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

// ── Dashboard (admin only — financial/aggregate data) ──────────────────────────

app.get('/api/dashboard', requireRole(['admin']), async (req, res) => {
  try {
    await migrate();
    const { client_id, start_date, end_date } = req.query;

    let where = 'WHERE w.org_id = $1';
    const params = [req.user.org_id];
    let i = 2;
    if (client_id)  { where += ` AND w.client_id = $${i++}`;  params.push(client_id); }
    if (start_date) { where += ` AND w.due_date >= $${i++}`;  params.push(start_date); }
    if (end_date)   { where += ` AND w.due_date <= $${i++}`;  params.push(end_date); }

    const [statusRes, paymentRes, overdueRes, recentRes] = await Promise.all([
      pool.query(`SELECT status, COUNT(*) as count FROM work_items w ${where} GROUP BY status`, params),
      pool.query(`SELECT
        COALESCE(SUM(amount),0) as total,
        COALESCE(SUM(CASE WHEN payment_status='paid' THEN amount ELSE 0 END),0) as paid,
        COALESCE(SUM(CASE WHEN payment_status!='paid' THEN amount ELSE 0 END),0) as outstanding
        FROM work_items w ${where}`, params),
      pool.query(`SELECT w.*, c.name AS client_name, c.slug AS client_slug
        FROM work_items w LEFT JOIN clients c ON c.id=w.client_id
        ${where} AND w.status!='completed' AND w.due_date<CURRENT_DATE
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

// GET all team members (scoped to the caller's organization)
// GET all team members (admin only — org scoped)
app.get('/api/team/members', requireRole(['admin']), async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, full_name, email, phone, role, custom_role, avatar, is_active, created_at
       FROM users WHERE org_id = $1 ORDER BY created_at DESC`,
      [req.user.org_id]
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
      `INSERT INTO users (full_name,email,phone,role,custom_role,password_hash,org_id,org_slug)
       VALUES ($1,$2,$3,$4,$5,crypt($6,gen_salt('bf')),$7,$8)
       RETURNING id, full_name, email, phone, role, custom_role, avatar, is_active, created_at`,
      [full_name, email, phone||null, role, custom_role||null, tempPassword, req.user.org_id, req.user.orgSlug]
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
               password_hash=crypt($6,gen_salt('bf')) WHERE id=$7 AND org_id=$8
               RETURNING id, full_name, email, phone, role, custom_role, avatar, is_active, created_at`;
      params = [full_name, email, phone||null, role, custom_role||null, password, id, req.user.org_id];
    } else {
      query = `UPDATE users SET full_name=$1,email=$2,phone=$3,role=$4,custom_role=$5
               WHERE id=$6 AND org_id=$7
               RETURNING id, full_name, email, phone, role, custom_role, avatar, is_active, created_at`;
      params = [full_name, email, phone||null, role, custom_role||null, id, req.user.org_id];
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

    const { rowCount } = await pool.query('DELETE FROM users WHERE id=$1 AND org_id=$2', [id, req.user.org_id]);
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
      `UPDATE users SET is_active=$1 WHERE id=$2 AND org_id=$3
       RETURNING id, full_name, email, phone, role, custom_role, avatar, is_active, created_at`,
      [is_active, req.params.id, req.user.org_id]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Member not found' });
    res.json(rows[0]);
  } catch (err) {
    console.error('Error toggling member status:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET workload distribution (admin only, org scoped)
app.get('/api/team/workload', requireRole(['admin']), async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT u.id AS user_id, u.full_name AS member_name,
        COUNT(w.id) AS task_count,
        COUNT(CASE WHEN w.status='pending'     THEN 1 END) AS pending,
        COUNT(CASE WHEN w.status='in-progress' THEN 1 END) AS in_progress,
        COUNT(CASE WHEN w.status='completed'   THEN 1 END) AS completed
      FROM users u
      LEFT JOIN work_items w ON w.assigned_to = u.id AND w.org_id = u.org_id
      WHERE u.role IN ('admin','team') AND u.org_id = $1
      GROUP BY u.id, u.full_name
      ORDER BY task_count DESC
    `, [req.user.org_id]);
    res.json(rows);
  } catch (err) {
    console.error('Error fetching workload:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── Custom Roles ───────────────────────────────────────────────────────────────

// GET all roles
// ── Custom Roles (admin only, org scoped) ───────────────────────────────────────

app.get('/api/roles', requireRole(['admin']), async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM roles WHERE org_id = $1 ORDER BY name ASC', [req.user.org_id]);
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
      `INSERT INTO roles (name,description,color,created_by,org_id) VALUES ($1,$2,$3,$4,$5) RETURNING *`,
      [name.trim(), description||null, color||'#4f46e5', req.user.id, req.user.org_id]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    if (err.code === '23505') return res.status(400).json({ error: 'A role with this name already exists' });
    console.error('Error creating role:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT update role (admin only, org scoped)
app.put('/api/roles/:id', requireRole(['admin']), async (req, res) => {
  try {
    const { name, description, color } = req.body;
    if (!name?.trim()) return res.status(400).json({ error: 'Role name is required' });

    const { rows } = await pool.query(
      `UPDATE roles SET name=$1,description=$2,color=$3 WHERE id=$4 AND org_id=$5 RETURNING *`,
      [name.trim(), description||null, color||'#4f46e5', req.params.id, req.user.org_id]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Role not found' });
    res.json(rows[0]);
  } catch (err) {
    if (err.code === '23505') return res.status(400).json({ error: 'A role with this name already exists' });
    console.error('Error updating role:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// DELETE role (admin only, org scoped)
app.delete('/api/roles/:id', requireRole(['admin']), async (req, res) => {
  try {
    const { id } = req.params;
    const roleCheck = await pool.query('SELECT name FROM roles WHERE id=$1 AND org_id=$2', [id, req.user.org_id]);
    if (roleCheck.rows.length === 0) return res.status(404).json({ error: 'Role not found' });

    await pool.query(
      `UPDATE users SET custom_role=NULL WHERE custom_role=$1 AND org_id=$2`,
      [roleCheck.rows[0].name, req.user.org_id]
    );
    await pool.query('DELETE FROM roles WHERE id=$1 AND org_id=$2', [id, req.user.org_id]);
    res.json({ success: true });
  } catch (err) {
    console.error('Error deleting role:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ══════════════════════════════════════════════════════════════════════════════
// ORGANIZATION ROUTES
// ══════════════════════════════════════════════════════════════════════════════

// GET organization details (authenticated users)
app.get('/api/organization', async (req, res) => {
  try {
    const token = req.cookies.session_token;
    if (!token) return res.status(401).json({ error: 'Not authenticated' });

    const user = await validateSession(token);
    if (!user || !user.orgId) return res.status(404).json({ error: 'Organization not found' });

    const org = await getOrganizationById(user.orgId);
    if (!org) return res.status(404).json({ error: 'Organization not found' });

    res.json(org);
  } catch (err) {
    console.error('Error fetching organization:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT update organization (admin only)
app.put('/api/organization', requireRole(['admin']), async (req, res) => {
  try {
    const { name } = req.body;
    if (!name?.trim()) return res.status(400).json({ error: 'Organization name is required' });

    const { rows } = await pool.query(
      `UPDATE organizations SET name=$1, updated_at=CURRENT_TIMESTAMP WHERE id=$2 RETURNING *`,
      [name.trim(), req.user.orgId]
    );

    if (rows.length === 0) return res.status(404).json({ error: 'Organization not found' });
    res.json(rows[0]);
  } catch (err) {
    console.error('Error updating organization:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ══════════════════════════════════════════════════════════════════════════════
// JOIN REQUESTS (Admin manages pending team member requests)
// ══════════════════════════════════════════════════════════════════════════════

// GET pending join requests for current user's org (admin only)
app.get('/api/org/join-requests', requireRole(['admin']), async (req, res) => {
  try {
    if (!req.user.orgId) return res.status(400).json({ error: 'User not in an organization' });
    
    const requests = await getPendingJoinRequests(req.user.orgId);
    res.json(requests);
  } catch (err) {
    console.error('Error fetching join requests:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST approve/reject join request (admin only)
app.post('/api/org/join-requests/:id/decide', requireRole(['admin']), async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body; // 'approved' or 'rejected'
    
    if (!['approved', 'rejected'].includes(status)) {
      return res.status(400).json({ error: 'Status must be "approved" or "rejected"' });
    }
    
    // Verify the request belongs to admin's org
    const { rows } = await pool.query('SELECT org_id FROM org_join_requests WHERE id = $1', [id]);
    if (rows.length === 0) return res.status(404).json({ error: 'Request not found' });
    if (rows[0].org_id !== req.user.orgId) {
      return res.status(403).json({ error: 'Not authorized to manage this request' });
    }
    
    const result = await updateJoinRequestStatus(id, status);
    res.json(result);
  } catch (err) {
    console.error('Error processing join request:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET current user's pending join request status
app.get('/api/org/my-join-request', requireAuth, async (req, res) => {
  try {
    const request = await getUserPendingJoinRequest(req.user.id);
    res.json(request || null);
  } catch (err) {
    console.error('Error fetching join request:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ══════════════════════════════════════════════════════════════════════════════
// INVOICES
// ══════════════════════════════════════════════════════════════════════════════

// GET all invoices (scoped by org)
app.get('/api/invoices', requireRole(['admin']), async (req, res) => {
  try {
    await migrate();
    const { status, client_id } = req.query;

    let query = `
      SELECT i.*, c.name AS client_name, c.company AS client_company
      FROM invoices i
      LEFT JOIN clients c ON c.id = i.client_id
      WHERE i.org_id = $1
    `;
    const params = [req.user.orgId];
    let idx = 2;

    if (status)    { query += ` AND i.status = $${idx++}`;    params.push(status); }
    if (client_id) { query += ` AND i.client_id = $${idx++}`; params.push(client_id); }

    query += ' ORDER BY i.created_at DESC';

    const { rows } = await pool.query(query, params);
    res.json(rows);
  } catch (err) {
    console.error('Error fetching invoices:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET billable work items for a client — used by the invoice designer to show what can be billed
app.get('/api/invoices/billable-items/:clientId', requireRole(['admin']), async (req, res) => {
  try {
    await migrate();
    const { rows } = await pool.query(
      `SELECT * FROM work_items
       WHERE client_id = $1 AND org_id = $2 AND (payment_status IS NULL OR payment_status = 'unpaid')
       ORDER BY created_at DESC`,
      [req.params.clientId, req.user.orgId]
    );
    res.json(rows);
  } catch (err) {
    console.error('Error fetching billable items:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST live preview — calculates totals and renders invoice HTML WITHOUT saving anything.
// This is what powers the "design it before you commit" experience.
app.post('/api/invoices/preview', requireRole(['admin']), async (req, res) => {
  try {
    await migrate();
    const { clientId, workItemIds = [], customItems = [], taxRate, notes, issueDate, dueDate } = req.body;

    const clientRes = await pool.query('SELECT * FROM clients WHERE id = $1 AND org_id = $2', [clientId, req.user.orgId]);
    if (clientRes.rows.length === 0) return res.status(404).json({ error: 'Client not found' });
    const client = clientRes.rows[0];

    let workItems = [];
    if (workItemIds.length > 0) {
      const placeholders = workItemIds.map((_, i) => `$${i + 2}`).join(',');
      const wiRes = await pool.query(
        `SELECT * FROM work_items WHERE id IN (${placeholders}) AND org_id = $1`,
        [req.user.orgId, ...workItemIds]
      );
      workItems = wiRes.rows;
    }

    const { subtotal, tax, total, taxRate: rate } = calculateTotals(workItems, customItems, taxRate);

    const previewInvoice = {
      invoice_number: 'DRAFT-PREVIEW',
      status: 'draft',
      issue_date: issueDate || new Date().toISOString().split('T')[0],
      due_date: dueDate || new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
      client_name: client.name,
      company: client.company,
      address: client.address,
      client_email: client.email,
      subtotal, tax, total, tax_rate: rate,
      notes: notes || '',
      work_items: workItems,
      custom_items: customItems
    };

    res.json({ invoice: previewInvoice, html: generateInvoiceHTML(previewInvoice) });
  } catch (err) {
    console.error('Error generating invoice preview:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST create invoice (always starts as draft — sending is a separate, deliberate step)
app.post('/api/invoices', requireRole(['admin']), async (req, res) => {
  try {
    await migrate();
    const { clientId, workItemIds = [], customItems = [], taxRate, notes, issueDate, dueDate } = req.body;
    if (!clientId) return res.status(400).json({ error: 'Client is required' });

    const clientRes = await pool.query('SELECT id FROM clients WHERE id = $1 AND org_id = $2', [clientId, req.user.orgId]);
    if (clientRes.rows.length === 0) return res.status(404).json({ error: 'Client not found' });

    const invoice = await createInvoiceFromTasks(clientId, workItemIds, req.user.id, {
      customItems, taxRate, notes, issueDate, dueDate,
      orgId: req.user.orgId,
      status: 'draft'
    });
    res.status(201).json(invoice);
  } catch (err) {
    console.error('Error creating invoice:', err);
    res.status(400).json({ error: err.message || 'Internal server error' });
  }
});

// GET single invoice with full details
app.get('/api/invoices/:id', requireRole(['admin']), async (req, res) => {
  try {
    await migrate();
    const check = await pool.query('SELECT id FROM invoices WHERE id = $1 AND org_id = $2', [req.params.id, req.user.orgId]);
    if (check.rows.length === 0) return res.status(404).json({ error: 'Invoice not found' });

    const invoice = await getInvoiceDetails(req.params.id);
    res.json(invoice);
  } catch (err) {
    console.error('Error fetching invoice:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET rendered invoice HTML (for preview / printing a saved invoice)
app.get('/api/invoices/:id/html', requireRole(['admin']), async (req, res) => {
  try {
    await migrate();
    const check = await pool.query('SELECT id FROM invoices WHERE id = $1 AND org_id = $2', [req.params.id, req.user.orgId]);
    if (check.rows.length === 0) return res.status(404).json({ error: 'Invoice not found' });

    const invoice = await getInvoiceDetails(req.params.id);
    res.send(generateInvoiceHTML(invoice));
  } catch (err) {
    console.error('Error rendering invoice:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT update a draft invoice (line items, dates, notes, tax rate) — recalculates totals
app.put('/api/invoices/:id', requireRole(['admin']), async (req, res) => {
  try {
    await migrate();
    const check = await pool.query('SELECT id FROM invoices WHERE id = $1 AND org_id = $2', [req.params.id, req.user.orgId]);
    if (check.rows.length === 0) return res.status(404).json({ error: 'Invoice not found' });

    const { workItemIds, customItems, taxRate, notes, issueDate, dueDate } = req.body;
    const invoice = await updateInvoiceDraft(req.params.id, req.user.id, {
      workItemIds, customItems, taxRate, notes, issueDate, dueDate
    });
    res.json(invoice);
  } catch (err) {
    console.error('Error updating invoice:', err);
    res.status(400).json({ error: err.message || 'Internal server error' });
  }
});

// POST send invoice — locks it from further editing and marks linked work items as partially paid
app.post('/api/invoices/:id/send', requireRole(['admin']), async (req, res) => {
  try {
    await migrate();
    const check = await pool.query('SELECT * FROM invoices WHERE id = $1 AND org_id = $2', [req.params.id, req.user.orgId]);
    if (check.rows.length === 0) return res.status(404).json({ error: 'Invoice not found' });

    const { rows } = await pool.query(
      `UPDATE invoices SET status = 'sent', updated_at = CURRENT_TIMESTAMP WHERE id = $1 RETURNING *`,
      [req.params.id]
    );
    const workItemIds = rows[0].work_item_ids || [];
    if (workItemIds.length > 0) {
      await pool.query(`UPDATE work_items SET payment_status = 'partial' WHERE id = ANY($1)`, [workItemIds]);
    }
    res.json(rows[0]);
  } catch (err) {
    console.error('Error sending invoice:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST mark invoice paid
app.post('/api/invoices/:id/pay', requireRole(['admin']), async (req, res) => {
  try {
    await migrate();
    const check = await pool.query('SELECT id FROM invoices WHERE id = $1 AND org_id = $2', [req.params.id, req.user.orgId]);
    if (check.rows.length === 0) return res.status(404).json({ error: 'Invoice not found' });

    const invoice = await markInvoicePaid(req.params.id, req.body.paymentId || null);
    res.json(invoice);
  } catch (err) {
    console.error('Error marking invoice paid:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// DELETE invoice (draft only — sent/paid invoices are kept for records; admin only)
app.delete('/api/invoices/:id', requireRole(['admin']), async (req, res) => {
  try {
    await migrate();
    const { rows } = await pool.query(
      `DELETE FROM invoices WHERE id = $1 AND org_id = $2 AND status = 'draft' RETURNING id`,
      [req.params.id, req.user.orgId]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Draft invoice not found (only unsent drafts can be deleted)' });
    res.json({ deleted: true });
  } catch (err) {
    console.error('Error deleting invoice:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ══════════════════════════════════════════════════════════════════════════════
// STATIC FILES  (must come after all API routes)
// ══════════════════════════════════════════════════════════════════════════════

app.use(express.static(PUBLIC_DIR));

app.get('/invoices', (req, res) =>
  res.sendFile(path.join(PUBLIC_DIR, 'invoices.html'))
);

app.get('/share/:token', (req, res) =>
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