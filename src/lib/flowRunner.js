const { pool, select, insert, update } = require('./db');
const { getModule } = require('../modules');
const { getConnection } = require('./connections');
const logger = require('./logger');

/**
 * Resolves a step's input_map into concrete values. Each field in
 * input_map is either a static value, or a reference object:
 *   { fromStep: "<step order_index>", field: "messages" }
 * pulling from a previous step's output, stored in `results` keyed by
 * order_index.
 */
function resolveInput(inputMap, results) {
  const resolved = {};
  for (const [key, val] of Object.entries(inputMap || {})) {
    if (val && typeof val === 'object' && 'fromStep' in val) {
      const prior = results[val.fromStep];
      resolved[key] = prior ? prior[val.field] : undefined;
    } else {
      resolved[key] = val;
    }
  }
  return resolved;
}

function evaluateCondition(condition, results) {
  if (!condition) return { proceed: true };
  const { field, operator, value, fromStep, skipToStepId } = condition;
  const source = results[fromStep] || {};
  const actual = source[field];

  const ops = {
    equals: (a, b) => a === b,
    notEquals: (a, b) => a !== b,
    contains: (a, b) => typeof a === 'string' && a.includes(b),
    greaterThan: (a, b) => Number(a) > Number(b),
    lessThan: (a, b) => Number(a) < Number(b),
    exists: (a) => a !== undefined && a !== null,
  };

  const passes = (ops[operator] || (() => true))(actual, value);
  return { proceed: passes, skipToStepId: !passes ? skipToStepId : null };
}

/**
 * Runs a flow's steps in order. No persistent execution engine, no
 * retries, no branching graph - just a for-loop over the steps, each one
 * a single call into a module's action handler. Logs the run to
 * sm_flow_runs for visibility.
 */
async function runFlow(flowId, userId, orgId) {
  const steps = await select(
    'sm_flow_steps',
    { flow_id: flowId },
    ['*'],
    { orderBy: 'order_index', orderDirection: 'ASC' }
  );

  const run = await insert('sm_flow_runs', { 
    flow_id: flowId, 
    status: 'running' 
  });

  const results = {};
  let skipUntilStepId = null;

  try {
    for (const step of steps) {
      if (skipUntilStepId && step.id !== skipUntilStepId) continue;
      skipUntilStepId = null;

      const { proceed, skipToStepId } = evaluateCondition(step.condition, results);
      if (!proceed) {
        skipUntilStepId = skipToStepId;
        continue;
      }

      const mod = getModule(step.module);
      if (!mod) throw new Error(`Unknown module "${step.module}" in step ${step.id}`);
      const action = mod.actions[step.action];
      if (!action) throw new Error(`Unknown action "${step.action}" in module "${step.module}"`);

      const input = resolveInput(step.input_map, results);
      const parsed = action.inputSchema.parse(input);
      const connection = await getConnection(step.connection_id, userId, orgId);

      const output = await action.handler({ connection, input: parsed });
      results[step.order_index] = output;
    }

    await update('sm_flow_runs', { 
      status: 'success', 
      finished_at: new Date().toISOString(), 
      step_results: results 
    }, { id: run.id });

    return { runId: run.id, status: 'success', results };
  } catch (err) {
    logger.error({ err, flowId }, '[flowRunner] run failed');
    await update('sm_flow_runs', { 
      status: 'failed', 
      finished_at: new Date().toISOString(), 
      step_results: results, 
      error: err.message 
    }, { id: run.id });

    return { runId: run.id, status: 'failed', error: err.message, results };
  }
}

module.exports = { runFlow };
