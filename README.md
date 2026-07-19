# ClientPM - Client Project Management Platform

A full-stack client project management platform with Google ecosystem integration, visual flow builder for automation, team management, invoicing, and notification systems.

## 🚀 Features

### Core Features
- **Multi-Tenancy**: Organization-based isolation with organization slugs and user scoping
- **Authentication & Authorization**: HTTP-only cookie-based sessions with role-based access control (Admin, Team, Client)
- **Client Management**: Full CRUD operations for client records with unique slugs
- **Task/Work Item Management**: Track work items with status, priority, due dates, and payment tracking
- **Calendar Integration**: Event management with Google Calendar two-way sync
- **Team Management**: Add, edit, deactivate team members with workload distribution view
- **User Profiles**: Personal information, avatar upload, password change, activity history
- **Share Links**: Generate shareable links for clients to view their projects

### Visual Flow Builder (Automation)
- **Drag-and-Drop Interface**: Visual canvas for building automation workflows
- **Triggers**: Polling-based and webhook-based triggers
- **Multi-Step Workflows**: Chain multiple actions with conditional logic
- **Connection Management**: OAuth-based connections per organization
- **Real-Time Execution**: Execute flows instantly or on schedule

### Google Integrations (via Flow Builder)
- **Gmail**: Send emails, list messages, manage labels
- **Google Calendar**: Create/list/update events, manage calendars
- **Google Sheets**: Read/write spreadsheets, append rows, query data
- **Google Docs**: Create documents, append text, replace content
- **Google Drive**: Upload/download files, create folders, share files
- **Google Forms**: Create forms, add questions, list responses
- **Google Business Profile**: Manage locations, reviews, posts, metrics
- **Google Meet**: Automatic meeting link generation

### Invoice System
- Auto-generated invoice numbers (INV-YYYY-XXXX format)
- 18% GST tax calculation (configurable)
- HTML/PDF invoice templates
- Payment status tracking (draft, sent, paid, overdue)
- Razorpay payment gateway integration (ready)

### Notification System
- **Email Notifications**: Via Nodemailer with SMTP support
- **WhatsApp Notifications**: Via GOWA API
- **Scheduled Reminders**:
  - Daily overdue task reminders (8:00 AM)
  - Upcoming task notifications (24 hours before)
  - Invoice due reminders (3 days before)
  - Weekly digest emails (Monday 9:00 AM)

### Redis Integration
- Session caching
- Performance optimization
- Railway-compatible configuration

## 📁 Project Structure

