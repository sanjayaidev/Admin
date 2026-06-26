// lib/google/sheets.js
// Google Sheets integration

const { google } = require('googleapis');
const { pool } = require('../db');
const { getOAuth2Client } = require('./auth');

// Get authenticated Sheets client for a user
async function getSheetsClient(userId) {
  const { rows } = await pool.query(`
    SELECT access_token, refresh_token, expiry_date 
    FROM integrations 
    WHERE user_id = $1 AND provider IN ('google_sheets', 'google_calendar') AND is_active = TRUE
    LIMIT 1
  `, [userId]);

  if (rows.length === 0) {
    throw new Error('Google Sheets not connected for this user');
  }

  const integration = rows[0];
  const auth = getOAuth2Client();

  auth.setCredentials({
    access_token: integration.access_token,
    refresh_token: integration.refresh_token,
    expiry_date: integration.expiry_date
  });

  return google.sheets({ version: 'v4', auth });
}

// Export data to a Google Sheet
async function exportToSheet(data, sheetName, userId) {
  try {
    const sheets = await getSheetsClient(userId);
    const drive = google.drive({ version: 'v3', auth: auth });

    // Create a new spreadsheet
    const response = await sheets.spreadsheets.create({
      requestBody: {
        properties: {
          title: sheetName || `ClientPM Export - ${new Date().toISOString()}`
        }
      }
    });

    const spreadsheetId = response.data.spreadsheetId;

    // Prepare data for insertion
    const rows = data.map(item => Object.values(item));
    const headers = Object.keys(data[0] || {});

    // Add headers and data
    const values = [headers, ...rows];

    await sheets.spreadsheets.values.update({
      spreadsheetId: spreadsheetId,
      range: 'A1',
      valueInputOption: 'USER_ENTERED',
      requestBody: {
        values: values
      }
    });

    return { success: true, spreadsheetId, url: response.data.spreadsheetUrl };
  } catch (error) {
    console.error('Error exporting to Google Sheets:', error);
    throw error;
  }
}

// Import data from a Google Sheet
async function importFromSheet(spreadsheetId, range = 'Sheet1!A1:Z1000', userId) {
  try {
    const sheets = await getSheetsClient(userId);

    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: spreadsheetId,
      range: range
    });

    const rows = response.data.values || [];
    if (rows.length === 0) {
      return [];
    }

    const headers = rows[0];
    const data = rows.slice(1).map(row => {
      const item = {};
      headers.forEach((header, index) => {
        item[header] = row[index] || '';
      });
      return item;
    });

    return data;
  } catch (error) {
    console.error('Error importing from Google Sheets:', error);
    throw error;
  }
}

// Generate a report in Google Sheets
async function createReport(reportData, reportName, userId) {
  try {
    const sheets = await getSheetsClient(userId);

    // Create spreadsheet with report data
    const response = await sheets.spreadsheets.create({
      requestBody: {
        properties: {
          title: `${reportName} Report - ${new Date().toLocaleDateString()}`
        }
      }
    });

    const spreadsheetId = response.data.spreadsheetId;

    // Format data for the sheet
    const values = [
      ['Metric', 'Value'],
      ['Total Clients', reportData.totalClients || 0],
      ['Total Tasks', reportData.totalTasks || 0],
      ['Completed Tasks', reportData.completedTasks || 0],
      ['Pending Tasks', reportData.pendingTasks || 0],
      ['Total Revenue', reportData.totalRevenue || 0],
      ['Outstanding', reportData.outstanding || 0]
    ];

    await sheets.spreadsheets.values.update({
      spreadsheetId: spreadsheetId,
      range: 'A1',
      valueInputOption: 'USER_ENTERED',
      requestBody: {
        values: values
      }
    });

    return { success: true, spreadsheetId, url: response.data.spreadsheetUrl };
  } catch (error) {
    console.error('Error creating report in Google Sheets:', error);
    throw error;
  }
}

// Sync clients data to Google Sheets
async function syncClients(userId) {
  try {
    const { rows } = await pool.query('SELECT * FROM clients ORDER BY created_at DESC');
    
    if (rows.length === 0) {
      return { success: true, message: 'No clients to sync' };
    }

    return await exportToSheet(rows, 'ClientPM - Clients', userId);
  } catch (error) {
    console.error('Error syncing clients to Google Sheets:', error);
    throw error;
  }
}

// Sync tasks data to Google Sheets
async function syncTasks(userId) {
  try {
    const { rows } = await pool.query(`
      SELECT w.*, c.name AS client_name 
      FROM work_items w
      LEFT JOIN clients c ON c.id = w.client_id
      ORDER BY w.created_at DESC
    `);
    
    if (rows.length === 0) {
      return { success: true, message: 'No tasks to sync' };
    }

    return await exportToSheet(rows, 'ClientPM - Tasks', userId);
  } catch (error) {
    console.error('Error syncing tasks to Google Sheets:', error);
    throw error;
  }
}

module.exports = {
  getSheetsClient,
  exportToSheet,
  importFromSheet,
  createReport,
  syncClients,
  syncTasks
};
