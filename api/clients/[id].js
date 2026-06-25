// api/clients/[id].js
// Handles: PUT /api/clients/123 (update), DELETE /api/clients/123 (delete)
// The [id] in the filename is how Vercel knows this is a dynamic route —
// req.query.id will contain whatever number is in the URL.
const { pool, migrate } = require('../../lib/db');

module.exports = async (req, res) => {
  await migrate();
  const { id } = req.query;

  if (req.method === 'PUT') {
    const { name, email, phone, company, address, notes } = req.body;
    if (!name || !name.trim()) {
      return res.status(400).json({ error: 'Name is required' });
    }
    const { rows } = await pool.query(
      `UPDATE clients SET name=$1, email=$2, phone=$3, company=$4, address=$5, notes=$6
       WHERE id=$7 RETURNING *`,
      [name, email || null, phone || null, company || null, address || null, notes || null, id]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Client not found' });
    return res.status(200).json(rows[0]);
  }

  if (req.method === 'DELETE') {
    // ON DELETE CASCADE in the schema means their tasks/reminders get cleaned up automatically.
    const { rows } = await pool.query('DELETE FROM clients WHERE id=$1 RETURNING id', [id]);
    if (rows.length === 0) return res.status(404).json({ error: 'Client not found' });
    return res.status(200).json({ deleted: true });
  }

  res.setHeader('Allow', ['PUT', 'DELETE']);
  return res.status(405).json({ error: `Method ${req.method} not allowed` });
};
