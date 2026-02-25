const { DataTypes } = require('sequelize');

/**
 * Saved layout/design (boxes, positions, sizes) without data binding.
 * User can load a design onto the canvas then map standardized key-value pairs to boxes.
 */
const initTemplateDesignModel = (sequelize) => {
  const TemplateDesign = sequelize.define('TemplateDesign', {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    name: {
      type: DataTypes.STRING,
      allowNull: false,
      validate: { notEmpty: true },
    },
    userId: {
      type: DataTypes.UUID,
      allowNull: false,
      field: 'user_id',
      references: { model: 'users', key: 'id' },
    },
    standardizedTemplateId: {
      type: DataTypes.UUID,
      allowNull: true,
      field: 'standardized_template_id',
      references: { model: 'standardized_templates', key: 'id' },
    },
    design: {
      type: DataTypes.JSONB,
      allowNull: false,
      defaultValue: { pages: [{ boxes: [] }] },
      comment: 'Layout only: pages[].boxes with id, position, size, type, rank (and tableConfig if table). No key-value or content.',
    },
    settings: {
      type: DataTypes.JSONB,
      allowNull: true,
      defaultValue: { pageSize: 'A4', orientation: 'portrait' },
    },
    createdAt: {
      type: DataTypes.DATE,
      defaultValue: DataTypes.NOW,
      field: 'created_at',
    },
    updatedAt: {
      type: DataTypes.DATE,
      defaultValue: DataTypes.NOW,
      field: 'updated_at',
    },
  }, {
    tableName: 'template_designs',
    hooks: {
      beforeUpdate: (row) => {
        row.updatedAt = new Date();
      },
    },
  });

  return TemplateDesign;
};

module.exports = initTemplateDesignModel;
