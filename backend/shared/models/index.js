const { connectDB, getSequelize } = require('../config/database');
const initTemplateModel = require('./Template');
const initGeneratedPdfModel = require('./GeneratedPdf');
const initStandardizedTemplateModel = require('./StandardizedTemplate');
const initTemplateDesignModel = require('./TemplateDesign');

let Template, GeneratedPdf, StandardizedTemplate, TemplateDesign;
let modelsInitialized = false;

const initializeModels = async () => {
  if (modelsInitialized) {
    return { Template, GeneratedPdf, StandardizedTemplate, TemplateDesign };
  }

  const sequelize = await connectDB();

  StandardizedTemplate = initStandardizedTemplateModel(sequelize);
  TemplateDesign = initTemplateDesignModel(sequelize);
  Template = initTemplateModel(sequelize);
  GeneratedPdf = initGeneratedPdfModel(sequelize);

  Template.belongsTo(StandardizedTemplate, { foreignKey: 'standardizedTemplateId', as: 'standardizedTemplate' });
  StandardizedTemplate.hasMany(Template, { foreignKey: 'standardizedTemplateId' });
  TemplateDesign.belongsTo(StandardizedTemplate, { foreignKey: 'standardizedTemplateId', as: 'standardizedTemplate' });
  StandardizedTemplate.hasMany(TemplateDesign, { foreignKey: 'standardizedTemplateId' });

  GeneratedPdf.belongsTo(Template, { foreignKey: 'templateId', as: 'template' });
  Template.hasMany(GeneratedPdf, { foreignKey: 'templateId', as: 'generatedPdfs' });

  modelsInitialized = true;
  return { Template, GeneratedPdf, StandardizedTemplate, TemplateDesign };
};

module.exports = {
  initializeModels,
  getSequelize,
  connectDB,
};
