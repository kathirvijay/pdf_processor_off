const { QueryTypes } = require('sequelize');

/**
 * Static user ID for pdf_processor_o (minimal app with no login).
 * Uses STATIC_USER_ID from .env if set; otherwise resolves from the first user in the shared DB.
 */
function getStaticUserId() {
  const id = process.env.STATIC_USER_ID;
  if (!id || id.trim() === '') {
    throw new Error(
      'STATIC_USER_ID is not set. Add STATIC_USER_ID=<uuid> to backend/.env. ' +
      'Use a user id from the same database (create a user in the main pdf_processor app or insert into users table).'
    );
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
  throw new Error(
    'No user found in database. Create a user in the main pdf_processor app (Register) or insert into users table, then restart. Or set STATIC_USER_ID=<uuid> in backend/.env.'
  );
}

module.exports = { getStaticUserId, resolveStaticUserIdFromDb };
