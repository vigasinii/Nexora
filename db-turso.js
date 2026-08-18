// Async DB layer backed by Turso (libSQL) instead of the local node:sqlite
// file. Every call is a network round-trip, so every function here is
// async and every call site must `await` it.
//
// Required environment variables (set these in Render's dashboard, and in
// a local .env file for local dev):
//   TURSO_DATABASE_URL   e.g. libsql://nexora-vigasinii.turso.io
//   TURSO_AUTH_TOKEN     the auth token generated in the Turso dashboard
//
// If these aren't set, we fall back to a local file `datahouse.db` purely
// so `node --check`-style local testing / first-run bootstrapping doesn't
// hard-crash — but on Render you MUST set both env vars or nothing will
// persist (the same problem we're trying to fix).

const path = require('path');
const { createClient } = require('@libsql/client');

const url = process.env.TURSO_DATABASE_URL || `file:${path.join(__dirname, 'datahouse.db')}`;
const authToken = process.env.TURSO_AUTH_TOKEN; // not needed for local file: URLs

if (!process.env.TURSO_DATABASE_URL) {
  console.warn('[db-turso] TURSO_DATABASE_URL not set — falling back to local datahouse.db. Data will NOT persist on Render without this env var set.');
}

const client = createClient(
  authToken ? { url, authToken } : { url }
);

// Convert a JS args array (which may contain `undefined`) into something
// libSQL accepts — undefined must become null, everything else passes
// through untouched.
function cleanArgs(args) {
  return args.map(a => (a === undefined ? null : a));
}

/**
 * Run a SELECT and return the first row, or undefined if no rows.
 * Mirrors node:sqlite's `db.prepare(sql).get(...args)`.
 */
async function dbGet(sql, args = []) {
  const rs = await client.execute({ sql, args: cleanArgs(args) });
  return rs.rows[0];
}

/**
 * Run a SELECT and return all rows as an array.
 * Mirrors node:sqlite's `db.prepare(sql).all(...args)`.
 */
async function dbAll(sql, args = []) {
  const rs = await client.execute({ sql, args: cleanArgs(args) });
  return rs.rows;
}

/**
 * Run an INSERT/UPDATE/DELETE. Returns an object with `lastInsertRowid`
 * and `changes`, mirroring node:sqlite's `db.prepare(sql).run(...args)`.
 */
async function dbRun(sql, args = []) {
  const rs = await client.execute({ sql, args: cleanArgs(args) });
  return {
    lastInsertRowid: rs.lastInsertRowid !== undefined && rs.lastInsertRowid !== null
      ? Number(rs.lastInsertRowid)
      : undefined,
    changes: rs.rowsAffected,
  };
}

/**
 * Run raw DDL / multi-statement SQL (schema creation, migrations).
 * Mirrors node:sqlite's `db.exec(sql)`. Splits on `;` so multi-statement
 * CREATE TABLE blocks (as used in the original schema setup) still work,
 * since libSQL's execute() only runs a single statement at a time.
 */
async function dbExec(sql) {
  const statements = sql
    .split(';')
    .map(s => s.trim())
    .filter(Boolean);
  for (const stmt of statements) {
    await client.execute(stmt);
  }
}

module.exports = { client, dbGet, dbAll, dbRun, dbExec };
