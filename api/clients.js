// api/clients.js
// Handles: GET /api/clients (list all), POST /api/clients (create new)
const { pool, migrate, makeUniqueSlug } = require('../lib/db');

module.exports = async (req, res) => {
  await migrate(); // no-op after the first call, safe to call every time

  if (req.method === 'GET') {
    const { rows } = await pool.query('SELECT * FROM clients ORDER BY created_at DESC');
    return res.status(200).json(rows);
  }

  if (req.method === 'POST') {
    const { name, email, phone, company, address, notes } = req.body;
    if (!name || !name.trim()) {
      return res.status(400).json({ error: 'Name is required' });
    }
    const slug = await makeUniqueSlug(name);
    const { rows } = await pool.query(
      `INSERT INTO clients (name, email, phone, company, address, notes, slug)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
      [name, email || null, phone || null, company || null, address || null, notes || null, slug]
    );
    return res.status(201).json(rows[0]);
  }

  res.setHeader('Allow', ['GET', 'POST']);
  return res.status(405).json({ error: `Method ${req.method} not allowed` });
};
