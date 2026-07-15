const express = require('express');
const { select, delete: deleteRows } = require('../lib/db');
const logger = require('../lib/logger');

const router = express.Router();

// GET /connections - list the caller's connected accounts (no tokens returned)
// Filtered by organization for multi-tenancy
router.get('/', async (req, res, next) => {
  try {
    const userId = req.user?.id;
    const orgId = req.user?.orgId;
    
    if (!userId || !orgId) {
      return res.status(401).json({ error: 'unauthorized', message: 'You must be logged in' });
    }

    // Get connections for this user within their organization
    const connections = await select(
      'sm_connections',
      { user_id: userId, org_id: orgId },
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
router.delete('/:id', async (req, res, next) => {
  try {
    const userId = req.user?.id;
    const orgId = req.user?.orgId;
    
    if (!userId || !orgId) {
      return res.status(401).json({ error: 'unauthorized', message: 'You must be logged in' });
    }

    // Delete connection only if it belongs to this user and organization
    const deletedCount = await deleteRows('sm_connections', {
      id: req.params.id,
      user_id: userId,
      org_id: orgId
    });

    if (deletedCount === 0) {
      return res.status(404).json({ error: 'not_found', message: 'Connection not found' });
    }

    res.json({ success: true });
  } catch (err) {
    logger.error({ err }, '[connections] delete failed');
    next(err);
  }
});

module.exports = router;
