# ClientPM

Full-stack client project management app — plain HTML/CSS/JS frontend + Node API, no build step.

## Features

- **Dashboard** — task status cards, payment totals, overdue alerts, date range filtering
- **Clients** — add/edit/delete with contact details; auto slug generation; share links
- **Tasks** — full CRUD per client; filter by status, payment, client; payment tracking
- **Calendar** — day/week/month views; link events to clients & tasks; client filter
- **Share Link** — `/share/[slug]` public page: client filters tasks by date range + status, sees invoice-style payment summary

## Setup

### 1. Install dependencies

```bash
npm install
```

### 2. Configure environment

```bash
cp .env.local.example .env.local
# Edit .env.local and paste your Neon DATABASE_URL
# Get it from console.neon.tech → your project → Connection Details (pooled string)
```

### 3. Run locally

```bash
npm run dev
# → http://localhost:3000
```

The database tables are created automatically on first API call - no manual migration needed!

## Deploy to Vercel

1. Push repo to GitHub
2. Import in vercel.com
3. Add environment variable: `DATABASE_URL` = your Neon connection string
4. Deploy — done!

## Share Link

Every client gets a public URL:

```
https://yourapp.vercel.app/share/[client-slug]
```

The client can:
- Filter by date range
- Filter by task status
- See totals for paid/partial/unpaid amounts

## Project Structure

```
public/              ← static HTML/CSS/JS files (served directly)
  index.html         ← Dashboard page
  clients.html       ← Clients management
  tasks.html         ← Tasks management
  calendar.html      ← Calendar view
  share.html         ← Public client portal template
  css/style.css      ← Shared stylesheet
  js/
    utils.js         ← Shared helpers (formatCurrency, formatDate, isOverdue)
    dashboard.js     ← Dashboard logic
    clients.js       ← Clients CRUD
    tasks.js         ← Tasks CRUD
    calendar.js      ← Calendar logic
    share.js         ← Public portal logic

lib/db.js            ← Database connection + auto table creation
server.js            ← Unified router (all API endpoints + static file serving)
```

## API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/clients` | List all clients |
| POST | `/api/clients` | Create client |
| GET | `/api/clients/:id` | Get client by ID |
| PUT | `/api/clients/:id` | Update client |
| DELETE | `/api/clients/:id` | Delete client |
| GET | `/api/work-items` | List tasks (with filters) |
| POST | `/api/work-items` | Create task |
| GET/PUT/DELETE | `/api/work-items/:id` | Task operations |
| GET | `/api/calendar-events` | List events |
| POST | `/api/calendar-events` | Create event |
| GET/PUT/DELETE | `/api/calendar-events/:id` | Event operations |
| GET | `/api/dashboard` | Dashboard stats |
| GET | `/api/share/:slug` | Public client data |
| GET | `/share/:slug` | Public client portal page |

## Tech Stack

- **Frontend**: Plain HTML, CSS, JavaScript (no framework, no build step)
- **Backend**: Node.js with built-in `http` module
- **Database**: PostgreSQL via Neon (serverless)
- **ORM**: Raw SQL with `pg` driver
- **Styling**: Tailwind-inspired custom CSS
