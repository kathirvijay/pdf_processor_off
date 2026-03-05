const path = require('path');
const fs = require('fs');
const winston = require('winston');

const LOGS_DIR = path.resolve(__dirname, '../../logs');
if (!fs.existsSync(LOGS_DIR)) {
  fs.mkdirSync(LOGS_DIR, { recursive: true });
}

const logFormat = winston.format.combine(
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  winston.format.errors({ stack: true }),
  winston.format.printf(({ level, message, timestamp, stack, ...meta }) => {
    let line = `[${timestamp}] [${level.toUpperCase()}] ${message}`;
    if (stack) line += `\n${stack}`;
    if (Object.keys(meta).length > 0) {
      try {
        line += `\n  ${JSON.stringify(meta)}`;
      } catch (_) {
        line += `\n  ${String(meta)}`;
      }
    }
    return line;
  })
);

const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: logFormat,
  defaultMeta: { service: process.env.SERVICE_NAME || 'pdf-processor' },
  transports: [
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize(),
        logFormat
      ),
    }),
    new winston.transports.File({
      filename: path.join(LOGS_DIR, 'error.log'),
      level: 'error',
      maxsize: 5 * 1024 * 1024,
      maxFiles: 5,
    }),
    new winston.transports.File({
      filename: path.join(LOGS_DIR, 'combined.log'),
      maxsize: 5 * 1024 * 1024,
      maxFiles: 3,
    }),
  ],
});

module.exports = logger;
