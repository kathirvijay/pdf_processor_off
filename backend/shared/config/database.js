const { Sequelize } = require('sequelize');

let sequelize;

const connectDB = async () => {
  try {
    const databaseUrl = process.env.DATABASE_URL ||
      `postgresql://${process.env.DB_USER || 'postgres'}:${process.env.DB_PASSWORD || 'postgres'}@${process.env.DB_HOST || 'localhost'}:${process.env.DB_PORT || 5432}/${process.env.DB_NAME || 'pdf_processor'}`;

    sequelize = new Sequelize(databaseUrl, {
      dialect: 'postgres',
      logging: false,
      pool: {
        max: 5,
        min: 0,
        acquire: 30000,
        idle: 10000,
      },
    });

    await sequelize.authenticate();
    const StartupLogger = require('../utils/startupLogger');
    StartupLogger.logDatabaseConnected();

    return sequelize;
  } catch (error) {
    const StartupLogger = require('../utils/startupLogger');
    StartupLogger.logDatabaseError(error);
    if (error.message && error.message.includes('password authentication failed')) {
      console.log('\n  → Fix: set DB_PASSWORD (and DB_USER if needed) in backend/.env to your PostgreSQL credentials.\n');
    }
    process.exit(1);
  }
};

const getSequelize = () => {
  if (!sequelize) {
    throw new Error('Database not initialized. Call connectDB() first.');
  }
  return sequelize;
};

module.exports = { connectDB, getSequelize };
