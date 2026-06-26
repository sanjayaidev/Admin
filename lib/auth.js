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
async function createUser(email, password, fullName, role = 'team') {
  const passwordHash = await hashPassword(password);
  
  const { rows } = await pool.query(
    `INSERT INTO users (email, password_hash, full_name, role)
     VALUES ($1, $2, $3, $4)
     RETURNING id, email, full_name, role`,
    [email, passwordHash, fullName, role]
  );
  
  return rows[0];
}

// Authenticate user with email and password
async function authenticateUser(email, password) {
  const { rows } = await pool.query(
    'SELECT id, email, password_hash, full_name, role, is_active FROM users WHERE email = $1',
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
    `SELECT s.*, u.id, u.email, u.full_name, u.role, u.is_active
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
    isActive: session.is_active
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
    'SELECT id, email, full_name, role, is_active FROM users WHERE id = $1',
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
  authenticateUser,
  createSession,
  validateSession,
  deleteSession,
  deleteAllSessions,
  getUserById,
  hasRole
};
