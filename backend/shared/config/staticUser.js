const { QueryTypes } = require('sequelize');

const DEFAULT_USER_ID = '00000000-0000-0000-0000-000000000000';

/**
 * Static user ID for pdf_processor_o (minimal app with no login).
 * Uses STATIC_USER_ID from .env if set; otherwise resolves from the first user in the shared DB.
 * If neither is available, returns DEFAULT_USER_ID.
 */
function getStaticUserId() {
  const id = process.env.STATIC_USER_ID;
  if (!id || id.trim() === '') {
    return DEFAULT_USER_ID;
  }
  return id.trim();
}

/**
 * Resolve static user at startup: use STATIC_USER_ID from env, or first user in users table.
 * Call after DB is connected (e.g. after initializeModels()). Sets process.env.STATIC_USER_ID so getStaticUserId() works.
 */
async function resolveStaticUserIdFromDb(sequelize) {
  if (process.env.STATIC_USER_ID && process.env.STATIC_USER_ID.trim() !== '') {
    return process.env.STATIC_USER_ID.trim();
  }
  const rows = await sequelize.query('SELECT id FROM users LIMIT 1', { type: QueryTypes.SELECT });
  if (rows && rows[0] && rows[0].id) {
    process.env.STATIC_USER_ID = rows[0].id;
    console.log('  → Using first user from database as static user (set STATIC_USER_ID in .env to override).');
    return process.env.STATIC_USER_ID;
  }
  process.env.STATIC_USER_ID = DEFAULT_USER_ID;
  console.log('  → No user in database; using default user id. Create a user or set STATIC_USER_ID in .env to override.');
  return DEFAULT_USER_ID;
}

module.exports = { getStaticUserId, resolveStaticUserIdFromDb };
