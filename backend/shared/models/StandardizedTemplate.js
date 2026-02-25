const { DataTypes } = require('sequelize');

/**
 * Predefined template formats (e.g. Bill of Lading) with a fixed set of allowed key-value variables.
 * key_value_pairs: array of { key: string, label: string }.
 */
const initStandardizedTemplateModel = (sequelize) => {
  const StandardizedTemplate = sequelize.define('StandardizedTemplate', {
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
    slug: {
      type: DataTypes.STRING,
      allowNull: true,
      unique: true,
    },
    description: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
    keyValuePairs: {
      type: DataTypes.JSONB,
      allowNull: false,
      defaultValue: [],
      field: 'key_value_pairs',
      comment: 'Array of { key, label } - only these keys are allowed when using this standardized template',
    },
    isActive: {
      type: DataTypes.BOOLEAN,
      defaultValue: true,
      field: 'is_active',
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
    tableName: 'standardized_templates',
    hooks: {
      beforeUpdate: (row) => {
        row.updatedAt = new Date();
      },
    },
  });

  return StandardizedTemplate;
};

module.exports = initStandardizedTemplateModel;
