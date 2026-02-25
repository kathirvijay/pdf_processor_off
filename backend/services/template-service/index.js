require('dotenv').config();
const express = require('express');
const { initializeModels } = require('../../shared/models');
const corsMiddleware = require('../../shared/middleware/cors');
const { ensureModelsReady, setModelsReady } = require('../../shared/middleware/modelsReady');
const templateRoutes = require('./routes/templateRoutes');
const standardizedTemplateRoutes = require('./routes/standardizedTemplateRoutes');
const templateDesignRoutes = require('./routes/templateDesignRoutes');
const StartupLogger = require('../../shared/utils/startupLogger');

const app = express();
const PORT = process.env.TEMPLATE_SERVICE_PORT || 5002;

app.use(corsMiddleware);
app.use(express.json());

(async () => {
  try {
    const models = await initializeModels();
    const sequelize = require('../../shared/config/database').getSequelize();
    await require('../../shared/config/staticUser').resolveStaticUserIdFromDb(sequelize);
    await models.Template.sync({ alter: false });
    if (models.StandardizedTemplate) await models.StandardizedTemplate.sync({ alter: false });
    if (models.TemplateDesign) await models.TemplateDesign.sync({ alter: false });
    setModelsReady(true);
    console.log('✅ Template Service: Models initialized');
  } catch (error) {
    console.error('❌ Template Service:', error.message || error);
    process.exit(1);
  }
})();

app.use('/api/templates', ensureModelsReady, templateRoutes);
app.use('/api/standardized-templates', ensureModelsReady, standardizedTemplateRoutes);
app.use('/api/template-designs', ensureModelsReady, templateDesignRoutes);

app.get('/health', (req, res) => {
  res.json({ status: 'OK', service: 'Template Service', port: PORT });
});

app.listen(PORT, () => {
  StartupLogger.logServiceStarted('template', PORT);
});

module.exports = app;
