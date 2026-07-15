// src/lib/db.js
// Database utilities for Neon/Postgres - replaces Supabase client
// Uses the main connection pool from lib/db.js

const { pool } = require('../../lib/db');

// Table names, all prefixed with sm_ as decided.
const TABLES = {
  USERS: 'sm_users',
  API_KEYS: 'sm_api_keys',
  CONNECTIONS: 'sm_connections',
  FLOWS: 'sm_flows',
  FLOW_STEPS: 'sm_flow_steps',
  FLOW_RUNS: 'sm_flow_runs',
};

/**
 * Helper to insert a record
 * @param {string} table - Table name
 * @param {object} data - Data to insert
 * @returns {Promise<object>} - Inserted record
 */
async function insert(table, data) {
  const keys = Object.keys(data);
  const values = Object.values(data);
  const placeholders = keys.map((_, i) => `$${i + 1}`);
  
  const query = `
    INSERT INTO ${table} (${keys.join(', ')})
    VALUES (${placeholders.join(', ')})
    RETURNING *
  `;
  
  const result = await pool.query(query, values);
  return result.rows[0];
}

/**
 * Helper to select records with filters
 * @param {string} table - Table name
 * @param {object} filters - Key-value pairs for WHERE clause (arrays become IN clauses)
 * @param {string[]} columns - Columns to select (default: *)
 * @param {object} options - { orderBy, orderDirection }
 * @returns {Promise<object[]>} - Array of records
 */
async function select(table, filters = {}, columns = ['*'], options = {}) {
  const conditions = [];
  const values = [];
  let paramIndex = 1;
  
  for (const [key, value] of Object.entries(filters)) {
    if (Array.isArray(value)) {
      // Handle IN clause for arrays
      const placeholders = value.map((_, i) => `$${paramIndex + i}`);
      conditions.push(`${key} = ANY(ARRAY[${placeholders.join(', ')}])`);
      values.push(...value);
      paramIndex += value.length;
    } else {
      conditions.push(`${key} = $${paramIndex}`);
      values.push(value);
      paramIndex++;
    }
  }
  
  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const orderBy = options.orderBy ? `ORDER BY ${options.orderBy} ${options.orderDirection || 'ASC'}` : '';
  
  const query = `
    SELECT ${columns.join(', ')}
    FROM ${table}
    ${whereClause}
    ${orderBy}
  `;
  
  const result = await pool.query(query, values);
  return result.rows;
}

/**
 * Helper to delete records with filters
 * @param {string} table - Table name
 * @param {object} filters - Key-value pairs for WHERE clause
 * @returns {Promise<number>} - Number of deleted records
 */
async function deleteRows(table, filters = {}) {
  const conditions = [];
  const values = [];
  let paramIndex = 1;
  
  for (const [key, value] of Object.entries(filters)) {
    conditions.push(`${key} = $${paramIndex}`);
    values.push(value);
    paramIndex++;
  }
  
  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  
  const query = `
    DELETE FROM ${table}
    ${whereClause}
  `;
  
  const result = await pool.query(query, values);
  return result.rowCount;
}

/**
 * Helper to update records
 * @param {string} table - Table name
 * @param {object} data - Data to update
 * @param {object} filters - Key-value pairs for WHERE clause
 * @returns {Promise<object>} - Updated record
 */
async function update(table, data, filters = {}) {
  const setKeys = Object.keys(data);
  const setValues = Object.values(data);
  const setClause = setKeys.map((key, i) => `${key} = $${i + 1}`).join(', ');
  
  const conditions = [];
  const whereValues = [];
  let paramIndex = setValues.length + 1;
  
  for (const [key, value] of Object.entries(filters)) {
    conditions.push(`${key} = $${paramIndex}`);
    whereValues.push(value);
    paramIndex++;
  }
  
  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const allValues = [...setValues, ...whereValues];
  
  const query = `
    UPDATE ${table}
    SET ${setClause}
    ${whereClause}
    RETURNING *
  `;
  
  const result = await pool.query(query, allValues);
  return result.rows[0];
}

module.exports = { 
  pool, 
  TABLES,
  insert,
  select,
  delete: deleteRows,
  update
};
