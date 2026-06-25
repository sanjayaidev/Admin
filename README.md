# ClientPM — Step 1: Clients (plain HTML + Node)

No build step, no TypeScript, no framework. Every file does exactly what it
looks like it does — open any file top to bottom and you'll understand it.

## Structure

```
public/              ← what the browser loads (plain HTML/CSS/JS)
  index.html         ← (not built yet — step 2)
  clients.html        the Clients page
  tasks.html          ← (not built yet — step 2)
  reminders.html      ← (not built yet — step 3)
  css/style.css       one shared stylesheet for every page
  js/clients.js       all the logic for the Clients page

api/                 ← serverless functions, one file = one API route
  clients.js          GET /api/clients, POST /api/clients
  clients/[id].js      PUT /api/clients/:id, DELETE /api/clients/:id

lib/db.js            ← shared database connection + auto-table-creation
```

## How the database works

You don't need to run any migration command. The first time any API route
is called, `lib/db.js` runs `CREATE TABLE IF NOT EXISTS` for every table.
If the tables already exist, nothing happens. If they don't, they get
created automatically. This means: **connect Neon, deploy, done.**

## Deploying

1. Push this folder to GitHub.
2. Import it into Vercel (vercel.com → New Project).
3. In Vercel project settings → Environment Variables, add:
   - `DATABASE_URL` = your Neon connection string (the one with `?sslmode=require`)
4. Deploy. Vercel automatically:
   - Serves everything in `public/` as static files
   - Turns every file in `api/` into its own serverless endpoint
5. Visit `/clients.html` — the Clients page will create its own tables on
   first load and you can start adding clients immediately.

## Running locally (optional)

Vercel's local dev command handles both static files and API routes the
same way production does:

```
npm install -g vercel
npm install
vercel dev
```

Then open `http://localhost:3000/clients.html`.

## What's next

This is step 1 of the rebuild — Clients only, fully working end to end.
Next steps (one at a time, same pattern): Tasks, Dashboard, Reminders.
