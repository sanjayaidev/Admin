// server.js — Unified router for ClientPM
// Single Node.js server serving static HTML/CSS/JS + API endpoints
// No TypeScript, no framework — plain HTML/CSS/JS frontend

require('dotenv').config();

const http = require('http');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');
const { pool, migrate, makeUniqueSlug } = require('./lib/db');

const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, 'public');

// Initialize database connection and run migrations on startup
if (process.env.NODE_ENV === 'production') {
  migrate().catch(err => {
    console.error('Failed to run migrations:', err);
    process.exit(1);
  });
}

// MIME types for static files
const MIME_TYPES = {
  '.html': 'text/html',
  '.css': 'text/css',
  '.js': 'application/javascript',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon'
};

// Parse JSON body from request
function parseBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (e) {
        reject(e);
      }
    });
    req.on('error', reject);
  });
}

// Send JSON response
function sendJSON(res, statusCode, data) {
  res.writeHead(statusCode, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}

// Serve static file
function serveStatic(res, filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const contentType = MIME_TYPES[ext] || 'application/octet-stream';
  
  fs.readFile(filePath, (err, content) => {
    if (err) {
      if (err.code === 'ENOENT') {
        res.writeHead(404);
        res.end('File not found');
      } else {
        res.writeHead(500);
        res.end('Server error');
      }
    } else {
      res.writeHead(200, { 'Content-Type': contentType });
      res.end(content);
    }
  });
}

// API: Clients
async function handleClients(req, res, method) {
  await migrate();
  
  if (method === 'GET') {
    const { rows } = await pool.query('SELECT * FROM clients ORDER BY created_at DESC');
    return sendJSON(res, 200, rows);
  }
  
  if (method === 'POST') {
    let body;
    try {
      body = await parseBody(req);
    } catch (e) {
      return sendJSON(res, 400, { error: 'Invalid JSON' });
    }
    
    const { name, email, phone, company, address, notes } = body;
    if (!name || !name.trim()) {
      return sendJSON(res, 400, { error: 'Name is required' });
    }
    const slug = await makeUniqueSlug(name);
    const { rows } = await pool.query(
      `INSERT INTO clients (name, email, phone, company, address, notes, slug, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, NULL) RETURNING *`,
      [name, email || null, phone || null, company || null, address || null, notes || null, slug]
    );
    return sendJSON(res, 201, rows[0]);
  }
  
  return sendJSON(res, 405, { error: `Method ${method} not allowed` });
}

// API: Single Client by ID
async function handleClientById(req, res, method, id) {
  await migrate();
  
  if (method === 'GET') {
    const { rows } = await pool.query('SELECT * FROM clients WHERE id = $1', [id]);
    if (rows.length === 0) {
      return sendJSON(res, 404, { error: 'Client not found' });
    }
    return sendJSON(res, 200, rows[0]);
  }
  
  if (method === 'PUT') {
    let body;
    try {
      body = await parseBody(req);
    } catch (e) {
      return sendJSON(res, 400, { error: 'Invalid JSON' });
    }
    
    const { name, email, phone, company, address, notes } = body;
    if (!name || !name.trim()) {
      return sendJSON(res, 400, { error: 'Name is required' });
    }
    const { rows } = await pool.query(
      `UPDATE clients SET name=$1, email=$2, phone=$3, company=$4, address=$5, notes=$6, updated_at=CURRENT_TIMESTAMP
       WHERE id=$7 RETURNING *`,
      [name, email || null, phone || null, company || null, address || null, notes || null, id]
    );
    if (rows.length === 0) {
      return sendJSON(res, 404, { error: 'Client not found' });
    }
    return sendJSON(res, 200, rows[0]);
  }
  
  if (method === 'DELETE') {
    const { rows } = await pool.query('DELETE FROM clients WHERE id=$1 RETURNING id', [id]);
    if (rows.length === 0) {
      return sendJSON(res, 404, { error: 'Client not found' });
    }
    return sendJSON(res, 200, { deleted: true });
  }
  
  return sendJSON(res, 405, { error: `Method ${method} not allowed` });
}

// API: Work Items (Tasks)
async function handleWorkItems(req, res, method) {
  await migrate();
  
  if (method === 'GET') {
    const urlObj = new URL(req.url, `http://localhost:${PORT}`);
    const clientId = urlObj.searchParams.get('client_id');
    const status = urlObj.searchParams.get('status');
    const paymentStatus = urlObj.searchParams.get('payment_status');
    
    let query = `
      SELECT w.*, c.name AS client_name, c.slug AS client_slug
      FROM work_items w
      LEFT JOIN clients c ON c.id = w.client_id
      WHERE 1=1
    `;
    const params = [];
    let paramIndex = 1;
    
    if (clientId) {
      query += ` AND w.client_id = $${paramIndex}`;
      params.push(clientId);
      paramIndex++;
    }
    if (status) {
      query += ` AND w.status = $${paramIndex}`;
      params.push(status);
      paramIndex++;
    }
    if (paymentStatus) {
      query += ` AND w.payment_status = $${paramIndex}`;
      params.push(paymentStatus);
      paramIndex++;
    }
    
    query += ' ORDER BY w.due_date ASC NULLS LAST, w.created_at DESC';
    
    const { rows } = await pool.query(query, params);
    return sendJSON(res, 200, rows);
  }
  
  if (method === 'POST') {
    let body;
    try {
      body = await parseBody(req);
    } catch (e) {
      return sendJSON(res, 400, { error: 'Invalid JSON' });
    }
    
    const { client_id, title, description, status, priority, due_date, amount, payment_status, assigned_to } = body;
    if (!client_id || !title) {
      return sendJSON(res, 400, { error: 'client_id and title are required' });
    }
    
    const { rows } = await pool.query(
      `INSERT INTO work_items (client_id, title, description, status, priority, due_date, amount, payment_status, assigned_to, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NULL) RETURNING *`,
      [client_id, title, description || null, status || 'pending', priority || 'medium', due_date || null, amount || null, payment_status || 'unpaid', assigned_to || null]
    );
    return sendJSON(res, 201, rows[0]);
  }
  
  return sendJSON(res, 405, { error: `Method ${method} not allowed` });
}

// API: Single Work Item by ID
async function handleWorkItemById(req, res, method, id) {
  await migrate();
  
  if (method === 'GET') {
    const { rows } = await pool.query(
      `SELECT w.*, c.name AS client_name, c.slug AS client_slug
       FROM work_items w
       LEFT JOIN clients c ON c.id = w.client_id
       WHERE w.id = $1`,
      [id]
    );
    if (rows.length === 0) {
      return sendJSON(res, 404, { error: 'Work item not found' });
    }
    return sendJSON(res, 200, rows[0]);
  }
  
  if (method === 'PUT') {
    let body;
    try {
      body = await parseBody(req);
    } catch (e) {
      return sendJSON(res, 400, { error: 'Invalid JSON' });
    }
    
    const { client_id, title, description, status, priority, due_date, amount, payment_status, assigned_to } = body;
    
    const { rows } = await pool.query(
      `UPDATE work_items 
       SET client_id=$1, title=$2, description=$3, status=$4, priority=$5, due_date=$6, amount=$7, payment_status=$8, assigned_to=$9, updated_at=CURRENT_TIMESTAMP
       WHERE id=$10 RETURNING *`,
      [client_id, title, description || null, status || 'pending', priority || 'medium', due_date || null, amount || null, payment_status || 'unpaid', assigned_to || null, id]
    );
    if (rows.length === 0) {
      return sendJSON(res, 404, { error: 'Work item not found' });
    }
    return sendJSON(res, 200, rows[0]);
  }
  
  if (method === 'DELETE') {
    const { rows } = await pool.query('DELETE FROM work_items WHERE id=$1 RETURNING id', [id]);
    if (rows.length === 0) {
      return sendJSON(res, 404, { error: 'Work item not found' });
    }
    return sendJSON(res, 200, { deleted: true });
  }
  
  return sendJSON(res, 405, { error: `Method ${method} not allowed` });
}

// API: Calendar Events
async function handleCalendarEvents(req, res, method) {
  await migrate();
  
  if (method === 'GET') {
    const urlObj = new URL(req.url, `http://localhost:${PORT}`);
    const userId = urlObj.searchParams.get('user_id');
    const workItemId = urlObj.searchParams.get('work_item_id');
    const startDate = urlObj.searchParams.get('start_date');
    const endDate = urlObj.searchParams.get('end_date');
    
    let query = `
      SELECT e.*, w.title AS work_item_title, w.client_id
      FROM calendar_events e
      LEFT JOIN work_items w ON w.id = e.work_item_id
      WHERE 1=1
    `;
    const params = [];
    let paramIndex = 1;
    
    if (userId) {
      query += ` AND e.user_id = $${paramIndex}`;
      params.push(userId);
      paramIndex++;
    }
    if (workItemId) {
      query += ` AND e.work_item_id = $${paramIndex}`;
      params.push(workItemId);
      paramIndex++;
    }
    if (startDate) {
      query += ` AND e.event_date >= $${paramIndex}`;
      params.push(startDate);
      paramIndex++;
    }
    if (endDate) {
      query += ` AND e.event_date <= $${paramIndex}`;
      params.push(endDate);
      paramIndex++;
    }
    
    query += ' ORDER BY e.event_date ASC';
    
    const { rows } = await pool.query(query, params);
    return sendJSON(res, 200, rows);
  }
  
  if (method === 'POST') {
    let body;
    try {
      body = await parseBody(req);
    } catch (e) {
      return sendJSON(res, 400, { error: 'Invalid JSON' });
    }
    
    const { work_item_id, user_id, title, description, event_date, event_type, external_calendar_id } = body;
    if (!user_id || !title || !event_date) {
      return sendJSON(res, 400, { error: 'user_id, title, and event_date are required' });
    }
    
    const { rows } = await pool.query(
      `INSERT INTO calendar_events (work_item_id, user_id, title, description, event_date, event_type, external_calendar_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
      [work_item_id || null, user_id, title, description || null, event_date, event_type || 'task', external_calendar_id || null]
    );
    return sendJSON(res, 201, rows[0]);
  }
  
  return sendJSON(res, 405, { error: `Method ${method} not allowed` });
}

// API: Single Calendar Event by ID
async function handleCalendarEventById(req, res, method, id) {
  await migrate();
  
  if (method === 'PUT') {
    let body;
    try {
      body = await parseBody(req);
    } catch (e) {
      return sendJSON(res, 400, { error: 'Invalid JSON' });
    }
    
    const { work_item_id, user_id, title, description, event_date, event_type } = body;
    
    const { rows } = await pool.query(
      `UPDATE calendar_events 
       SET work_item_id=$1, user_id=$2, title=$3, description=$4, event_date=$5, event_type=$6
       WHERE id=$7 RETURNING *`,
      [work_item_id || null, user_id, title, description || null, event_date, event_type || 'task', id]
    );
    if (rows.length === 0) {
      return sendJSON(res, 404, { error: 'Event not found' });
    }
    return sendJSON(res, 200, rows[0]);
  }
  
  if (method === 'DELETE') {
    const { rows } = await pool.query('DELETE FROM calendar_events WHERE id=$1 RETURNING id', [id]);
    if (rows.length === 0) {
      return sendJSON(res, 404, { error: 'Event not found' });
    }
    return sendJSON(res, 200, { deleted: true });
  }
  
  return sendJSON(res, 405, { error: `Method ${method} not allowed` });
}

// API: Work Comments
async function handleWorkComments(req, res, method) {
  await migrate();
  
  if (method === 'GET') {
    const urlObj = new URL(req.url, `http://localhost:${PORT}`);
    const workItemId = urlObj.searchParams.get('work_item_id');
    
    let query = `
      SELECT c.*, u.full_name AS user_name
      FROM work_comments c
      LEFT JOIN users u ON u.id = c.user_id
      WHERE 1=1
    `;
    const params = [];
    
    if (workItemId) {
      query += ' AND c.work_item_id = $1';
      params.push(workItemId);
    }
    
    query += ' ORDER BY c.created_at ASC';
    
    const { rows } = await pool.query(query, params);
    return sendJSON(res, 200, rows);
  }
  
  if (method === 'POST') {
    let body;
    try {
      body = await parseBody(req);
    } catch (e) {
      return sendJSON(res, 400, { error: 'Invalid JSON' });
    }
    
    const { work_item_id, user_id, comment } = body;
    if (!work_item_id || !user_id || !comment) {
      return sendJSON(res, 400, { error: 'work_item_id, user_id, and comment are required' });
    }
    
    const { rows } = await pool.query(
      `INSERT INTO work_comments (work_item_id, user_id, comment) VALUES ($1, $2, $3) RETURNING *`,
      [work_item_id, user_id, comment]
    );
    return sendJSON(res, 201, rows[0]);
  }
  
  return sendJSON(res, 405, { error: `Method ${method} not allowed` });
}

// API: Dashboard Stats
async function handleDashboard(req, res, method) {
  await migrate();
  
  if (method !== 'GET') {
    return sendJSON(res, 405, { error: `Method ${method} not allowed` });
  }
  
  const urlObj = new URL(req.url, `http://localhost:${PORT}`);
  const clientId = urlObj.searchParams.get('client_id');
  const startDate = urlObj.searchParams.get('start_date');
  const endDate = urlObj.searchParams.get('end_date');
  
  // Build base query conditions
  let whereClause = 'WHERE 1=1';
  const params = [];
  let paramIndex = 1;
  
  if (clientId) {
    whereClause += ` AND w.client_id = $${paramIndex}`;
    params.push(clientId);
    paramIndex++;
  }
  if (startDate) {
    whereClause += ` AND w.due_date >= $${paramIndex}`;
    params.push(startDate);
    paramIndex++;
  }
  if (endDate) {
    whereClause += ` AND w.due_date <= $${paramIndex}`;
    params.push(endDate);
    paramIndex++;
  }
  
  // Get task counts by status
  const statusQuery = `
    SELECT status, COUNT(*) as count
    FROM work_items ${whereClause}
    GROUP BY status
  `;
  const { rows: statusRows } = await pool.query(statusQuery, params);
  
  // Get payment totals
  const paymentQuery = `
    SELECT 
      COALESCE(SUM(amount), 0) as total,
      COALESCE(SUM(CASE WHEN payment_status = 'paid' THEN amount ELSE 0 END), 0) as paid,
      COALESCE(SUM(CASE WHEN payment_status != 'paid' THEN amount ELSE 0 END), 0) as outstanding
    FROM work_items ${whereClause}
  `;
  const { rows: paymentRows } = await pool.query(paymentQuery, params);
  
  // Get overdue tasks
  const overdueQuery = `
    SELECT w.*, c.name AS client_name, c.slug AS client_slug
    FROM work_items w
    LEFT JOIN clients c ON c.id = w.client_id
    ${whereClause.replace('WHERE 1=1', 'WHERE 1=1 AND w.status != \'completed\' AND w.due_date < CURRENT_DATE')}
    ORDER BY w.due_date ASC
  `;
  const { rows: overdueRows } = await pool.query(overdueQuery, params);
  
  // Get recent tasks
  const recentQuery = `
    SELECT w.*, c.name AS client_name, c.slug AS client_slug
    FROM work_items w
    LEFT JOIN clients c ON c.id = w.client_id
    ${whereClause}
    ORDER BY w.created_at DESC
    LIMIT 20
  `;
  const { rows: recentRows } = await pool.query(recentQuery, params);
  
  const stats = {
    byStatus: {},
    payments: paymentRows[0],
    overdue: overdueRows,
    recent: recentRows
  };
  
  statusRows.forEach(row => {
    stats.byStatus[row.status] = parseInt(row.count);
  });
  
  return sendJSON(res, 200, stats);
}

// API: Share Link (Public client view)
async function handleShare(req, res, method, slug) {
  await migrate();
  
  if (method !== 'GET') {
    return sendJSON(res, 405, { error: `Method ${method} not allowed` });
  }
  
  const urlObj = new URL(req.url, `http://localhost:${PORT}`);
  const startDate = urlObj.searchParams.get('start_date');
  const endDate = urlObj.searchParams.get('end_date');
  const status = urlObj.searchParams.get('status');
  
  // Get client by slug
  const { rows: clientRows } = await pool.query('SELECT * FROM clients WHERE slug = $1', [slug]);
  if (clientRows.length === 0) {
    return sendJSON(res, 404, { error: 'Client not found' });
  }
  const client = clientRows[0];
  
  // Build query for work items
  let query = `
    SELECT * FROM work_items
    WHERE client_id = $1
  `;
  const params = [client.id];
  let paramIndex = 2;
  
  if (startDate) {
    query += ` AND due_date >= $${paramIndex}`;
    params.push(startDate);
    paramIndex++;
  }
  if (endDate) {
    query += ` AND due_date <= $${paramIndex}`;
    params.push(endDate);
    paramIndex++;
  }
  if (status) {
    query += ` AND status = $${paramIndex}`;
    params.push(status);
    paramIndex++;
  }
  
  query += ' ORDER BY due_date ASC NULLS LAST, created_at DESC';
  
  const { rows: workItems } = await pool.query(query, params);
  
  // Calculate payment summary
  const summary = {
    total: 0,
    paid: 0,
    partial: 0,
    unpaid: 0
  };
  
  workItems.forEach(item => {
    const amount = Number(item.amount) || 0;
    summary.total += amount;
    if (item.payment_status === 'paid') {
      summary.paid += amount;
    } else if (item.payment_status === 'partial') {
      summary.partial += amount;
    } else {
      summary.unpaid += amount;
    }
  });
  
  return sendJSON(res, 200, {
    client,
    workItems,
    summary
  });
}

// Main request handler
const server = http.createServer(async (req, res) => {
  const parsedUrl = new URL(req.url, `http://localhost:${PORT}`);
  const pathname = parsedUrl.pathname;
  const method = req.method;
  
  // Enable CORS for local development
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  
  if (method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }
  
  // API Routes
  try {
    // /api/dashboard
    if (pathname === '/api/dashboard') {
      return handleDashboard(req, res, method);
    }
    
    // /api/clients
    if (pathname === '/api/clients') {
      return handleClients(req, res, method);
    }
    
    // /api/clients/:id
    const clientMatch = pathname.match(/^\/api\/clients\/(\d+)$/);
    if (clientMatch) {
      return handleClientById(req, res, method, clientMatch[1]);
    }
    
    // /api/work-items
    if (pathname === '/api/work-items') {
      return handleWorkItems(req, res, method);
    }
    
    // /api/work-items/:id
    const workItemMatch = pathname.match(/^\/api\/work-items\/(\d+)$/);
    if (workItemMatch) {
      return handleWorkItemById(req, res, method, workItemMatch[1]);
    }
    
    // /api/calendar-events
    if (pathname === '/api/calendar-events') {
      return handleCalendarEvents(req, res, method);
    }
    
    // /api/calendar-events/:id
    const eventMatch = pathname.match(/^\/api\/calendar-events\/(\d+)$/);
    if (eventMatch) {
      return handleCalendarEventById(req, res, method, eventMatch[1]);
    }
    
    // /api/work-comments
    if (pathname === '/api/work-comments') {
      return handleWorkComments(req, res, method);
    }
    
    // /api/share/:slug
    const shareMatch = pathname.match(/^\/api\/share\/([^/]+)$/);
    if (shareMatch) {
      return handleShare(req, res, method, shareMatch[1]);
    }
    
    // /share/:slug - serve static share.html
    const sharePageMatch = pathname.match(/^\/share\/([^/]+)$/);
    if (sharePageMatch) {
      const filePath = path.join(PUBLIC_DIR, 'share.html');
      return serveStatic(res, filePath);
    }
    
    // Static Files
    let filePath = path.join(PUBLIC_DIR, pathname === '/' ? 'index.html' : pathname);
    
    // Security: prevent directory traversal
    if (!filePath.startsWith(PUBLIC_DIR)) {
      res.writeHead(403);
      res.end('Forbidden');
      return;
    }
    
    // Check if file exists, if not try index.html in that directory
    fs.stat(filePath, (err, stats) => {
      if (err || !stats.isFile()) {
        // Try adding .html extension
        const htmlPath = filePath.endsWith('.html') ? filePath : filePath + '.html';
        fs.stat(htmlPath, (err2, stats2) => {
          if (err2 || !stats2.isFile()) {
            // Try index.html in directory
            const indexPath = path.join(filePath, 'index.html');
            fs.stat(indexPath, (err3, stats3) => {
              if (err3 || !stats3.isFile()) {
                res.writeHead(404);
                res.end('Not Found');
              } else {
                serveStatic(res, indexPath);
              }
            });
          } else {
            serveStatic(res, htmlPath);
          }
        });
      } else {
        serveStatic(res, filePath);
      }
    });
    
  } catch (error) {
    console.error('Server error:', error);
    sendJSON(res, 500, { error: 'Internal server error' });
  }
});

server.listen(PORT, () => {
  console.log(`ClientPM server running at http://localhost:${PORT}`);
  console.log('Press Ctrl+C to stop');
});
