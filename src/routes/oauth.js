const express = require('express');
const crypto = require('crypto');
const { google } = require('googleapis');
const env = require('../config/env');
const { insert } = require('../lib/db');
const logger = require('../lib/logger');

const router = express.Router();

// In-memory state store keyed by random state token -> { userId, orgId, expiresAt }.
// Fine for a single-instance deployment; move to Supabase/Redis if you scale
// to multiple server instances behind a load balancer.
const pendingStates = new Map();

function cleanupExpiredStates() {
  const now = Date.now();
  for (const [state, entry] of pendingStates) {
    if (entry.expiresAt < now) pendingStates.delete(state);
  }
}

// GET /oauth/google/start?module=gmail
// Uses session auth (user already authenticated via ClientPM session)
router.get('/google/start', (req, res) => {
  const moduleName = req.query.module;
  
  // Get user from session (attached by parent router's auth middleware)
  const userId = req.user?.id;
  const orgId = req.user?.orgId;
  
  if (!userId || !orgId) {
    return res.status(401).json({ error: 'unauthorized', message: 'You must be logged in' });
  }

  // Validate module exists
  const validModules = ['gmail', 'calendar', 'sheets', 'docs', 'drive', 'forms', 'googleBusinessProfile'];
  if (!moduleName || !validModules.includes(moduleName)) {
    return res.status(400).json({ error: 'invalid_module', message: 'Provide ?module=<valid_google_module>' });
  }

  cleanupExpiredStates();
  const state = crypto.randomBytes(24).toString('base64url');
  // returnTo: which page initiated the connect, so the callback can send
  // the user back to the flow builder canvas instead of always landing on
  // the classic dashboard.
  const returnTo = req.query.returnTo === 'flow-builder' ? 'flow-builder' : 'connections';
  pendingStates.set(state, { userId, orgId, moduleName, returnTo, expiresAt: Date.now() + 10 * 60 * 1000 });

  const client = new google.auth.OAuth2(env.google.clientId, env.google.clientSecret, env.google.redirectUri);

  // Always request the userinfo scope on top of whatever the module needs -
  // the callback uses it to look up the connected account's email address,
  // so without it the userinfo request 401s even though the module scopes
  // (e.g. Gmail) were granted correctly.
  const moduleScopes = getModuleScopes(moduleName);
  const scope = Array.from(new Set([
    ...moduleScopes,
    'https://www.googleapis.com/auth/userinfo.email',
  ]));

  const url = client.generateAuthUrl({
    access_type: 'offline', // required to get a refresh_token
    prompt: 'consent', // ensures refresh_token is returned even on repeat connects
    scope,
    state,
  });

  res.json({ authUrl: url });
});

// GET /oauth/google/callback?code=...&state=...
// No apiKeyAuth here - this is hit by Google's redirect, not our own client.
// The `state` value is what ties this callback back to a known user.
router.get('/google/callback', async (req, res) => {
  const { code, state, error: oauthError } = req.query;

  if (oauthError) {
    return res.status(400).send(`Google OAuth error: ${oauthError}`);
  }

  const entry = pendingStates.get(state);
  if (!entry || entry.expiresAt < Date.now()) {
    return res.status(400).send('Invalid or expired OAuth state. Please restart the connection flow.');
  }
  pendingStates.delete(state); // one-time use

  try {
    const client = new google.auth.OAuth2(env.google.clientId, env.google.clientSecret, env.google.redirectUri);
    const { tokens } = await client.getToken(code);

    if (!tokens.refresh_token) {
      logger.warn('[oauth] No refresh_token returned - user may have connected before without revoking access');
    }

    // Set credentials on the OAuth2 client so it can make authenticated requests
    client.setCredentials(tokens);
    
    // Verify the access token is present before making the request
    const creds = client.credentials;
    if (!creds.access_token) {
      logger.error('[oauth] No access token available after setting credentials');
      return res.status(500).send('OAuth token exchange failed - no access token.');
    }
    
    // Use the OAuth2 client to make an authenticated request directly
    // This is more reliable than using google.oauth2() wrapper
    const userinfoRes = await client.requestAsync({
      url: 'https://www.googleapis.com/oauth2/v2/userinfo',
    });
    const profile = userinfoRes.data;

    // Store connection with org_id for multi-tenancy
    await insert('sm_connections', {
      user_id: entry.userId,
      org_id: entry.orgId,
      provider: 'google',
      module: entry.moduleName, // scopes this account to the module it was connected for
      account_label: profile.email,
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token || '',
      expires_at: new Date(tokens.expiry_date).toISOString(),
      scopes: (tokens.scope || '').split(' '),
      status: 'active',
    });

    // Redirect back to your frontend UI
    const base = env.publicBaseUrl || `${req.protocol}://${req.get('host')}`;
    const landingPath = entry.returnTo === 'flow-builder' ? '/flow-builder.html' : '/connections.html';
    res.redirect(`${base}${landingPath}?provider=google&email=${encodeURIComponent(profile.email)}`);
  } catch (err) {
    logger.error({ err }, '[oauth] token exchange failed');
    res.status(500).send('OAuth token exchange failed.');
  }
});

/**
 * Get OAuth scopes for a specific Google module
 */
function getModuleScopes(moduleName) {
  const scopeMap = {
    gmail: ['https://www.googleapis.com/auth/gmail.send', 'https://www.googleapis.com/auth/gmail.readonly'],
    calendar: ['https://www.googleapis.com/auth/calendar.events', 'https://www.googleapis.com/auth/calendar.readonly'],
    sheets: ['https://www.googleapis.com/auth/spreadsheets'],
    docs: ['https://www.googleapis.com/auth/documents'],
    drive: ['https://www.googleapis.com/auth/drive.file'],
    forms: ['https://www.googleapis.com/auth/forms.body'],
    googleBusinessProfile: ['https://www.googleapis.com/auth/business.manage'],
  };
  return scopeMap[moduleName] || [];
}

module.exports = router;
