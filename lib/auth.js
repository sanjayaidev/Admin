// lib/auth.js
// Authentication logic - password hashing, session management

const bcrypt = require('bcrypt');
const crypto = require('crypto');
const { pool } = require('./db');

const SALT_ROUNDS = 10;
const SESSION_EXPIRY_DAYS = 7;

// Hash a password
async function hashPassword(password) {
  return bcrypt.hash(password, SALT_ROUNDS);
}

// Verify password against hash
async function verifyPassword(password, hash) {
  return bcrypt.compare(password, hash);
}

// Create a new user
async function createUser(email, password, fullName, role = 'team', orgId = null, isActive = true) {
  const passwordHash = await hashPassword(password);
  
  const { rows } = await pool.query(
    `INSERT INTO users (email, password_hash, full_name, role, org_id, is_active)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING id, email, full_name, role, org_id, is_active`,
    [email, passwordHash, fullName, role, orgId, isActive]
  );
  
  return rows[0];
}

// Create a new organization
async function createOrganization(name, orgId = null) {
  const slug = name.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') || 'org';
  
  if (orgId) {
    // Use provided org ID
    const { rows } = await pool.query(
      `INSERT INTO organizations (id, name, slug)
       VALUES ($1, $2, $3)
       ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, slug = EXCLUDED.slug
       RETURNING id, name, slug`,
      [orgId, name, slug]
    );
    return rows[0];
  } else {
    // Auto-generate UUID
    const { rows } = await pool.query(
      `INSERT INTO organizations (name, slug)
       VALUES ($1, $2)
       RETURNING id, name, slug`,
      [name, slug]
    );
    return rows[0];
  }
}

// Get organization by ID
async function getOrganizationById(orgId) {
  const { rows } = await pool.query(
    'SELECT id, name, slug FROM organizations WHERE id = $1',
    [orgId]
  );
  return rows[0] || null;
}

// Get organization by slug
async function getOrganizationBySlug(slug) {
  const { rows } = await pool.query(
    'SELECT id, name, slug FROM organizations WHERE slug = $1',
    [slug]
  );
  return rows[0] || null;
}

// Create an organization join request
async function createOrgJoinRequest(orgId, userId, userEmail, userName) {
  const { rows } = await pool.query(
    `INSERT INTO org_join_requests (org_id, user_id, user_email, user_name, status)
     VALUES ($1, $2, $3, $4, 'pending')
     ON CONFLICT (org_id, user_id) DO UPDATE SET status = 'pending', requested_at = NOW()
     RETURNING id, org_id, user_id, user_email, user_name, status, requested_at`,
    [orgId, userId, userEmail, userName]
  );
  return rows[0];
}

// Get pending join requests for an organization
async function getPendingJoinRequests(orgId) {
  const { rows } = await pool.query(
    `SELECT * FROM org_join_requests 
     WHERE org_id = $1 AND status = 'pending'
     ORDER BY requested_at DESC`,
    [orgId]
  );
  return rows;
}

// Approve or reject a join request
async function updateJoinRequestStatus(requestId, status) {
  if (!['approved', 'rejected'].includes(status)) {
    throw new Error('Invalid status. Must be "approved" or "rejected"');
  }
  
  const { rows } = await pool.query(
    `UPDATE org_join_requests 
     SET status = $1, reviewed_at = NOW()
     WHERE id = $2
     RETURNING id, org_id, user_id, status`,
    [status, requestId]
  );
  
  // If approved, activate the user
  if (status === 'approved' && rows.length > 0) {
    await pool.query(
      'UPDATE users SET is_active = true WHERE id = $1',
      [rows[0].user_id]
    );
  }
  
  return rows[0];
}

// Get user's pending join request
async function getUserPendingJoinRequest(userId) {
  const { rows } = await pool.query(
    `SELECT * FROM org_join_requests 
     WHERE user_id = $1 AND status = 'pending'`,
    [userId]
  );
  return rows[0] || null;
}

