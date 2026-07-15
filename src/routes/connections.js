const express = require('express');
const { select, delete: del } = require('../lib/db');
const TABLES = require('../lib/db').TABLES;
const sessionAuth = require('../middleware/sessionAuth');
const logger = require('../lib/logger');

const router = express.Router();
router.use(sessionAuth);

// GET /connections - list the user's connected accounts (no tokens returned)
// Filtered by org_id for multi-tenancy
router.get('/', async (req, res, next) => {
  try {
    const connections = await select(
      TABLES.CONNECTIONS,
      { 
        user_id: req.user.id,
        org_id: req.user.org_id  // Multi-tenant filter
      },
      ['id', 'provider', 'module', 'account_label', 'status', 'scopes', 'created_at'],
      { orderBy: 'created_at', orderDirection: 'DESC' }
    );
    
    res.json({ connections });
  } catch (err) {
    logger.error({ err }, '[connections] list failed');
    next(err);
  }
});

// DELETE /connections/:id - revoke/remove a connection
// Verify ownership by user_id AND org_id
router.delete('/:id', async (req, res, next) => {
  try {
    const deleted = await del(TABLES.CONNECTIONS, {
      id: req.params.id,
      user_id: req.user.id,
      org_id: req.user.org_id  // Multi-tenant verification
    });
    
    if (deleted === 0) {
      return res.status(404).json({ error: 'Connection not found' });
    }
    
    res.json({ success: true });
  } catch (err) {
    logger.error({ err }, '[connections] delete failed');
    next(err);
  }
});

module.exports = router;
