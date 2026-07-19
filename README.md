# ClientPM - Client Project Management Platform

A full-stack client project management platform with Google ecosystem integration, team management, invoicing, WhatsApp/email notifications, and automation workflows.

## 🚀 Features

### Core Features
- **Multi-Tenancy**: Organization-based architecture with unique slugs
- **Authentication & Authorization**: HTTP-only cookie sessions with role-based access (Admin, Team, Client)
- **Organization Management**: Create organizations, join requests, member approval workflow
- **Client Management**: Full CRUD operations for client records with unique slugs
- **Task/Work Item Management**: Track work items with status, priority, due dates, and payment tracking
- **Calendar Integration**: Event management with Google Calendar two-way sync
- **Team Management**: Add, edit, deactivate team members with workload distribution view
- **User Profiles**: Personal information, avatar upload, password change, activity history
- **Role Management**: Custom roles with granular permissions (admin only)
- **Share Links**: Public shareable links for client dashboards with token-based access

### Google Integrations
- **Google Calendar**: Two-way event sync, automatic Meet link generation
- **Google Drive**: Client folder creation, file upload/share
- **Google Sheets**: Data export/import, report generation
- **Google Meet**: Automatic meeting link creation
- **Gmail**: Email sending and automation
- **Google Docs**: Document management
- **Google Forms**: Form integration
- **Google Business Profile**: Business profile management

### Invoice System
- Auto-generated invoice numbers (INV-YYYY-XXXX format)
- 18% GST tax calculation (configurable)
- HTML/PDF invoice templates
- Payment status tracking (draft, sent, paid, overdue)
- Billable items from work items
- Partial payment tracking on work items

### Notification & Automation System
- **Email Notifications**: Via Nodemailer/Gmail integration
- **WhatsApp Notifications**: Via GOWA API
- **Scheduled Cron Jobs**:
  - Daily overdue task reminders (8:00 AM)
  - Upcoming task notifications (24 hours before)
  - Invoice due reminders (3 days before)
  - Weekly digest emails (Monday 9:00 AM)
- **Notification Logging**: All notifications tracked in database

### Redis Integration
- Session caching
- Performance optimization
- Railway-compatible configuration

### Automation Modules
- **Flow Builder**: Visual automation workflow system
- **Action Router**: Execute module actions programmatically
- **Webhooks**: External service integration triggers
- **Connection Management**: OAuth connection lifecycle

## 📁 Project Structure

