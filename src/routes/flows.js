const express = require('express');
const { pool, select, insert, delete: deleteRows } = require('../lib/db');
const { runFlow } = require('../lib/flowRunner');
const logger = require('../lib/logger');

const router = express.Router();

// Simple rate limiter for manual flow runs
function actionRateLimiter(req, res, next) {
  const now = Date.now();
  const key = `ratelimit:${req.user?.id}:${req.params.id}`;
  
  if (!global.rateLimitStore) global.rateLimitStore = new Map();
  
  const entry = global.rateLimitStore.get(key) || { count: 0, resetAt: now + 60000 };
  if (now > entry.resetAt) {
    entry.count = 1;
    entry.resetAt = now + 60000;
  } else {
    entry.count++;
  }
  
  global.rateLimitStore.set(key, entry);
  
  if (entry.count > 10) {
    return res.status(429).json({ error: 'rate_limit_exceeded', message: 'Too many requests. Try again later.' });
  }
  
  next();
}

// GET /flows - list this user's flows (filtered by org_id for multi-tenancy)
router.get('/', async (req, res, next) => {
  try {
    const userId = req.user?.id;
    const orgId = req.user?.orgId;
    
    if (!userId || !orgId) {
      return res.status(401).json({ error: 'unauthorized', message: 'You must be logged in' });
    }

    const flows = await select(
      'sm_flows',
      { user_id: userId, org_id: orgId },
      ['*'],
      { orderBy: 'created_at', orderDirection: 'DESC' }
    );

    // Get steps for each flow
    const flowIds = flows.map(f => f.id);
    let steps = [];
    if (flowIds.length > 0) {
      steps = await select(
        'sm_flow_steps',
        { flow_id: flowIds },
        ['*']
      );
    }

    // Combine flows with their steps
    const flowsWithSteps = flows.map(flow => ({
      ...flow,
      sm_flow_steps: steps.filter(s => s.flow_id === flow.id)
    }));

    res.json({ flows: flowsWithSteps });
  } catch (err) {
    next(err);
  }
});

// POST /flows { name, triggerType, triggerConfig, steps: [{ module, action, connectionId, inputMap, condition }] }
router.post('/', express.json(), async (req, res, next) => {
  try {
    const userId = req.user?.id;
    const orgId = req.user?.orgId;
    
    if (!userId || !orgId) {
      return res.status(401).json({ error: 'unauthorized', message: 'You must be logged in' });
    }

    const { name, triggerType = 'manual', triggerConfig = {}, steps = [] } = req.body || {};
    if (!name || !Array.isArray(steps) || steps.length === 0) {
      return res.status(400).json({ error: 'invalid_input', message: 'name and at least one step required' });
    }

    const flow = await insert('sm_flows', { 
      user_id: userId, 
      org_id: orgId, 
      name, 
      trigger_type: triggerType, 
      trigger_config: triggerConfig 
    });

    const stepRows = steps.map((s, i) => ({
      flow_id: flow.id,
      order_index: i,
      module: s.module,
      action: s.action,
      connection_id: s.connectionId,
      input_map: s.inputMap || {},
      condition: s.condition || null,
    }));

    for (const step of stepRows) {
      await insert('sm_flow_steps', step);
    }

    res.status(201).json({ flow });
  } catch (err) {
    logger.error({ err }, '[flows] create failed');
    next(err);
  }
});

// POST /flows/:id/run - executes the flow's steps in order right now (manual trigger)
router.post('/:id/run', actionRateLimiter, async (req, res, next) => {
  try {
    const userId = req.user?.id;
    const orgId = req.user?.orgId;
    
    if (!userId || !orgId) {
      return res.status(401).json({ error: 'unauthorized', message: 'You must be logged in' });
    }

    const flows = await select('sm_flows', { id: req.params.id, user_id: userId, org_id: orgId });
    const flow = flows[0];
    
    if (!flow) {
      return res.status(404).json({ error: 'flow_not_found' });
    }

    const result = await runFlow(flow.id, userId, orgId);
    res.json(result);
  } catch (err) {
    logger.error({ err }, '[flows] run failed');
    next(err);
  }
});

// DELETE /flows/:id
router.delete('/:id', async (req, res, next) => {
  try {
    const userId = req.user?.id;
    const orgId = req.user?.orgId;
    
    if (!userId || !orgId) {
      return res.status(401).json({ error: 'unauthorized', message: 'You must be logged in' });
    }

    const deletedCount = await deleteRows('sm_flows', { 
      id: req.params.id, 
      user_id: userId, 
      org_id: orgId 
    });
    
    if (deletedCount === 0) {
      return res.status(404).json({ error: 'flow_not_found' });
    }
    
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
