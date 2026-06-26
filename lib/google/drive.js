// lib/google/drive.js
// Google Drive integration

const { google } = require('googleapis');
const { pool } = require('../db');
const { getOAuth2Client } = require('./auth');

// Get authenticated Drive client for a user
async function getDriveClient(userId) {
  const { rows } = await pool.query(`
    SELECT access_token, refresh_token, expiry_date 
    FROM integrations 
    WHERE user_id = $1 AND provider = 'google_drive' AND is_active = TRUE
  `, [userId]);

  if (rows.length === 0) {
    // Try to use calendar credentials if drive not separately connected
    const calRows = await pool.query(`
      SELECT access_token, refresh_token, expiry_date 
      FROM integrations 
      WHERE user_id = $1 AND provider = 'google_calendar' AND is_active = TRUE
    `, [userId]);

    if (calRows.length === 0) {
      throw new Error('Google Drive not connected for this user');
    }
    
    const integration = calRows[0];
    const auth = getOAuth2Client();
    auth.setCredentials({
      access_token: integration.access_token,
      refresh_token: integration.refresh_token,
      expiry_date: integration.expiry_date
    });
    return google.drive({ version: 'v3', auth });
  }

  const integration = rows[0];
  const auth = getOAuth2Client();

  auth.setCredentials({
    access_token: integration.access_token,
    refresh_token: integration.refresh_token,
    expiry_date: integration.expiry_date
  });

  // Auto-refresh tokens
  auth.on('tokens', async (tokens) => {
    if (tokens.access_token || tokens.refresh_token) {
      await pool.query(`
        UPDATE integrations 
        SET access_token = COALESCE($1, access_token), 
            refresh_token = COALESCE($2, refresh_token),
            expiry_date = COALESCE($3, expiry_date),
            updated_at = CURRENT_TIMESTAMP
        WHERE user_id = $4 AND provider = 'google_drive'
      `, [tokens.access_token, tokens.refresh_token, tokens.expiry_date, userId]);
    }
  });

  return google.drive({ version: 'v3', auth });
}

// Create a folder for a client
async function createClientFolder(clientName, userId) {
  try {
    const drive = await getDriveClient(userId);
    
    const fileMetadata = {
      name: `Client - ${clientName}`,
      mimeType: 'application/vnd.google-apps.folder'
    };

    const response = await drive.files.create({
      requestBody: fileMetadata,
      fields: 'id, name, webViewLink'
    });

    // Store folder ID in settings
    await pool.query(`
      INSERT INTO integrations (user_id, provider, settings)
      VALUES ($1, 'google_drive_folder', $2)
      ON CONFLICT (user_id, provider) DO UPDATE SET settings = $2
    `, [userId, JSON.stringify({ [clientName]: response.data.id })]);

    return { success: true, folderId: response.data.id, url: response.data.webViewLink };
  } catch (error) {
    console.error('Error creating Drive folder:', error);
    throw error;
  }
}

// Upload a file to a folder
async function uploadFile(fileBuffer, fileName, folderId, mimeType, userId) {
  try {
    const drive = await getDriveClient(userId);
    
    const fileMetadata = {
      name: fileName,
      parents: [folderId]
    };

    const media = {
      mimeType: mimeType,
      body: fileBuffer
    };

    const response = await drive.files.create({
      requestBody: fileMetadata,
      media: media,
      fields: 'id, name, webViewLink, webContentLink'
    });

    return { 
      success: true, 
      fileId: response.data.id, 
      url: response.data.webViewLink,
      downloadUrl: response.data.webContentLink 
    };
  } catch (error) {
    console.error('Error uploading file to Drive:', error);
    throw error;
  }
}

// List files in a folder
async function listFiles(folderId, userId) {
  try {
    const drive = await getDriveClient(userId);
    
    const response = await drive.files.list({
      q: `'${folderId}' in parents and trashed = false`,
      fields: 'files(id, name, mimeType, webViewLink, createdTime, size)'
    });

    return response.data.files || [];
  } catch (error) {
    console.error('Error listing Drive files:', error);
    throw error;
  }
}

// Delete a file
async function deleteFile(fileId, userId) {
  try {
    const drive = await getDriveClient(userId);
    
    await drive.files.delete({
      fileId: fileId
    });

    return { success: true };
  } catch (error) {
    console.error('Error deleting Drive file:', error);
    throw error;
  }
}

// Share a file with someone
async function shareFile(fileId, email, userId, role = 'reader') {
  try {
    const drive = await getDriveClient(userId);
    
    const permission = {
      type: 'user',
      role: role,
      emailAddress: email
    };

    const response = await drive.permissions.create({
      fileId: fileId,
      requestBody: permission,
      fields: 'id'
    });

    return { success: true, permissionId: response.data.id };
  } catch (error) {
    console.error('Error sharing Drive file:', error);
    throw error;
  }
}

module.exports = {
  getDriveClient,
  createClientFolder,
  uploadFile,
  listFiles,
  deleteFile,
  shareFile
};