```
clientpm/
├── server.js                    # Main Express server with all routes
├── package.json                 # Dependencies
├── .env.example                 # Environment variables template
├── README.md                    # This file
├── lib/
│   ├── db.js                   # Database connection & migrations
│   ├── auth.js                 # Authentication logic (sessions, orgs, join requests)
│   ├── redis.js                # Redis client setup
│   ├── cron.js                 # Cron job scheduler for notifications
│   ├── shareLinks.js           # Public share token management
│   ├── google/
│   │   ├── auth.js             # Google OAuth 2.0
│   │   ├── calendar.js         # Calendar operations
│   │   ├── drive.js            # Drive operations
│   │   ├── meet.js             # Meet link generation
│   │   ├── sheets.js           # Sheets operations
│   │   └── gmail.js            # Gmail operations
│   ├── payment/
│   │   └── invoice.js          # Invoice generation & management
│   └── whatsapp/
│       └── gowa.js             # GOWA WhatsApp API integration
├── middleware/
│   ├── auth.js                 # Auth & role middleware
│   └── logger.js               # Request/response logging
├── src/
│   ├── config/
│   │   └── env.js              # Environment configuration
│   ├── lib/
│   │   ├── db.js               # Database helpers (select, insert, update, del)
│   │   ├── connections.js      # OAuth connection management
│   │   ├── encryption.js       # Encryption utilities
│   │   ├── keepAlive.js        # Server keep-alive pings
│   │   └── logger.js           # Logging utilities
│   ├── middleware/
│   │   ├── apiKeyAuth.js       # API key authentication
│   │   ├── errorHandler.js     # Global error handler
│   │   ├── rateLimiter.js      # Rate limiting middleware
│   │   └── sessionAuth.js      # Session-based auth for modules
│   ├── modules/
│   │   ├── index.js            # Module registry
│   │   ├── gmail.js            # Gmail module actions/triggers
│   │   ├── calendar.js         # Calendar module
│   │   ├── sheets.js           # Sheets module
│   │   ├── docs.js             # Docs module
│   │   ├── drive.js            # Drive module
│   │   ├── forms.js            # Forms module
│   │   └── googleBusinessProfile.js  # GBP module
│   └── routes/
│       ├── oauth.js            # OAuth flow endpoints
│       ├── connections.js      # Connection CRUD
│       ├── webhooks.js         # Webhook receivers
│       ├── actionRouter.js     # Action execution router
│       ├── auth.js             # Module auth endpoints
│       └── health.js           # Health check endpoint
├── public/
│   ├── index.html              # Dashboard
│   ├── clients.html            # Client management
│   ├── tasks.html              # Task management
│   ├── calendar.html           # Calendar view
│   ├── settings.html           # Integrations & settings
│   ├── profile.html            # User profile
│   ├── team.html               # Team management
│   ├── invoices.html           # Invoice management
│   ├── connections.html        # OAuth connections UI
│   ├── share.html              # Public share view
│   ├── css/
│   │   └── *.css               # Stylesheets
│   └── js/
│       ├── app.js              # Main frontend application
│       ├── auth.js             # Frontend auth logic
│       ├── utils.js            # Shared utilities
│       ├── settings.js         # Settings page logic
│       ├── profile.js          # Profile management
│       ├── team.js             # Team management
│       ├── clients.js          # Client management
│       ├── tasks.js            # Task management
│       ├── invoices.js         # Invoice management
│       ├── calendar.js         # Calendar UI logic
│       ├── dashboard.js        # Dashboard logic
│       ├── connections.js      # Connections UI
│       ├── share.js            # Share link logic
│       └── nodeDefs.js         # Flow builder node definitions
└── views/
    └── invoice-template.html   # HTML invoice template
```

## 🛠️ Tech Stack

- **Backend**: Node.js + Express (vanilla, no framework)
- **Database**: PostgreSQL with connection pooling (Neon, Railway-compatible)
- **Cache**: Redis (Railway-compatible configuration)
- **Frontend**: HTML5, CSS3, Vanilla JavaScript (no framework)
- **Integrations**: Google APIs (Calendar, Drive, Sheets, Docs, Meet, Forms, Gmail, GBP), WhatsApp GOWA, Nodemailer
- **Automation**: Custom module system with actions/triggers, webhooks, OAuth flow management

## 📦 Installation

### Prerequisites
- Node.js 18+ 
- PostgreSQL 13+
- Redis 6+
- npm or yarn

### 1. Clone and Install Dependencies

```bash
git clone <repository-url>
cd clientpm
npm install
```

### 2. Environment Setup

Copy `.env.example` to `.env` and configure:

```env
# Database (PostgreSQL - Neon/Railway compatible)
DATABASE_URL=postgresql://user:password@localhost:5432/clientpm

# Session
SESSION_SECRET=your-super-secret-key-change-this

# Redis (Railway example)
REDIS_URL=redis://default:PASSWORD@HOST:PORT

# Google OAuth
GOOGLE_CLIENT_ID=your_client_id
GOOGLE_CLIENT_SECRET=your_client_secret
GOOGLE_REDIRECT_URI=http://localhost:3000/api/oauth/google/callback

# Base URLs
BASE_URL=http://localhost:3000
PUBLIC_BASE_URL=http://localhost:3000

# WhatsApp GOWA
GOWA_API_URL=https://api.gowa.com/v1
GOWA_API_KEY=your_api_key

# Email (Nodemailer/Gmail)
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=your_email@gmail.com
SMTP_PASS=your_app_password

# App Configuration
NODE_ENV=development
PORT=3000
```

