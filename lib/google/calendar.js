// lib/google/calendar.js
// Google Calendar integration

const { google } = require('googleapis');
const { pool } = require('../db');
const { getOAuth2Client } = require('./auth');

// Get authenticated calendar client for a user
async function getCalendarClient(userId) {
  const { rows } = await pool.query(`
    SELECT access_token, refresh_token, expiry_date 
    FROM integrations 
    WHERE user_id = $1 AND provider = 'google_calendar' AND is_active = TRUE
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

  // Auto-refresh tokens
  auth.on('tokens', async (tokens) => {
    if (tokens.access_token || tokens.refresh_token) {
      await pool.query(`
        UPDATE integrations 
        SET access_token = COALESCE($1, access_token), 
            refresh_token = COALESCE($2, refresh_token),
            expiry_date = COALESCE($3, expiry_date),
            updated_at = CURRENT_TIMESTAMP
        WHERE user_id = $4 AND provider = 'google_calendar'
      `, [tokens.access_token, tokens.refresh_token, tokens.expiry_date, userId]);
    }
  });

  return google.calendar({ version: 'v3', auth });
}

// Sync event to Google Calendar (create or update)
async function syncEventToGoogle(eventData, userId) {
  try {
    const calendar = await getCalendarClient(userId);
    
    const event = {
      summary: eventData.title,
      description: eventData.description || '',
      start: {
        dateTime: eventData.event_date,
        timeZone: 'UTC'
      },
      end: {
        dateTime: new Date(new Date(eventData.event_date).getTime() + 60 * 60 * 1000).toISOString(),
        timeZone: 'UTC'
      }
    };

    let response;
    if (eventData.external_calendar_id) {
      // Update existing event
      response = await calendar.events.update({
        calendarId: 'primary',
        eventId: eventData.external_calendar_id,
        requestBody: event
      });
    } else {
      // Create new event
      response = await calendar.events.insert({
        calendarId: 'primary',
        requestBody: event
      });
    }

    // Store Google event ID in database
    if (eventData.work_item_id) {
      await pool.query(`
        UPDATE calendar_events 
        SET external_calendar_id = $1, google_meet_link = $2
        WHERE id = $3
      `, [response.data.id, response.data.hangoutLink || null, eventData.id]);
    }

    return { success: true, eventId: response.data.id, meetLink: response.data.hangoutLink };
  } catch (error) {
    console.error('Error syncing event to Google Calendar:', error);
    throw error;
  }
}

// Delete event from Google Calendar
async function deleteGoogleEvent(externalEventId, userId) {
  try {
    const calendar = await getCalendarClient(userId);
    
    await calendar.events.delete({
      calendarId: 'primary',
      eventId: externalEventId
    });

    return { success: true };
  } catch (error) {
    console.error('Error deleting Google Calendar event:', error);
    throw error;
  }
}

// Get events from Google Calendar
async function getGoogleEvents(startDate, endDate, userId) {
  try {
    const calendar = await getCalendarClient(userId);
    
    const response = await calendar.events.list({
      calendarId: 'primary',
      timeMin: startDate,
      timeMax: endDate,
      singleEvents: true,
      orderBy: 'startTime'
    });

    return response.data.items || [];
  } catch (error) {
    console.error('Error fetching Google Calendar events:', error);
    throw error;
  }
}

// Create Meet link for an existing event
async function createMeetLink(eventId, userId) {
  try {
    const calendar = await getCalendarClient(userId);
    
    // Add conference data to create Meet link
    const event = await calendar.events.get({
      calendarId: 'primary',
      eventId: eventId
    });

    event.data.conferenceData = {
      createRequest: {
        requestId: `meet-${Date.now()}`,
        conferenceSolutionKey: { type: 'hangoutsMeet' }
      }
    };

    const response = await calendar.events.update({
      calendarId: 'primary',
      eventId: eventId,
      conferenceDataVersion: 1,
      requestBody: event.data
    });

    // Update database with Meet link
    await pool.query(`
      UPDATE calendar_events 
      SET google_meet_link = $1 
      WHERE external_calendar_id = $2
    `, [response.data.hangoutLink, eventId]);

    return { success: true, meetLink: response.data.hangoutLink };
  } catch (error) {
    console.error('Error creating Meet link:', error);
    throw error;
  }
}

module.exports = {
  getCalendarClient,
  syncEventToGoogle,
  deleteGoogleEvent,
  getGoogleEvents,
  createMeetLink
};
