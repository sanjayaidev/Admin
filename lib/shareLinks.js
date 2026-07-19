// lib/shareLinks.js
// Client dashboard sharing — secure, revocable, expirable, read-only links.
//
// Design notes:
//   - The raw token is a 32-byte (256-bit) random value, shown to the admin
//     ONCE at creation time. It is never stored or logged in plaintext.
//   - We store only sha256(token) in the database ("token_hash"). Looking up
//     an incoming token means hashing it and doing an indexed equality
//     lookup — a DB leak alone does not hand out working share links.
//   - Every link is scoped to exactly one client_id and one org_id. The
//     public endpoint that serves data can therefore never return another
//     client's or another organization's data, regardless of what query
//     parameters are supplied.
//   - Links are revocable (revoked_at) and optionally expirable (expires_at).
//   - The public endpoint is read-only by construction: no route exists to
//     mutate anything using a share token, only to fetch data.

const crypto = require('crypto');
const { pool } = require('./db');

const TOKEN_BYTES = 32;

function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

// Generates a new share link for a client. Returns the raw token (only
// available here, at creation time) plus the stored record.
async function createShareLink(orgId, clientId, createdByUserId, { label = null, expiresInDays = null } = {}) {
  const token = crypto.randomBytes(TOKEN_BYTES).toString('hex'); // 64 hex chars
  const tokenHash = hashToken(token);
  const tokenPrefix = token.slice(0, 8); // shown in the admin UI to tell links apart, never enough to guess the rest

  let expiresAt = null;
  if (expiresInDays) {
    expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + Number(expiresInDays));
  }

  const { rows } = await pool.query(
    `INSERT INTO client_share_links (org_id, client_id, token_hash, token_prefix, label, created_by, expires_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7)
     RETURNING id, client_id, token_prefix, label, expires_at, created_at`,
    [orgId, clientId, tokenHash, tokenPrefix, label, createdByUserId, expiresAt]
  );

  return { token, link: rows[0] };
}

// Lists share links for a client (never includes the raw token or hash).
async function listShareLinks(orgId, clientId) {
  const { rows } = await pool.query(
    `SELECT id, token_prefix, label, expires_at, revoked_at, last_accessed_at, access_count, created_at
     FROM client_share_links
     WHERE org_id = $1 AND client_id = $2
     ORDER BY created_at DESC`,
    [orgId, clientId]
  );
  return rows;
}

// Revokes a share link. Scoped to org+client so an admin can only revoke
// their own organization's links.
async function revokeShareLink(orgId, clientId, linkId) {
  const { rows } = await pool.query(
    `UPDATE client_share_links SET revoked_at = CURRENT_TIMESTAMP
     WHERE id = $1 AND org_id = $2 AND client_id = $3 AND revoked_at IS NULL
     RETURNING id`,
    [linkId, orgId, clientId]
  );
  return rows.length > 0;
}

// Resolves a raw token from a public URL into { orgId, clientId } if the
// link is valid (exists, not revoked, not expired). Returns null otherwise.
// Also bumps last_accessed_at / access_count for basic audit visibility.
async function resolveShareToken(token) {
  if (!token || typeof token !== 'string') return null;
  const tokenHash = hashToken(token);

  const { rows } = await pool.query(
    `SELECT id, org_id, client_id, expires_at, revoked_at
     FROM client_share_links WHERE token_hash = $1`,
    [tokenHash]
  );
  if (rows.length === 0) return null;

  const link = rows[0];
  if (link.revoked_at) return null;
  if (link.expires_at && new Date(link.expires_at) < new Date()) return null;

  // Fire-and-forget audit update — don't block/fail the request on this.
  pool.query(
    `UPDATE client_share_links SET last_accessed_at = CURRENT_TIMESTAMP, access_count = access_count + 1 WHERE id = $1`,
    [link.id]
  ).catch(() => {});

  return { orgId: link.org_id, clientId: link.client_id };
}

module.exports = {
  createShareLink,
  listShareLinks,
  revokeShareLink,
  resolveShareToken,
};
