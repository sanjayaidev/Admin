# Google APIs Flow Builder Integration Summary

## Files Added/Updated

### Frontend
1. **`public/flow-builder.html`** - Complete flow builder UI from GoogleAPIs repo
2. **`public/js/flow-builder.js`** - Flow builder logic and canvas interactions
3. **`public/js/nodeDefs.js`** - Node definitions for all Google modules
4. **`public/settings.html`** - Updated to remove individual Google integration cards, added link to Flow Builder
5. **`public/js/settings.js`** - Simplified to only handle WhatsApp and notification preferences

### Backend (src/)
1. **`src/modules/`** - All Google API modules:
   - `index.js` - Central registry of all provider modules
   - `gmail.js` - Gmail actions and triggers
   - `calendar.js` - Google Calendar integration
   - `sheets.js` - Google Sheets operations
   - `docs.js` - Google Docs manipulation
   - `drive.js` - Google Drive file management
   - `forms.js` - Google Forms creation and responses
   - `googleBusinessProfile.js` - Business Profile API (reviews, posts, locations)

2. **`src/routes/`** - API routes:
   - `connections.js` - OAuth connection management
   - `flows.js` - Flow CRUD operations
   - `actionRouter.js` - Action execution router
   - `oauth.js` - OAuth 2.0 flow handling
   - `webhooks.js` - Webhook receivers for triggers

3. **`src/lib/`** - Utilities:
   - `connections.js` - Connection helpers with org_id scoping
   - `flowRunner.js` - Flow execution engine
   - `encryption.js` - Token encryption
   - `supabase.js` - Database client
   - `logger.js` - Logging utility
   - `keepAlive.js` - Keep-alive pings

4. **`src/config/`** - Configuration:
   - `env.js` - Environment variable loader

5. **`src/middleware/`** - Express middleware:
   - `apiKeyAuth.js` - API key authentication
   - `errorHandler.js` - Global error handler
   - `rateLimiter.js` - Rate limiting

## Features Included

### Supported Google Services
- **Gmail** - Send emails, list messages
- **Calendar** - Create/list/update events, manage calendars
- **Sheets** - Read/write spreadsheets, append rows, delete rows
- **Docs** - Create documents, append text, replace text
- **Drive** - Upload/download files, create folders, share files
- **Forms** - Create forms, add questions, list responses
- **Google Business Profile** - Manage locations, reviews, posts, metrics

### Flow Builder Capabilities
- Visual drag-and-drop flow creation
- Trigger-based automation (polling & webhooks)
- Multi-step workflows with conditional logic
- Connection management per organization
- Real-time flow execution

## Multi-Tenancy (Organization Isolation)

All connections and flows are scoped by `org_id`:
- Users can only access their organization's connections
- Flows are isolated per organization
- OAuth tokens encrypted and stored per-org

Run the migration:
```bash
psql $DATABASE_URL -f multitenancy-update.sql
```

## SQL for Graphicy Organization

```sql
-- Create organization for admin user (id=2)
INSERT INTO organizations (id, name, slug)
VALUES (gen_random_uuid(), 'Graphicy', 'graphicy');

UPDATE users 
SET org_id = (SELECT id FROM organizations WHERE slug = 'graphicy')
WHERE id = 2;
```

## Next Steps

1. Run the multi-tenancy SQL migration
2. Set up Google OAuth credentials in `.env`:
   ```
   GOOGLE_CLIENT_ID=your_client_id
   GOOGLE_CLIENT_SECRET=your_client_secret
   GOOGLE_REDIRECT_URI=http://localhost:3000/oauth/callback
   ```
3. Install dependencies: `npm install googleapis zod`
4. Access Flow Builder at: `/flow-builder.html`