### 3. Database Setup

The application automatically runs migrations on startup. The schema includes:

- `organizations` - Multi-tenant organizations with unique slugs
- `users` - User accounts with roles and org membership
- `sessions` - Session management
- `clients` - Client records
- `work_items` - Tasks/work items
- `work_comments` - Task comments
- `calendar_events` - Calendar events
- `invoices` - Invoice records with work item associations
- `integrations` - OAuth tokens for external services
- `connections` - Module connection states
- `notifications` - Notification log
- `reminders` - Scheduled reminders
- `share_links` - Public share tokens
- `roles` - Custom role definitions
- `join_requests` - Organization join requests

### 4. Start the Server

```bash
npm start
```

The server will start on `http://localhost:3000` (or port specified in PORT env).

## 🔐 Default Admin Account

On first run, the system creates a default admin organization. The first user can sign up and will be associated with the organization. Additional users can request to join organizations via the join request workflow.

To manually promote a user to admin via database:

```sql
UPDATE users SET role = 'admin' WHERE email = 'your@email.com';
```

To create an organization manually:

```sql
INSERT INTO organizations (name, slug) VALUES ('My Org', 'my-org');
```

## 📊 API Endpoints

### Authentication & Organization
```
POST /api/auth/login          - User login
POST /api/auth/signup         - User registration
GET  /api/auth/me             - Get current user
POST /api/auth/logout         - Logout
POST /api/auth/change-password - Change password
GET  /api/auth/validate-org   - Validate organization
GET  /api/auth/validate-org-slug - Validate org slug availability
```

### Organization Management
```
GET    /api/organization      - Get current user's organization
PUT    /api/organization      - Update organization (admin)
GET    /api/org/join-requests - List join requests (admin)
POST   /api/org/join-requests/:id/decide - Approve/reject request (admin)
GET    /api/org/my-join-request - Get user's pending join request
```

### Users & Profile
```
GET    /api/users             - List all users (admin)
GET    /api/users/:id         - Get user by ID
PUT    /api/users/:id         - Update user (admin)
DELETE /api/users/:id         - Delete user (admin)
GET    /api/profile/me        - Get current user profile
PUT    /api/profile/me        - Update current profile
PUT    /api/profile/avatar    - Upload avatar
PUT    /api/profile/notifications - Update notification preferences
```

### Roles (Admin Only)
```
GET    /api/roles             - List all roles
POST   /api/roles             - Create role
PUT    /api/roles/:id         - Update role
DELETE /api/roles/:id         - Delete role
```

### Team Management (Admin Only)
```
GET    /api/team/members      - List team members
POST   /api/team/members      - Add team member
PUT    /api/team/members/:id  - Update member
DELETE /api/team/members/:id  - Delete member
PUT    /api/team/members/:id/status - Toggle active status
GET    /api/team/workload     - Get workload distribution
```

### Clients (Admin Only)
```
GET    /api/clients           - List all clients
POST   /api/clients           - Create client
GET    /api/clients/:id       - Get client by ID
PUT    /api/clients/:id       - Update client
DELETE /api/clients/:id       - Delete client
POST   /api/clients/:id/share-links - Create share link
GET    /api/clients/:id/share-links - List client share links
DELETE /api/clients/:id/share-links/:linkId - Revoke share link
```

### Work Items & Tasks
```
GET    /api/work-items        - List work items (filtered by query params)
POST   /api/work-items        - Create work item (admin)
GET    /api/work-items/:id    - Get work item by ID
PUT    /api/work-items/:id    - Update work item (admin)
DELETE /api/work-items/:id    - Delete work item (admin)
```

### Calendar Events
```
GET    /api/calendar-events   - List calendar events
POST   /api/calendar-events   - Create event (admin)
PUT    /api/calendar-events/:id - Update event (admin)
DELETE /api/calendar-events/:id - Delete event (admin)
```

### Work Comments (Admin Only)
```
GET    /api/work-comments     - List comments (filter by work_item_id)
POST   /api/work-comments     - Create comment
```

