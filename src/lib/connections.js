const { google } = require('googleapis');
const { select, update } = require('./db');
const TABLES = require('./db').TABLES;
const env = require('../config/env');
const logger = require('./logger');

const REFRESH_BUFFER_MS = 5 * 60 * 1000; // refresh if expiring within 5 min

/**
 * Loads a connection row owned by orgId, and refreshes the access token
 * proactively if it's near expiry (rather than waiting for the provider
 * to return a 401).
 *
 * NOTE: tokens are stored in plain text (no at-rest encryption). Anyone
 * with read access to sm_connections can read live OAuth tokens directly.
 */
async function getConnection(connectionId, userId, orgId) {
  const connections = await select(
    TABLES.CONNECTIONS,
    { 
      id: connectionId,
      org_id: orgId  // org_id only filter (user_id removed from schema)
    }
  );
  
  const data = connections[0];
  if (!data) throw Object.assign(new Error('Connection not found or not owned by this org'), { status: 404, code: 'connection_not_found' });
  if (data.status !== 'active') throw Object.assign(new Error(`Connection is ${data.status}`), { status: 409, code: 'connection_inactive' });

  let accessToken = data.access_token;
  const refreshToken = data.refresh_token;
  const expiresAt = new Date(data.token_expiry).getTime();

  if (data.provider === 'google' && expiresAt - Date.now() < REFRESH_BUFFER_MS) {
    const refreshed = await refreshGoogleToken(refreshToken);
    accessToken = refreshed.access_token;

    await update(TABLES.CONNECTIONS, {
      access_token: accessToken,
      token_expiry: new Date(Date.now() + refreshed.expires_in * 1000).toISOString(),
    }, { id: connectionId });

    logger.info(`[connections] refreshed google token for connection ${connectionId}`);
  }

  return {
    id: data.id,
    provider: data.provider,
    module: data.module || null,
    accountLabel: data.account_label,
    accessToken,
    refreshToken,
  };
}

async function refreshGoogleToken(refreshToken) {
  const client = new google.auth.OAuth2(env.google.clientId, env.google.clientSecret, env.google.redirectUri);
  client.setCredentials({ refresh_token: refreshToken });
  const { credentials } = await client.refreshAccessToken();
  return {
    access_token: credentials.access_token,
    expires_in: Math.floor((credentials.expiry_date - Date.now()) / 1000),
  };
}

module.exports = { getConnection };