```
clientpm/
├── server.js                    # Main Express server with all routes
├── package.json                 # Dependencies
├── .env                         # Environment variables (create from template below)
├── README.md                    # This file
├── ADMIN_SETUP.md               # Admin user setup guide
├── INTEGRATION_SUMMARY.md       # Google APIs integration details
├── multitenancy-update.sql      # Multi-tenancy database migration
├── lib/
│   ├── db.js                   # Database connection & migrations
│   ├── auth.js                 # Authentication logic
│   ├── redis.js                # Redis client setup
│   ├── cron.js                 # Cron job scheduler
│   ├── shareLinks.js           # Shareable link generation
│   ├── google/
│   │   ├── auth.js             # Google OAuth 2.0
│   │   ├── calendar.js         # Calendar operations
│   │   ├── drive.js            # Drive operations
│   │   ├── meet.js             # Meet link generation
│   │   ├── sheets.js           # Sheets operations
│   │   └── gmail.js            # Gmail (Apps Script stub)
│   ├── payment/
│   │   └── invoice.js          # Invoice generation
│   └── whatsapp/
│       └── gowa.js             # GOWA API stub
├── src/                         # Flow Builder modules (deployed separately)
│   ├── config/
│   │   └── env.js              # Environment configuration
│   ├── lib/
│   │   ├── connections.js      # Connection helpers
│   │   ├── encryption.js       # Token encryption
│   │   ├── keepAlive.js        # Keep-alive pings
│   │   └── logger.js           # Logging utility
│   ├── middleware/
│   │   ├── apiKeyAuth.js       # API key authentication
│   │   ├── errorHandler.js     # Global error handler
│   │   ├── rateLimiter.js      # Rate limiting
│   │   └── sessionAuth.js      # Session authentication
│   ├── modules/
│   │   ├── index.js            # Module registry
│   │   ├── gmail.js            # Gmail module
│   │   ├── calendar.js         # Calendar module
│   │   ├── sheets.js           # Sheets module
│   │   ├── docs.js             # Docs module
│   │   ├── drive.js            # Drive module
│   │   ├── forms.js            # Forms module
│   │   └── googleBusinessProfile.js  # Business Profile module
│   └── routes/
│       ├── oauth.js            # OAuth 2.0 flow handling
│       ├── connections.js      # Connection management
│       ├── actionRouter.js     # Action execution router
│       ├── webhooks.js         # Webhook receivers
│       ├── health.js           # Health check endpoint
│       └── auth.js             # Auth routes
├── middleware/
│   ├── auth.js                 # Auth & role middleware
│   └── logger.js               # Request/response logging
├── public/
│   ├── index.html              # Dashboard
│   ├── clients.html            # Client management
│   ├── tasks.html              # Task management
│   ├── calendar.html           # Calendar view
│   ├── settings.html           # Settings page
│   ├── profile.html            # User profile
│   ├── team.html               # Team management
│   ├── invoices.html           # Invoice management
│   ├── connections.html        # OAuth connections manager
│   ├── share.html              # Client share portal
│   ├── css/
│   │   ├── style.css           # Global styles
│   │   ├── settings.css        # Settings page styles
│   │   ├── profile.css         # Profile page styles
│   │   ├── team.css            # Team page styles
│   │   └── auh-modal.css       # Auth modal styles
│   └── js/
│       ├── app.js              # Main application logic
│       ├── auth.js             # Frontend auth logic
│       ├── utils.js            # Shared utilities
│       ├── dashboard.js        # Dashboard logic
│       ├── clients.js          # Client management
│       ├── tasks.js            # Task management
│       ├── calendar.js         # Calendar logic
│       ├── invoices.js         # Invoice management
│       ├── settings.js         # Settings page logic
│       ├── profile.js          # Profile management
│       ├── team.js             # Team management
│       ├── connections.js      # Connections manager
│       ├── share.js            # Share link logic
│       └── nodeDefs.js         # Flow builder node definitions
└── views/
    └── invoice-template.html   # HTML invoice template
```

## 🛠️ Tech Stack

- **Backend**: Node.js + Express (vanilla, no framework)
- **Database**: PostgreSQL with connection pooling
- **Cache**: Redis
- **Frontend**: HTML5, CSS3, Vanilla JavaScript (no framework)
- **Integrations**: Google APIs, Razorpay, Nodemailer, GOWA

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

Create a `.env` file in the root directory with the following configuration:

```env
# Database
DATABASE_URL=postgresql://user:password@localhost:5432/clientpm

# Session
SESSION_SECRET=your-super-secret-key-change-this

# Redis (Railway example)
REDIS_URL=redis://default:PASSWORD@HOST:PORT

# Google OAuth
GOOGLE_CLIENT_ID=your_client_id
GOOGLE_CLIENT_SECRET=your_client_secret
GOOGLE_REDIRECT_URI=http://localhost:3000/api/integrations/google/callback

# WhatsApp GOWA
GOWA_API_URL=https://api.gowa.com/v1
GOWA_API_KEY=your_api_key

# Payment Gateway
RAZORPAY_KEY_ID=rzp_test_xxx
RAZORPAY_KEY_SECRET=xxx

# Email (Nodemailer)
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=your_email@gmail.com
SMTP_PASS=your_app_password

# App Configuration
APP_URL=http://localhost:3000
NODE_ENV=development
PORT=3000
```

**Note:** The Flow Builder (`src/` directory) is deployed separately at https://googleapis-r8qg.onrender.com and has its own environment configuration.

### 3. Database Setup

The application automatically runs migrations on startup. The schema includes:

- `users` - User accounts with roles
- `sessions` - Session management
- `clients` - Client records
- `work_items` - Tasks/work items
- `work_comments` - Task comments
- `calendar_events` - Calendar events
- `invoices` - Invoice records
- `integrations` - Google OAuth tokens
- `notifications` - Notification log
- `reminders` - Scheduled reminders

### 4. Start the Server

```bash
npm start
```

The server will start on `http://localhost:3000` (or port specified in PORT env).

## 🔐 Default Admin Account

On first run, create an admin account via the signup form. The first user can be promoted to admin via database:

```sql
UPDATE users SET role = 'admin' WHERE email = 'your@email.com';
```

## 📊 API Endpoints

