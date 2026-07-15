const express = require('express');
const bcrypt = require('bcryptjs');
const { select, insert } = require('../lib/db');
const TABLES = require('../lib/db').TABLES;
const { generateApiKey } = require('../lib/encryption');
const logger = require('../lib/logger');

const router = express.Router();

// POST /auth/register { email, password }
// Bootstraps a user and issues their first API key. The raw key is
// returned exactly once here - after this, only its hash exists in
// storage. Losing it means generating a new one (an /auth/keys/rotate
// endpoint is a natural next addition, not included in this starter).
router.post('/register', express.json(), async (req, res, next) => {
  try {
    const { email, password } = req.body || {};
    if (!email || !password || password.length < 8) {
      return res.status(400).json({ error: 'invalid_input', message: 'email and password (8+ chars) required' });
    }

    const existing = await select(TABLES.USERS, { email }, ['id']);
    if (existing && existing.length > 0) {
      return res.status(409).json({ error: 'email_taken' });
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const user = await insert(TABLES.USERS, { 
      email, 
      password_hash: passwordHash,
      full_name: email.split('@')[0],
      role: 'admin'
    });

    const { raw, hash } = generateApiKey();
    await insert(TABLES.API_KEYS, { 
      user_id: user.id, 
      key_hash: hash, 
      label: 'default',
      org_id: user.org_id
    });

    res.status(201).json({ 
      user: { id: user.id, email: user.email }, 
      apiKey: raw, 
      message: 'Save this API key now - it will not be shown again.' 
    });
  } catch (err) {
    logger.error({ err }, '[auth] register failed');
    next(err);
  }
});

// POST /auth/login { email, password }
// Verifies credentials, then issues a brand new API key (raw keys can't be
// recovered once shown - only their hash is stored - so "logging in" means
// getting a fresh key, not retrieving the old one). Existing keys for this
// user are untouched and keep working.
router.post('/login', express.json(), async (req, res, next) => {
  try {
    const { email, password } = req.body || {};
    const users = await select(TABLES.USERS, { email }, ['id', 'email', 'password_hash', 'org_id', 'full_name', 'role']);

    if (!users || users.length === 0) {
      return res.status(401).json({ error: 'invalid_credentials' });
    }
    
    const user = users[0];
    
    if (!(await bcrypt.compare(password, user.password_hash))) {
      return res.status(401).json({ error: 'invalid_credentials' });
    }

    const { raw, hash } = generateApiKey();
    await insert(TABLES.API_KEYS, { 
      user_id: user.id, 
      key_hash: hash, 
      label: 'login',
      org_id: user.org_id
    });

    res.json({
      user: { 
        id: user.id, 
        email: user.email,
        full_name: user.full_name,
        role: user.role,
        org_id: user.org_id
      },
      apiKey: raw,
      message: 'New API key issued - save it now, it will not be shown again.',
    });
  } catch (err) {
    logger.error({ err }, '[auth] login failed');
    next(err);
  }
});

module.exports = router;