// Create default admin user if not exists
async function createDefaultAdmin() {
  const adminEmail = 'admin@gmail.com';
  const adminPassword = 'Admin@123';
  const adminName = 'Sanjay Meher';
  const orgName = 'Default Organization';
  
  try {
    // Check if admin already exists
    const { rows } = await pool.query(
      'SELECT id, org_id FROM users WHERE email = $1',
      [adminEmail]
    );
    
    if (rows.length === 0) {
      // Create default organization first
      const org = await createOrganization(orgName);
      
      const passwordHash = await hashPassword(adminPassword);
      await pool.query(
        `INSERT INTO users (email, password_hash, full_name, role, custom_role, org_id)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [adminEmail, passwordHash, adminName, 'admin', 'Freelancer', org.id]
      );
      console.log('✅ Default admin user created: admin@gmail.com / Admin@123');
      console.log('   Name: Sanjay Meher, Role: Admin, Work: Freelancer');
      console.log(`   Organization: ${org.name} (${org.id})`);
    } else {
      console.log('ℹ️  Default admin user already exists');
    }
  } catch (error) {
    if (error.code === '23505' && error.constraint === 'users_email_key') {
      console.log('ℹ️  Default admin user already exists');
    } else {
      console.error('❌ Error creating default admin:', error.message);
    }
  }
}

// Authenticate user with email and password
async function authenticateUser(email, password) {
  const { rows } = await pool.query(
    'SELECT id, email, password_hash, full_name, role, is_active, org_id FROM users WHERE email = $1',
    [email]
  );
  
  if (rows.length === 0) return null;
  
  const user = rows[0];
  
  if (!user.is_active) return null;
  
  const isValid = await verifyPassword(password, user.password_hash);
  if (!isValid) return null;
  
  // Return user without password hash
  const { password_hash, ...userWithoutPassword } = user;
  return userWithoutPassword;
}

// Create a session for a user
async function createSession(userId) {
  // Generate a secure random token
  const token = crypto.randomBytes(32).toString('hex');
  
  // Set expiry date
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + SESSION_EXPIRY_DAYS);
  
  await pool.query(
    'INSERT INTO sessions (user_id, session_token, expires_at) VALUES ($1, $2, $3)',
    [userId, token, expiresAt]
  );
  
  return token;
}

// Validate a session token
async function validateSession(token) {
  const { rows } = await pool.query(
    `SELECT s.*, u.id, u.email, u.full_name, u.role, u.is_active, u.org_id
     FROM sessions s
     JOIN users u ON u.id = s.user_id
     WHERE s.session_token = $1 AND s.expires_at > NOW() AND u.is_active = true`,
    [token]
  );
  
  if (rows.length === 0) return null;
  
  const session = rows[0];
  
  // Return user data
  return {
    id: session.id,
    email: session.email,
    fullName: session.full_name,
    role: session.role,
    isActive: session.is_active,
    orgId: session.org_id
  };
}

// Delete a session (logout)
async function deleteSession(token) {
  await pool.query('DELETE FROM sessions WHERE session_token = $1', [token]);
}

// Delete all sessions for a user (logout everywhere)
async function deleteAllSessions(userId) {
  await pool.query('DELETE FROM sessions WHERE user_id = $1', [userId]);
}

// Get user by ID
async function getUserById(userId) {
  const { rows } = await pool.query(
    'SELECT id, email, full_name, role, is_active, org_id FROM users WHERE id = $1',
    [userId]
  );
  
  return rows[0] || null;
}

// Check if user has a specific role
function hasRole(user, allowedRoles) {
  if (!user) return false;
  return allowedRoles.includes(user.role);
}

module.exports = {
  hashPassword,
  verifyPassword,
  createUser,
  createOrganization,
  getOrganizationById,
  getOrganizationBySlug,
  createOrgJoinRequest,
  getPendingJoinRequests,
  updateJoinRequestStatus,
  getUserPendingJoinRequest,
  createDefaultAdmin,
  authenticateUser,
  createSession,
  validateSession,
  deleteSession,
  deleteAllSessions,
  getUserById,
  hasRole
};