### Authentication
```
POST /api/auth/login          - User login
POST /api/auth/signup         - User registration
GET  /api/auth/me             - Get current user
POST /api/auth/logout         - Logout
POST /api/auth/change-password - Change password
```

### Users
```
GET    /api/users             - List all users (admin)
GET    /api/users/:id         - Get user by ID
PUT    /api/users/:id         - Update user (admin)
DELETE /api/users/:id         - Delete user (admin)
GET    /api/users/me          - Get current user profile
PUT    /api/users/me          - Update current profile
POST   /api/users/me/avatar   - Upload avatar
DELETE /api/users/me/avatar   - Remove avatar
GET    /api/users/me/activity - Get activity history
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

### Google Integrations
```
GET    /api/integrations                  - List user integrations
POST   /api/integrations/google/auth      - Initiate OAuth
POST   /api/integrations/google/callback  - OAuth callback
DELETE /api/integrations/:provider        - Disconnect service
POST   /api/integrations/google/sync      - Manual sync trigger
```

### Invoices
```
GET    /api/invoices            - List invoices
POST   /api/invoices            - Create invoice
GET    /api/invoices/:id        - Get invoice
PUT    /api/invoices/:id        - Update invoice
DELETE /api/invoices/:id        - Delete invoice
POST   /api/invoices/:id/send   - Send invoice email
POST   /api/invoices/:id/pay    - Process payment
GET    /api/invoices/:id/pdf    - Generate PDF
```

### Settings
```
GET    /api/settings            - Get user settings
PUT    /api/settings            - Update settings
POST   /api/settings/gowa-configure - Configure WhatsApp
```

### Notifications
```
GET    /api/notifications              - List notifications
POST   /api/notifications              - Create notification
POST   /api/notifications/test-email   - Send test email
POST   /api/notifications/test-whatsapp - Send test WhatsApp
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

### Settings (`/settings.html`)
- Google integration management (Calendar, Drive, Sheets, Meet, Gmail)
- WhatsApp/GOWA configuration
- Notification preferences
- Invoice settings
- System configuration
- **Link to Flow Builder** for advanced automation workflows

### Connections Manager (`/connections.html`)
- View and manage all OAuth connections
- Connect/disconnect Google services
- Connection status monitoring

### Profile (`/profile.html`)
- Personal information editing
- Avatar upload
- Password change
- Notification preferences
- Connected Google accounts
- Activity history
- Account management (deactivate/delete)

### Team (`/team.html`)
- Team member list with filters
- Role-based access display
- Workload distribution visualization
- Add/Edit/Delete members (admin only)
- Member status toggle

## 🚢 Deployment (Railway)

### Environment Variables for Railway

```env
# Railway provides these automatically
DATABASE_URL=${{RAILWAY_POSTGRES_URL}}
REDIS_URL=redis://default:${{REDIS_PASSWORD}}@${{RAILWAY_TCP_PROXY_DOMAIN}}:${{RAILWAY_TCP_PROXY_PORT}}

# Or use private domain
REDISHOST=${{RAILWAY_PRIVATE_DOMAIN}}
REDISPORT=6379
REDISUSER=default
REDISPASSWORD=${{REDIS_PASSWORD}}
```

### Build & Deploy
1. Connect your GitHub repository to Railway
2. Add environment variables
3. Railway will automatically build and deploy
4. The app runs on `npm start`

## 🧪 Testing

```bash
# Run tests (when implemented)
npm test

# Development mode with auto-restart
npm run dev
```

## 🔍 API Health Check

The application provides a health check endpoint at `/api/health`:

```bash
curl http://localhost:3000/api/health
```

Response:
```json
{
  "status": "ok",
  "timestamp": "2024-01-15T10:30:00.000Z"
}
```

## 📝 TODO / Future Enhancements

- [ ] Complete Apps Script integration for Gmail
- [ ] Finalize GOWA WhatsApp integration
- [ ] Add PDF generation for invoices
- [ ] Implement two-factor authentication
- [ ] Add client portal (`/share.html`)
- [ ] Implement real-time notifications with WebSockets
- [ ] Add data export functionality
- [ ] Implement soft deletes for audit trail
- [ ] Add more granular permissions system

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
3. Check `/api/logs` endpoint (if enabled)
4. Open an issue on GitHub

---

**Built with ❤️ using Node.js, PostgreSQL, and Vanilla JavaScript**