### Invoices (Admin Only)
```
GET    /api/invoices          - List invoices
GET    /api/invoices/billable-items/:clientId - Get billable work items
POST   /api/invoices/preview  - Preview invoice from work items
POST   /api/invoices          - Create invoice
GET    /api/invoices/:id      - Get invoice
GET    /api/invoices/:id/html - Get invoice HTML
PUT    /api/invoices/:id      - Update invoice
POST   /api/invoices/:id/send - Send invoice (mark as sent)
POST   /api/invoices/:id/pay  - Mark invoice as paid
DELETE /api/invoices/:id      - Delete draft invoice
```

### Share Links (Public)
```
GET    /api/public/share/:token - Get shared client dashboard data
```

### Dashboard
```
GET    /api/dashboard         - Get dashboard stats and overview (admin)
```

### OAuth & Connections (Module System)
```
GET    /api/oauth/google/start?module=<name> - Start OAuth flow
GET    /api/oauth/google/callback - OAuth callback handler
GET    /api/connections       - List user connections
POST   /api/connections       - Create/update connection
DELETE /api/connections/:id   - Delete connection
POST   /api/actions/:moduleName/:actionName - Execute module action
POST   /api/webhooks/:provider - Receive webhooks from providers
```

### Health Check
```
GET    /api/health            - Health check endpoint
```

## 🔧 Logging & Debugging

The application includes comprehensive logging:

### Request Logger (`middleware/logger.js`)
- Logs every HTTP request with method, URL, status code, and duration
- Color-coded output (green=success, yellow=client error, red=server error)

### Error Logger
- Detailed error logging with stack traces
- Request body and query parameters captured
- User context included

### Console Output Format
```
[2024-01-15T10:30:00.000Z] GET /api/users/me - 200 (15ms)
[2024-01-15T10:30:01.000Z] POST /api/clients - 201 (45ms)

[ERROR] 2024-01-15T10:30:02.000Z
Method: POST URL: /api/invoices
User ID: 123
Error Details: Database connection failed
Stack Trace: ...
```

## 🎨 Frontend Pages

### Dashboard (`/`)
- Stats overview (clients, tasks, revenue, overdue)
- Task status distribution
- Recent activities
- Quick actions

### Clients (`/clients.html`)
- Client list with search and filters
- Add/Edit/Delete clients (admin only)
- Client details view
- Share link management

### Tasks (`/tasks.html`)
- Work item list with filters (status, priority, due date)
- Create/Edit/Delete work items (admin only)
- Payment status tracking
- Comment system

### Calendar (`/calendar.html`)
- Monthly calendar view
- Event creation and editing
- Google Calendar sync status
- Meet link integration

### Invoices (`/invoices.html`)
- Invoice list with status filters
- Create invoice from billable work items
- Preview invoice before sending
- Send and mark as paid
- PDF generation ready

### Team (`/team.html`)
- Team member list with filters
- Role-based access display
- Workload distribution visualization
- Add/Edit/Delete members (admin only)
- Member status toggle

### Profile (`/profile.html`)
- Personal information editing
- Avatar upload
- Password change
- Notification preferences
- Connected Google accounts
- Activity history
- Account management (deactivate/delete)

### Settings (`/settings.html`)
- Organization settings (admin only)
- Module connection management (Gmail, Calendar, Drive, etc.)
- WhatsApp/GOWA configuration
- System configuration

### Connections (`/connections.html`)
- View all OAuth connections
- Connect/disconnect modules
- Connection status and permissions

### Share (`/share/:token`)
- Public client dashboard view
- Token-based authentication
- Read-only access to selected client data

## 🚢 Deployment (Railway)

### Environment Variables for Railway

