const express = require('express');
const { select, insert, update, delete: del } = require('../lib/db');
const TABLES = require('../lib/db').TABLES;
const { runFlow } = require('../lib/flowRunner');
const sessionAuth = require('../middleware/sessionAuth');
const { actionRateLimiter } = require('../middleware/rateLimiter');
const logger = require('../lib/logger');

const router = express.Router();
router.use(sessionAuth);

// GET /flows - list this user's flows (filtered by org_id)
router.get('/', async (req, res, next) => {
  try {
    // Get flows with their steps - org_id only filter
    const flows = await select(
      TABLES.FLOWS,
      { org_id: req.user.org_id },
      ['*'],
      { orderBy: 'created_at', orderDirection: 'DESC' }
    );
    
    // Get steps for all flows
    const flowIds = flows.map(f => f.id);
    let steps = [];
    if (flowIds.length > 0) {
      steps = await select(
        TABLES.FLOW_STEPS,
        { flow_id: flowIds },  // IN clause
        ['*'],
        { orderBy: 'order_index', orderDirection: 'ASC' }
      );
    }
    
    // Attach steps to flows
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
    const { name, triggerType = 'manual', triggerConfig = {}, steps = [] } = req.body || {};
    if (!name || !Array.isArray(steps) || steps.length === 0) {
      return res.status(400).json({ error: 'invalid_input', message: 'name and at least one step required' });
    }

    // Insert flow with org_id only (user_id removed from schema)
    const flow = await insert(TABLES.FLOWS, { 
      org_id: req.user.org_id,  // Multi-tenant scoping
      name, 
      trigger_type: triggerType, 
      trigger_config: triggerConfig 
    });

    // Insert steps
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
      await insert(TABLES.FLOW_STEPS, step);
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
    // Verify flow ownership with org_id only
    const flows = await select(TABLES.FLOWS, { 
      id: req.params.id, 
      org_id: req.user.org_id 
    }, ['id']);
    
    if (!flows || flows.length === 0) {
      return res.status(404).json({ error: 'flow_not_found' });
    }
    
    const result = await runFlow(flows[0].id, req.user.id, req.user.org_id);
    res.json(result);
  } catch (err) {
    logger.error({ err }, '[flows] run failed');
    next(err);
  }
});

// DELETE /flows/:id
router.delete('/:id', async (req, res, next) => {
  try {
    const deleted = await del(TABLES.FLOWS, { 
      id: req.params.id, 
      org_id: req.user.org_id 
    });
    
    if (deleted === 0) {
      return res.status(404).json({ error: 'flow_not_found' });
    }
    
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
