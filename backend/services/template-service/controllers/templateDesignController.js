const { Op } = require('sequelize');
const { initializeModels } = require('../../../shared/models');
const { getStaticUserId } = require('../../../shared/config/staticUser');

/**
 * Normalize boxes to layout-only (no key-value or content). Template design table holds only box pattern.
 */
function boxesToLayoutOnly(boxes) {
  if (!Array.isArray(boxes)) return [];
  return boxes.map((b) => {
    const out = {
      id: b.id || `box_${Date.now()}_${Math.random().toString(36).slice(2)}`,
      position: { x: Number(b.position?.x) || 0, y: Number(b.position?.y) || 0 },
      size: { width: Number(b.size?.width) || 100, height: Number(b.size?.height) || 20 },
      type: b.type || 'text',
      rank: b.rank ?? 0,
    };
    if (out.type === 'table' && b.tableConfig) out.tableConfig = b.tableConfig;
    return out;
  });
}

function normalizeDesignToLayoutOnly(design) {
  if (!design || typeof design !== 'object') return { pages: [{ boxes: [] }] };
  const pages = Array.isArray(design.pages) ? design.pages : [{ boxes: [] }];
  return {
    pages: pages.map((p, i) => ({
      pageNumber: p.pageNumber ?? i + 1,
      boxes: boxesToLayoutOnly(p.boxes),
    })),
  };
}

const templateDesignController = {
  list: async (req, res) => {
    try {
      const userId = getStaticUserId();
      const models = await initializeModels();
      const { TemplateDesign } = models;
      const list = await TemplateDesign.findAll({
        where: { userId },
        order: [['updatedAt', 'DESC']],
        attributes: ['id', 'name', 'standardizedTemplateId', 'design', 'settings', 'createdAt', 'updatedAt'],
      });
      res.json(list);
    } catch (error) {
      console.error('List template designs error:', error);
      res.status(500).json({ message: 'Error listing template designs', error: error.message });
    }
  },

  getById: async (req, res) => {
    try {
      const userId = getStaticUserId();
      const models = await initializeModels();
      const { TemplateDesign } = models;
      const row = await TemplateDesign.findOne({
        where: { id: req.params.id, userId },
      });
      if (!row) {
        return res.status(404).json({ message: 'Template design not found' });
      }
      res.json(row);
    } catch (error) {
      console.error('Get template design error:', error);
      res.status(500).json({ message: 'Error fetching template design', error: error.message });
    }
  },

  create: async (req, res) => {
    try {
      const userId = getStaticUserId();
      const models = await initializeModels();
      const { TemplateDesign } = models;
      const { name, standardizedTemplateId, design, settings } = req.body;
      if (!name || !name.trim()) {
        return res.status(400).json({ message: 'Design name is required' });
      }
      const nameTrim = name.trim();
      const existing = await TemplateDesign.findOne({
        where: {
          userId,
          name: { [Op.iLike]: nameTrim },
        },
      });
      if (existing) {
        return res.status(409).json({ message: 'A template design with this name already exists. Use a different name.' });
      }
      const designData = normalizeDesignToLayoutOnly(design);
      const row = await TemplateDesign.create({
        name: nameTrim,
        userId,
        standardizedTemplateId: standardizedTemplateId || null,
        design: designData,
        settings: settings || { pageSize: 'A4', orientation: 'portrait' },
      });
      res.status(201).json(row);
    } catch (error) {
      console.error('Create template design error:', error);
      res.status(500).json({ message: 'Error saving template design', error: error.message });
    }
  },

  update: async (req, res) => {
    try {
      const userId = getStaticUserId();
      const models = await initializeModels();
      const { TemplateDesign } = models;
      const row = await TemplateDesign.findOne({
        where: { id: req.params.id, userId },
      });
      if (!row) {
        return res.status(404).json({ message: 'Template design not found' });
      }
      const { name, design, settings, standardizedTemplateId } = req.body;
      if (name !== undefined) {
        const nameTrim = name.trim();
        if (nameTrim && nameTrim.toLowerCase() !== row.name.toLowerCase()) {
          const existing = await TemplateDesign.findOne({
            where: {
              userId,
              id: { [Op.ne]: row.id },
              name: { [Op.iLike]: nameTrim },
            },
          });
          if (existing) {
            return res.status(409).json({ message: 'A template design with this name already exists. Use a different name.' });
          }
        }
        row.name = nameTrim || row.name;
      }
      if (design !== undefined) row.design = normalizeDesignToLayoutOnly(design);
      if (settings !== undefined) row.settings = settings;
      if (standardizedTemplateId !== undefined) row.standardizedTemplateId = standardizedTemplateId || null;
      await row.save();
      res.json(row);
    } catch (error) {
      console.error('Update template design error:', error);
      res.status(500).json({ message: 'Error updating template design', error: error.message });
    }
  },

  delete: async (req, res) => {
    try {
      const userId = getStaticUserId();
      const models = await initializeModels();
      const { TemplateDesign } = models;
      const row = await TemplateDesign.findOne({
        where: { id: req.params.id, userId },
      });
      if (!row) {
        return res.status(404).json({ message: 'Template design not found' });
      }
      await row.destroy();
      res.json({ message: 'Template design deleted' });
    } catch (error) {
      console.error('Delete template design error:', error);
      res.status(500).json({ message: 'Error deleting template design', error: error.message });
    }
  },
};

module.exports = templateDesignController;