```env
# Railway provides these automatically
DATABASE_URL=${{RAILWAY_POSTGRES_URL}}
REDIS_URL=redis://default:${{REDIS_PASSWORD}}@${{RAILWAY_TCP_PROXY_DOMAIN}}:${{RAILWAY_TCP_PROXY_PORT}}

# Or use private domain for Redis
REDISHOST=${{RAILWAY_PRIVATE_DOMAIN}}
REDISPORT=6379
REDISUSER=default
REDISPASSWORD=${{REDIS_PASSWORD}}

# Google OAuth
GOOGLE_CLIENT_ID=your_client_id
GOOGLE_CLIENT_SECRET=your_client_secret
GOOGLE_REDIRECT_URI=https://your-app.railway.app/api/oauth/google/callback

# Base URLs
BASE_URL=https://your-app.railway.app
PUBLIC_BASE_URL=https://your-app.railway.app

# Session Secret (generate a strong random string)
SESSION_SECRET=your-production-session-secret

# WhatsApp GOWA (optional)
GOWA_API_URL=https://api.gowa.com/v1
GOWA_API_KEY=your_api_key

# Email (optional - or use Gmail module)
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=your_email@gmail.com
SMTP_PASS=your_app_password

# App Configuration
NODE_ENV=production
```

### Build & Deploy
1. Connect your GitHub repository to Railway
2. Add environment variables in Railway dashboard
3. Railway will automatically build and deploy on push
4. The app runs on `npm start`
5. Migrations run automatically on startup

### Self-Healing Keep-Alive
The application includes a self-ping mechanism that keeps the server awake:
- Enabled by default via `ENABLE_SELF_PING=true`
- Runs every 10 minutes (configurable via `SELF_PING_CRON`)
- Pings the health endpoint to prevent sleep on free tiers

## 🧪 Testing

```bash
# Run tests (when implemented)
npm test

# Development mode with auto-restart
npm run dev
```

## 🔌 Module System

ClientPM includes a powerful module system for integrating with external services:

### Available Modules
- **gmail** - Gmail API integration (send emails, read messages)
- **calendar** - Google Calendar (create events, sync calendars)
- **sheets** - Google Sheets (read/write spreadsheets)
- **docs** - Google Docs (create/edit documents)
- **drive** - Google Drive (file management)
- **forms** - Google Forms (form management)
- **googleBusinessProfile** - GBP API integration

### Module Architecture
Each module exposes:
- **Actions**: Programmatic operations (e.g., `sendMessage`, `createEvent`)
- **Triggers**: Webhook handlers for real-time updates
- **OAuth Flow**: Secure connection management

### Using Modules
```javascript
// Execute a module action via API
POST /api/actions/gmail/sendMessage
{
  "to": "client@example.com",
  "subject": "Invoice Ready",
  "body": "Your invoice is attached..."
}
```

## 📝 TODO / Future Enhancements

- [ ] Complete WhatsApp GOWA integration
- [ ] Add PDF generation for invoices
- [ ] Implement two-factor authentication
- [ ] Enhance client portal (`/share.html`)
- [ ] Implement real-time notifications with WebSockets
- [ ] Add data export functionality (CSV, Excel)
- [ ] Implement soft deletes for audit trail
- [ ] Add more granular permissions system
- [ ] Create flow builder UI for visual automation
- [ ] Add Meta/Facebook integration modules
- [ ] Implement recurring invoice templates
- [ ] Add time tracking for work items

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Test thoroughly
5. Submit a pull request

## 📄 License

MIT License - see LICENSE file for details

## 🆘 Support

For issues and questions:
1. Check the logs in console/terminal
2. Review the error messages in browser console
3. Check application logs via pino-pretty output
4. Open an issue on GitHub with:
   - Steps to reproduce
   - Expected vs actual behavior
   - Environment details (Node version, database, Redis)
   - Relevant log excerpts

## 📚 Additional Documentation

- **ADMIN_SETUP.md** - Detailed admin setup and organization management guide
- **INTEGRATION_SUMMARY.md** - Complete integration architecture documentation
- **multitenancy-update.sql** - Database migration scripts for multi-tenancy

---

**Built with ❤️ using Node.js, PostgreSQL, Redis, and Vanilla JavaScript**

© 2024 ClientPM - Multi-Tenant Client Project Management Platform
