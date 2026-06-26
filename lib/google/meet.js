// lib/google/meet.js
// Google Meet integration (wrapper around Calendar API)

const { google } = require('googleapis');
const { pool } = require('../db');
const { getOAuth2Client } = require('./auth');

// Create a Meet link by creating a calendar event with conference data
async function createMeetLink(userId, eventData = {}) {
  try {
    const { rows } = await pool.query(`
      SELECT access_token, refresh_token, expiry_date 
      FROM integrations 
      WHERE user_id = $1 AND provider IN ('google_calendar', 'google_drive') AND is_active = TRUE
      LIMIT 1
    `, [userId]);

    if (rows.length === 0) {
      throw new Error('Google Calendar not connected for this user');
    }

    const integration = rows[0];
    const auth = getOAuth2Client();

    auth.setCredentials({
      access_token: integration.access_token,
      refresh_token: integration.refresh_token,
      expiry_date: integration.expiry_date
    });

    const calendar = google.calendar({ version: 'v3', auth });

    // Create event with Meet link
    const event = {
      summary: eventData.title || 'Meeting',
      description: eventData.description || '',
      start: {
        dateTime: eventData.startDateTime || new Date().toISOString(),
        timeZone: 'UTC'
      },
      end: {
        dateTime: eventData.endDateTime || new Date(Date.now() + 60 * 60 * 1000).toISOString(),
        timeZone: 'UTC'
      },
      conferenceData: {
        createRequest: {
          requestId: `meet-${Date.now()}-${Math.random().toString(36).substring(7)}`,
          conferenceSolutionKey: { type: 'hangoutsMeet' }
        }
      }
    };

    const response = await calendar.events.insert({
      calendarId: 'primary',
      conferenceDataVersion: 1,
      requestBody: event
    });

    return {
      success: true,
      meetLink: response.data.hangoutLink,
      eventId: response.data.id,
      htmlLink: response.data.htmlLink
    };
  } catch (error) {
    console.error('Error creating Meet link:', error);
    throw error;
  }
}

// Get Meet details from an existing event
async function getMeetDetails(eventId, userId) {
  try {
    const { rows } = await pool.query(`
      SELECT access_token, refresh_token, expiry_date 
      FROM integrations 
      WHERE user_id = $1 AND provider = 'google_calendar' AND is_active = TRUE
      LIMIT 1
    `, [userId]);

    if (rows.length === 0) {
      throw new Error('Google Calendar not connected for this user');
    }

    const integration = rows[0];
    const auth = getOAuth2Client();

    auth.setCredentials({
      access_token: integration.access_token,
      refresh_token: integration.refresh_token,
      expiry_date: integration.expiry_date
    });

    const calendar = google.calendar({ version: 'v3', auth });

    const response = await calendar.events.get({
      calendarId: 'primary',
      eventId: eventId
    });

    return {
      success: true,
      meetLink: response.data.hangoutLink,
      title: response.data.summary,
      start: response.data.start,
      end: response.data.end,
      attendees: response.data.attendees || []
    };
  } catch (error) {
    console.error('Error getting Meet details:', error);
    throw error;
  }
}

// Add Meet link to an existing calendar event
async function addMeetToExistingEvent(eventId, userId) {
  try {
    const { rows } = await pool.query(`
      SELECT access_token, refresh_token, expiry_date 
      FROM integrations 
      WHERE user_id = $1 AND provider = 'google_calendar' AND is_active = TRUE
      LIMIT 1
    `, [userId]);

    if (rows.length === 0) {
      throw new Error('Google Calendar not connected for this user');
    }

    const integration = rows[0];
    const auth = getOAuth2Client();

    auth.setCredentials({
      access_token: integration.access_token,
      refresh_token: integration.refresh_token,
      expiry_date: integration.expiry_date
    });

    const calendar = google.calendar({ version: 'v3', auth });

    // Get existing event
    const event = await calendar.events.get({
      calendarId: 'primary',
      eventId: eventId
    });

    // Add conference data
    event.data.conferenceData = {
      createRequest: {
        requestId: `meet-add-${Date.now()}`,
        conferenceSolutionKey: { type: 'hangoutsMeet' }
      }
    };

    const response = await calendar.events.update({
      calendarId: 'primary',
      eventId: eventId,
      conferenceDataVersion: 1,
      requestBody: event.data
    });

    // Update database
    await pool.query(`
      UPDATE calendar_events 
      SET google_meet_link = $1, external_calendar_id = $2
      WHERE external_calendar_id = $3 OR id = $4
    `, [response.data.hangoutLink, response.data.id, eventId, eventId]);

    return {
      success: true,
      meetLink: response.data.hangoutLink
    };
  } catch (error) {
    console.error('Error adding Meet to existing event:', error);
    throw error;
  }
}

module.exports = {
  createMeetLink,
  getMeetDetails,
  addMeetToExistingEvent
};
