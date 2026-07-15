const { pool } = require('../lib/db');
const logger = require('../lib/logger');

// Simple hash function for API keys (using basic string hashing)
function hashApiKey(key) {
  // Simple hash - in production you might want to use crypto.createHash('sha256')
  let hash = 0;
  for (let i = 0; i < key.length; i++) {
    const char = key.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32bit integer
  }
  return Math.abs(hash).toString();
}

/**
 * Expects header: Authorization: Bearer sm_live_xxxxx
 * Looks up the hash (never the raw key) against sm_api_keys.
 * Attaches req.user = { id } and req.apiKey = { id } on success.
 */
async function apiKeyAuth(req, res, next) {
  try {
    const authHeader = req.headers.authorization || '';
    const [scheme, rawKey] = authHeader.split(' ');

    if (scheme !== 'Bearer' || !rawKey) {
      return res.status(401).json({ error: 'missing_api_key', message: 'Provide: Authorization: Bearer <api_key>' });
    }

    const keyHash = hashApiKey(rawKey);

    const result = await pool.query(
      'SELECT id, user_id, revoked_at FROM sm_api_keys WHERE key_hash = $1 LIMIT 1',
      [keyHash]
    );
    
    const data = result.rows[0];

    if (!data) {
      return res.status(401).json({ error: 'invalid_api_key' });
    }
    
    if (data.revoked_at) {
      return res.status(401).json({ error: 'invalid_api_key' });
    }

    req.user = { id: data.user_id };
    req.apiKey = { id: data.id };

    // Fire-and-forget last_used_at update, doesn't block the request.
    pool.query(
      'UPDATE sm_api_keys SET last_used_at = $1 WHERE id = $2',
      [new Date().toISOString(), data.id]
    ).catch((err) => logger.warn({ err }, '[apiKeyAuth] failed to update last_used_at'));

    next();
  } catch (err) {
    logger.error({ err }, '[apiKeyAuth] unexpected error');
    res.status(500).json({ error: 'internal_error' });
  }
}

module.exports = apiKeyAuth;
