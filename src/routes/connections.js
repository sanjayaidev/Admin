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
    logger.info({ userId: req.user.id, orgId: req.user.org_id }, '[connections] Listing connections');
    
    const connections = await select(
      TABLES.CONNECTIONS,
      { 
        org_id: req.user.org_id  // Multi-tenant filter
      },
      ['id', 'provider', 'module', 'account_label', 'status', 'scopes', 'created_at'],
      { orderBy: 'created_at', orderDirection: 'DESC' }
    );
    
    logger.info({ count: connections.length }, '[connections] Found connections');
    res.json({ connections });
  } catch (err) {
    logger.error({ err }, '[connections] list failed');
    next(err);
  }
});

// DELETE /connections/:id - revoke/remove a connection
// Verify ownership by org_id only (user_id removed from schema)
router.delete('/:id', async (req, res, next) => {
  try {
    const deleted = await del(TABLES.CONNECTIONS, {
      id: req.params.id,
      org_id: req.user.org_id  // Multi-tenant verification
    });
    
    if (deleted === 0) {
      return res.status(404).json({ error: 'Connection not found' });
    }
    
    logger.info({ connectionId: req.params.id }, '[connections] Deleted connection');
    res.json({ success: true });
  } catch (err) {
    logger.error({ err }, '[connections] delete failed');
    next(err);
  }
});

module.exports = router;
