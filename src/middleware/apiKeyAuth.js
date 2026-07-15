const { select, update } = require('../lib/db');
const TABLES = require('../lib/db').TABLES;
const { hashApiKey } = require('../lib/encryption');
const logger = require('../lib/logger');

/**
 * Expects header: Authorization: Bearer sm_live_xxxxx
 * Looks up the hash (never the raw key) against sm_api_keys.
 * Attaches req.user = { id, org_id } and req.apiKey = { id } on success.
 */
async function apiKeyAuth(req, res, next) {
  try {
    const authHeader = req.headers.authorization || '';
    const [scheme, rawKey] = authHeader.split(' ');

    if (scheme !== 'Bearer' || !rawKey) {
      return res.status(401).json({ error: 'missing_api_key', message: 'Provide: Authorization: Bearer <api_key>' });
    }

    const keyHash = hashApiKey(rawKey);

    const keys = await select(TABLES.API_KEYS, { key_hash: keyHash }, ['id', 'user_id', 'org_id']);

    if (!keys || keys.length === 0) {
      return res.status(401).json({ error: 'invalid_api_key' });
    }

    const data = keys[0];
    
    // Check if revoked (add revoked_at column if needed)
    if (data.revoked_at) {
      return res.status(401).json({ error: 'invalid_api_key' });
    }

    // Get user details including org_id
    const users = await select(TABLES.USERS, { id: data.user_id }, ['id', 'org_id', 'email', 'full_name', 'role']);
    
    if (!users || users.length === 0) {
      return res.status(401).json({ error: 'user_not_found' });
    }

    const user = users[0];

    req.user = { 
      id: user.id, 
      org_id: user.org_id,
      email: user.email,
      full_name: user.full_name,
      role: user.role
    };
    req.apiKey = { id: data.id };

    // Fire-and-forget last_used_at update
    update(TABLES.API_KEYS, 
      { last_used_at: new Date().toISOString() },
      { id: data.id }
    ).catch((err) => logger.warn({ err }, '[apiKeyAuth] failed to update last_used_at'));

    next();
  } catch (err) {
    logger.error({ err }, '[apiKeyAuth] unexpected error');
    res.status(500).json({ error: 'internal_error' });
  }
}

module.exports = apiKeyAuth;
