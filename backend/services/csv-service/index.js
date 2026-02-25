require('dotenv').config();
const express = require('express');
const corsMiddleware = require('../../shared/middleware/cors');
const csvRoutes = require('./routes/csvRoutes');
const StartupLogger = require('../../shared/utils/startupLogger');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.CSV_SERVICE_PORT || 5004;

const uploadsDir = path.join(__dirname, '../../uploads/csv');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

app.use(corsMiddleware);
app.use(express.json());

app.use('/api/csv', csvRoutes);

app.get('/health', (req, res) => {
  res.json({ status: 'OK', service: 'CSV Service', port: PORT });
});

app.listen(PORT, () => {
  StartupLogger.logServiceStarted('csv', PORT);
});

module.exports = app;
