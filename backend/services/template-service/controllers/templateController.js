const { Op } = require('sequelize');
const { initializeModels } = require('../../../shared/models');
const { getStaticUserId } = require('../../../shared/config/staticUser');

/**
 * Build template_key_value JSON from template pages (all boxes with fieldName).
 * @param {Array<{ boxes?: Array<{ fieldName?: string, content?: string }> }>} pages
 * @returns {Object} e.g. { "shipper": "{{shipper}}", "bill_of_lading_number": "{{bill_of_lading_number}}" }
 */
function buildTemplateKeyValueFromPages(pages) {
  const kv = {};
  if (!Array.isArray(pages)) return kv;
  for (const page of pages) {
    const boxes = page?.boxes || [];
    for (const box of boxes) {
      const key = box.fieldName || box.labelName;
      if (!key) continue;
      const safeKey = String(key).trim();
      if (!safeKey) continue;
      kv[safeKey] = box.content != null ? String(box.content) : `{{${safeKey}}}`;
    }
  }
  return kv;
}

/**
 * Validate that every box fieldName is in the standardized template's allowed keys.
 * The key "logo" is always allowed in all templates (standard and normal).
 * @param {Array} pages - template pages
 * @param {Array<{ key: string }>} allowedPairs - keyValuePairs from StandardizedTemplate
 * @returns {{ valid: boolean, invalidKeys?: string[] }}
 */
function validateStandardizedKeys(pages, allowedPairs) {
  const allowedSet = new Set((allowedPairs || []).map((p) => String(p.key).trim().toLowerCase()));
  const invalidKeys = [];
  if (!Array.isArray(pages)) return { valid: true };
  for (const page of pages) {
    for (const box of page?.boxes || []) {
      const key = (box.fieldName || box.labelName || '').trim();
      if (!key) continue;
      const keyLower = key.toLowerCase();
      if (keyLower === 'logo') continue; // logo is always allowed in all templates
      if (!allowedSet.has(keyLower)) {
        invalidKeys.push(key);
      }
    }
  }
  return { valid: invalidKeys.length === 0, invalidKeys: invalidKeys.length ? invalidKeys : undefined };
}

