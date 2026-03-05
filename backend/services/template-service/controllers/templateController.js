const { Op } = require('sequelize');
const { initializeModels } = require('../../../shared/models');
const { getStaticUserId } = require('../../../shared/config/staticUser');
const logger = require('../../../shared/utils/logger');

/** Strip undefined and ensure JSON-serializable values for JSONB columns */
function toJsonSafe(obj) {
  if (obj === null) return null;
  if (obj === undefined) return null;
  if (typeof obj !== 'object') return obj;
  if (Array.isArray(obj)) return obj.map(toJsonSafe);
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v !== undefined) out[k] = toJsonSafe(v);
  }
  return out;
}

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
      logger.error('Get templates error', { error: error.message, stack: error.stack });
      res.status(500).json({ message: 'Error fetching templates', error: error.message });
    }
  },

  getTemplateById: async (req, res) => {
    try {
      const models = await initializeModels();
      const { Template } = models;

      const template = await Template.findOne({
        where: { id: req.params.id, isActive: true },
      });
      if (!template) {
        return res.status(404).json({ message: 'Template not found' });
      }
      res.json(template);
    } catch (error) {
      logger.error('Get template error', { id: req.params.id, error: error.message, stack: error.stack });
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
      logger.error('Create template error', { error: error.message, stack: error.stack, body: { name: req.body?.name } });
      res.status(500).json({ message: 'Error creating template', error: error.message });
    }
  },

  updateTemplate: async (req, res) => {
    const start = Date.now();
    logger.info('Update template request', { id: req.params.id, bodyKeys: Object.keys(req.body || {}), pageCount: req.body?.pages?.length });
    try {
      const models = await initializeModels();
      const { Template } = models;

      const template = await Template.findOne({
        where: { id: req.params.id, isActive: true },
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

      const templateKeyValue = buildTemplateKeyValueFromPages(Array.isArray(nextPages) ? nextPages : template.pages || []);

      if (name !== undefined && typeof name === 'string' && name.trim()) {
        const nameTrim = name.trim();
        if (nameTrim.toLowerCase() !== template.name.toLowerCase()) {
          const existingTemplate = await Template.findOne({
            where: {
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

      const nextName = name !== undefined ? (String(name).trim() || template.name) : template.name;
      const nextDocName = documentName !== undefined ? (String(documentName).trim() || null) : template.documentName;
      const safePages = Array.isArray(nextPages) ? toJsonSafe(nextPages) : (template.pages || []);
      const safeSettings = settings && typeof settings === 'object' && !Array.isArray(settings) ? toJsonSafe(settings) : (template.settings || {});

      await template.update({
        name: nextName,
        documentName: nextDocName,
        description: description !== undefined ? (description ?? '') : template.description,
        category: category !== undefined ? (category ?? '') : template.category,
        settings: safeSettings,
        pages: safePages,
        templateKeyValue: Object.keys(templateKeyValue).length > 0 ? templateKeyValue : null,
        isPublic: isPublic !== undefined ? Boolean(isPublic) : template.isPublic,
        standardizedTemplateId: nextStandardizedId || null,
      });

      logger.info('Update template success', { id: req.params.id, durationMs: Date.now() - start });
      res.json(template);
    } catch (error) {
      logger.error('Update template error', {
        id: req.params.id,
        error: error.message,
        stack: error.stack,
        sequelizeErrors: error.errors?.map((e) => ({ path: e.path, message: e.message })),
      });
      const errMsg = error.message || String(error);
      const errDetail = error.errors ? error.errors.map((e) => e.message).join('; ') : null;
      res.status(500).json({
        message: 'Error updating template',
        error: errMsg,
        ...(errDetail && { detail: errDetail }),
      });
    }
  },

  deleteTemplate: async (req, res) => {
    try {
      const models = await initializeModels();
      const { Template } = models;

      const template = await Template.findOne({
        where: { id: req.params.id },
      });
      if (!template) {
        return res.status(404).json({ message: 'Template not found' });
      }
      await template.destroy();
      res.json({ message: 'Template deleted' });
    } catch (error) {
      logger.error('Delete template error', { id: req.params.id, error: error.message, stack: error.stack });
      res.status(500).json({ message: 'Error deleting template', error: error.message });
    }
  },
};

module.exports = templateController;
