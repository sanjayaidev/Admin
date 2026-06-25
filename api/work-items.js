// api/work-items.js
// For now: GET only (list all tasks, joined with client name/slug).
// POST/PUT/DELETE will be added when we build the Tasks page next.
const { pool, migrate } = require('../lib/db');

module.exports = async (req, res) => {
  await migrate();

  if (req.method === 'GET') {
    const { rows } = await pool.query(`
      SELECT
        w.*,
        c.name AS client_name,
        c.slug AS client_slug
      FROM work_items w
      LEFT JOIN clients c ON c.id = w.client_id
      ORDER BY w.due_date ASC NULLS LAST, w.created_at DESC
    `);
    return res.status(200).json(rows);
  }

  res.setHeader('Allow', ['GET']);
  return res.status(405).json({ error: `Method ${req.method} not allowed (yet)` });
};
