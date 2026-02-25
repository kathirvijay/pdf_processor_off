const { Op } = require('sequelize');
const { initializeModels } = require('../../../shared/models');

const standardizedTemplateController = {
  list: async (req, res) => {
    try {
      const models = await initializeModels();
      const { StandardizedTemplate } = models;
      const list = await StandardizedTemplate.findAll({
        where: { isActive: true },
        order: [['name', 'ASC']],
        attributes: ['id', 'name', 'slug', 'description', 'keyValuePairs'],
      });
      res.json(list);
    } catch (error) {
      console.error('List standardized templates error:', error);
      res.status(500).json({ message: 'Error listing standardized templates', error: error.message });
    }
  },

  getById: async (req, res) => {
    try {
      const models = await initializeModels();
      const { StandardizedTemplate } = models;
      const row = await StandardizedTemplate.findOne({
        where: { id: req.params.id, isActive: true },
      });
      if (!row) {
        return res.status(404).json({ message: 'Standardized template not found' });
      }
      res.json(row);
    } catch (error) {
      console.error('Get standardized template error:', error);
      res.status(500).json({ message: 'Error fetching standardized template', error: error.message });
    }
  },

  create: async (req, res) => {
    try {
      const models = await initializeModels();
      const { StandardizedTemplate } = models;
      const { name, slug, description, keyValuePairs } = req.body;
      if (!name || !String(name).trim()) {
        return res.status(400).json({ message: 'Name is required' });
      }
      const nameTrim = String(name).trim();
      const existing = await StandardizedTemplate.findOne({
        where: {
          isActive: true,
          name: { [Op.iLike]: nameTrim },
        },
      });
      if (existing) {
        return res.status(409).json({ message: 'A standardized format with this name already exists. Use a different name.' });
      }
      const pairs = Array.isArray(keyValuePairs) ? keyValuePairs : [];
      const sanitized = pairs.map((p) => ({
        key: String(p?.key ?? '').trim() || undefined,
        label: String(p?.label ?? p?.key ?? '').trim() || undefined,
      })).filter((p) => p.key);
      const row = await StandardizedTemplate.create({
        name: nameTrim,
        slug: slug ? String(slug).trim() || null : null,
        description: description ? String(description).trim() : null,
        keyValuePairs: sanitized,
        isActive: true,
      });
      res.status(201).json(row);
    } catch (error) {
      console.error('Create standardized template error:', error);
      res.status(500).json({ message: 'Error creating standardized template', error: error.message });
    }
  },

  update: async (req, res) => {
    try {
      const models = await initializeModels();
      const { StandardizedTemplate } = models;
      const row = await StandardizedTemplate.findOne({
        where: { id: req.params.id, isActive: true },
      });
      if (!row) {
        return res.status(404).json({ message: 'Standardized template not found' });
      }
      const { name, slug, description, keyValuePairs } = req.body;
      if (name !== undefined) {
        const nameTrim = String(name).trim() || row.name;
        if (nameTrim && nameTrim.toLowerCase() !== row.name.toLowerCase()) {
          const existing = await StandardizedTemplate.findOne({
            where: {
              isActive: true,
              id: { [Op.ne]: row.id },
              name: { [Op.iLike]: nameTrim },
            },
          });
          if (existing) {
            return res.status(409).json({ message: 'A standardized format with this name already exists. Use a different name.' });
          }
        }
        row.name = nameTrim || row.name;
      }
      if (slug !== undefined) row.slug = slug ? String(slug).trim() || null : null;
      if (description !== undefined) row.description = description ? String(description).trim() : null;
      if (Array.isArray(keyValuePairs)) {
        const sanitized = keyValuePairs.map((p) => ({
          key: String(p?.key ?? '').trim() || undefined,
          label: String(p?.label ?? p?.key ?? '').trim() || undefined,
        })).filter((p) => p.key);
        row.keyValuePairs = sanitized;
      }
      await row.save();
      res.json(row);
    } catch (error) {
      console.error('Update standardized template error:', error);
      res.status(500).json({ message: 'Error updating standardized template', error: error.message });
    }
  },
};

module.exports = standardizedTemplateController;
