require('dotenv').config();
const express = require('express');
const { initializeModels } = require('../../shared/models');
const corsMiddleware = require('../../shared/middleware/cors');
const { ensureModelsReady, setModelsReady } = require('../../shared/middleware/modelsReady');
const pdfRoutes = require('./routes/pdfRoutes');
const StartupLogger = require('../../shared/utils/startupLogger');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PDF_SERVICE_PORT || 5003;

const uploadsDir = path.join(__dirname, '../../uploads/pdfs');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

app.use(corsMiddleware);
app.use(express.json());

(async () => {
  try {
    const models = await initializeModels();
    const sequelize = require('../../shared/config/database').getSequelize();
    await require('../../shared/config/staticUser').resolveStaticUserIdFromDb(sequelize);
    await models.GeneratedPdf.sync({ alter: false });
    setModelsReady(true);
    console.log('✅ PDF Service: Models initialized');
  } catch (error) {
    console.error('❌ PDF Service:', error.message || error);
    process.exit(1);
  }
})();

app.use('/api/pdf', ensureModelsReady, pdfRoutes);

app.get('/health', (req, res) => {
  res.json({ status: 'OK', service: 'PDF Service', port: PORT });
});

app.listen(PORT, () => {
  StartupLogger.logServiceStarted('pdf', PORT);
});

module.exports = app;
