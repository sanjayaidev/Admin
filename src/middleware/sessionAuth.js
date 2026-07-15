const { supabase, TABLES } = require('../lib/supabase');
const logger = require('../lib/logger');

/**
 * Session-based authentication middleware for Google Modules integration.
 * 
 * Expects user to be authenticated via session cookie (from ClientPM auth system).
 * Attaches req.user and req.orgId from the session.
 * 
 * This replaces the apiKeyAuth middleware for module routes, allowing the
 * integrations to work seamlessly with ClientPM's existing auth system.
 */
async function sessionAuth(req, res, next) {
  try {
    // User should already be authenticated by ClientPM's requireAuth middleware
    // We just need to ensure they have an org_id
    if (!req.user || !req.user.id) {
      return res.status(401).json({ 
        error: 'unauthenticated', 
        message: 'You must be logged in to access this resource' 
      });
    }

    if (!req.user.orgId) {
      return res.status(403).json({ 
        error: 'no_organization', 
        message: 'User does not belong to any organization' 
      });
    }

    // Attach orgId for downstream handlers
    req.orgId = req.user.orgId;

    next();
  } catch (err) {
    logger.error({ err }, '[sessionAuth] unexpected error');
    res.status(500).json({ error: 'internal_error' });
  }
}

module.exports = sessionAuth;
