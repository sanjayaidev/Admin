// lib/google/auth.js
// Google OAuth 2.0 authentication flow

const { google } = require('googleapis');
const { pool } = require('../db');

const SCOPES = [
  'https://www.googleapis.com/auth/calendar',
  'https://www.googleapis.com/auth/drive',
  'https://www.googleapis.com/auth/spreadsheets',
  'https://www.googleapis.com/auth/gmail.send'
];

let oauth2Client = null;

function getOAuth2Client() {
  if (oauth2Client) {
    return oauth2Client;
  }

  oauth2Client = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI || 'http://localhost:3000/api/integrations/google/callback'
  );

  return oauth2Client;
}

// Generate authorization URL for Google OAuth
function getAuthorizationUrl(userId) {
  const auth = getOAuth2Client();
  return auth.generateAuthUrl({
    access_type: 'offline',
    scope: SCOPES,
    state: userId.toString(),
    prompt: 'consent' // Force refresh token
  });
}

// Handle OAuth callback and store tokens
async function handleCallback(code, userId) {
  const auth = getOAuth2Client();
  
  try {
    const { tokens } = await auth.getToken(code);
    
    // Store tokens in database
    await pool.query(`
      INSERT INTO integrations (user_id, provider, access_token, refresh_token, expiry_date, is_active)
      VALUES ($1, 'google_calendar', $2, $3, $4, TRUE)
      ON CONFLICT (user_id, provider) 
      DO UPDATE SET 
        access_token = $2,
        refresh_token = COALESCE($3, integrations.refresh_token),
        expiry_date = $4,
        is_active = TRUE,
        updated_at = CURRENT_TIMESTAMP
    `, [userId, tokens.access_token, tokens.refresh_token, tokens.expiry_date]);

    // Also mark user's google_calendar_sync as enabled
    await pool.query(`
      UPDATE users SET google_calendar_sync = TRUE WHERE id = $1
    `, [userId]);

    return { success: true, tokens };
  } catch (error) {
    console.error('Error handling Google OAuth callback:', error);
    throw error;
  }
}

// Get authenticated Google client for a user
async function getGoogleClient(userId) {
  // Get stored tokens
  const { rows } = await pool.query(`
    SELECT access_token, refresh_token, expiry_date 
    FROM integrations 
    WHERE user_id = $1 AND provider = 'google_calendar' AND is_active = TRUE
  `, [userId]);

  if (rows.length === 0) {
    throw new Error('Google integration not found for this user');
  }

  const integration = rows[0];
  const auth = getOAuth2Client();

  auth.setCredentials({
    access_token: integration.access_token,
    refresh_token: integration.refresh_token,
    expiry_date: integration.expiry_date
  });

  // Auto-refresh token if expired
  auth.on('tokens', async (tokens) => {
    if (tokens.refresh_token) {
      await pool.query(`
        UPDATE integrations 
        SET access_token = $1, refresh_token = $2, expiry_date = $3, updated_at = CURRENT_TIMESTAMP
        WHERE user_id = $4 AND provider = 'google_calendar'
      `, [tokens.access_token, tokens.refresh_token, tokens.expiry_date, userId]);
    } else if (tokens.access_token) {
      await pool.query(`
        UPDATE integrations 
        SET access_token = $1, expiry_date = $2, updated_at = CURRENT_TIMESTAMP
        WHERE user_id = $3 AND provider = 'google_calendar'
      `, [tokens.access_token, tokens.expiry_date, userId]);
    }
  });

  return google.calendar({ version: 'v3', auth });
}

// Disconnect Google integration
async function disconnectGoogle(userId) {
  await pool.query(`
    UPDATE integrations SET is_active = FALSE, updated_at = CURRENT_TIMESTAMP
    WHERE user_id = $1 AND provider = 'google_calendar'
  `, [userId]);

  await pool.query(`
    UPDATE users SET google_calendar_sync = FALSE WHERE id = $1
  `, [userId]);

  return { success: true };
}

module.exports = {
  getOAuth2Client,
  getAuthorizationUrl,
  handleCallback,
  getGoogleClient,
  disconnectGoogle,
  SCOPES
};