const templateController = {
  getLibrary: async (req, res) => {
    const sampleTemplates = [
      { id: '1', name: 'Bill of Lading', category: 'Shipping' },
      { id: '2', name: 'Certificate of Origin', category: 'Shipping' },
      { id: '3', name: 'Commercial Invoice', category: 'Invoice' },
      { id: '4', name: 'Packing List', category: 'Shipping' },
      { id: '5', name: 'Proforma Invoice', category: 'Invoice' },
    ];
    res.json(sampleTemplates);
  },

  getTemplates: async (req, res) => {
    try {
      const userId = getStaticUserId();
      const models = await initializeModels();
      const { Template } = models;

      const templates = await Template.findAll({
        where: { userId },
        order: [['updatedAt', 'DESC']],
        attributes: ['id', 'name', 'documentName', 'description', 'category', 'settings', 'pages', 'templateKeyValue', 'standardizedTemplateId', 'createdAt', 'updatedAt'],
      });

      res.json(templates);
    } catch (error) {
      console.error('Get templates error:', error);
      res.status(500).json({ message: 'Error fetching templates', error: error.message });
    }
  },

  getTemplateById: async (req, res) => {
    try {
      const userId = getStaticUserId();
      const models = await initializeModels();
      const { Template } = models;

      const template = await Template.findOne({
        where: { id: req.params.id, userId },
      });
      if (!template) {
        return res.status(404).json({ message: 'Template not found' });
      }
      res.json(template);
    } catch (error) {
      console.error('Get template error:', error);
      res.status(500).json({ message: 'Error fetching template' });
    }
  },

  createTemplate: async (req, res) => {
    try {
      const userId = getStaticUserId();
      const models = await initializeModels();
      const { Template, StandardizedTemplate } = models;
      const { name, documentName, description, category, settings, pages, isPublic, standardizedTemplateId } = req.body;
      const pagesList = pages || [];

      if (!name || name.trim() === '') {
        return res.status(400).json({ message: 'Template name is required' });
      }

      const nameTrim = name.trim();
      const existingTemplate = await Template.findOne({
        where: {
          userId,
          isActive: true,
          name: { [Op.iLike]: nameTrim },
        },
      });
      if (existingTemplate) {
        return res.status(409).json({ message: 'A template with this name already exists. Use a different name.' });
      }

      if (standardizedTemplateId) {
        const standard = await StandardizedTemplate.findByPk(standardizedTemplateId);
        if (!standard) {
          return res.status(400).json({ message: 'Standardized template not found' });
        }
        const validation = validateStandardizedKeys(pagesList, standard.keyValuePairs);
        if (!validation.valid) {
          return res.status(400).json({
            message: 'Only keys from the standardized template are allowed. Invalid keys: ' + (validation.invalidKeys || []).join(', '),
            invalidKeys: validation.invalidKeys,
          });
        }
      }

      const templateKeyValue = buildTemplateKeyValueFromPages(pagesList);

      const template = await Template.create({
        name: nameTrim,
        documentName: documentName != null ? String(documentName).trim() || null : null,
        description: description || '',
        category: category || '',
        userId,
        isPublic: isPublic || false,
        standardizedTemplateId: standardizedTemplateId || null,
        settings: settings || {
          orientation: 'portrait',
          pageSize: 'A4',
          margins: { top: 20, bottom: 20, left: 20, right: 20 },
          title: name.trim(),
        },
        pages: pagesList,
        templateKeyValue: Object.keys(templateKeyValue).length > 0 ? templateKeyValue : null,
        version: '1.0',
        parentTemplateId: null,
        isActive: true,
      });

      res.status(201).json(template);
    } catch (error) {
      console.error('Create template error:', error);
      res.status(500).json({ message: 'Error creating template', error: error.message });
    }
  },

  updateTemplate: async (req, res) => {
    try {
      const userId = getStaticUserId();
      const models = await initializeModels();
      const { Template } = models;

      const template = await Template.findOne({
        where: { id: req.params.id, userId },
      });
      if (!template) {
        return res.status(404).json({ message: 'Template not found' });
      }

      const { name, documentName, description, category, settings, pages, isPublic, standardizedTemplateId } = req.body;
      const nextPages = pages !== undefined ? pages : template.pages;
      const nextStandardizedId = standardizedTemplateId !== undefined ? standardizedTemplateId : template.standardizedTemplateId;

      if (nextStandardizedId) {
        const { StandardizedTemplate } = await initializeModels();
        const standard = await StandardizedTemplate.findByPk(nextStandardizedId);
        if (!standard) {
          return res.status(400).json({ message: 'Standardized template not found' });
        }
        const validation = validateStandardizedKeys(nextPages, standard.keyValuePairs);
        if (!validation.valid) {
          return res.status(400).json({
            message: 'Only keys from the standardized template are allowed. Invalid keys: ' + (validation.invalidKeys || []).join(', '),
            invalidKeys: validation.invalidKeys,
          });
        }
      }

      const templateKeyValue = buildTemplateKeyValueFromPages(nextPages);

      if (name !== undefined && name.trim()) {
        const nameTrim = name.trim();
        if (nameTrim.toLowerCase() !== template.name.toLowerCase()) {
          const existingTemplate = await Template.findOne({
            where: {
              userId,
              isActive: true,
              id: { [Op.ne]: template.id },
              name: { [Op.iLike]: nameTrim },
            },
          });
          if (existingTemplate) {
            return res.status(409).json({ message: 'A template with this name already exists. Use a different name.' });
          }
        }
      }

      await template.update({
        name: name !== undefined ? (name.trim() || template.name) : template.name,
        documentName: documentName !== undefined ? (String(documentName).trim() || null) : template.documentName,
        description: description !== undefined ? description : template.description,
        category: category !== undefined ? category : template.category,
        settings: settings || template.settings,
        pages: nextPages,
        templateKeyValue: Object.keys(templateKeyValue).length > 0 ? templateKeyValue : null,
        isPublic: isPublic !== undefined ? isPublic : template.isPublic,
        standardizedTemplateId: nextStandardizedId || null,
      });

      res.json(template);
    } catch (error) {
      console.error('Update template error:', error);
      res.status(500).json({ message: 'Error updating template', error: error.message });
    }
  },

  deleteTemplate: async (req, res) => {
    try {
      const userId = getStaticUserId();
      const models = await initializeModels();
      const { Template } = models;

      const template = await Template.findOne({
        where: { id: req.params.id, userId },
      });
      if (!template) {
        return res.status(404).json({ message: 'Template not found' });
      }
      await template.destroy();
      res.json({ message: 'Template deleted' });
    } catch (error) {
      console.error('Delete template error:', error);
      res.status(500).json({ message: 'Error deleting template', error: error.message });
    }
  },
};

module.exports = templateController;
