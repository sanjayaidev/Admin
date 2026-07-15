const express = require('express');
const { supabase, TABLES } = require('../lib/supabase');
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
    const { data, error } = await supabase
      .from(TABLES.CONNECTIONS)
      .select('id, provider, module, account_label, status, scopes, created_at')
      .eq('user_id', userId)
      .eq('org_id', orgId)
      .order('created_at', { ascending: false });

    if (error) throw error;
    res.json({ connections: data });
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
    const { error } = await supabase
      .from(TABLES.CONNECTIONS)
      .delete()
      .eq('id', req.params.id)
      .eq('user_id', userId)
      .eq('org_id', orgId);

    if (error) throw error;
    res.json({ success: true });
  } catch (err) {
    logger.error({ err }, '[connections] delete failed');
    next(err);
  }
});

module.exports = router;
