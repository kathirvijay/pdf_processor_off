const { DataTypes } = require('sequelize');

/**
 * Same schema as pdf_processor so we use the same database tables.
 * userId is required; pdf_processor_o uses STATIC_USER_ID for all operations.
 */
const initTemplateModel = (sequelize) => {
  const Template = sequelize.define('Template', {
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
    documentName: {
      type: DataTypes.STRING,
      allowNull: true,
      field: 'document_name',
    },
    description: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
    userId: {
      type: DataTypes.UUID,
      allowNull: false,
      field: 'user_id',
      references: { model: 'users', key: 'id' },
    },
    isPublic: {
      type: DataTypes.BOOLEAN,
      defaultValue: false,
      field: 'is_public',
    },
    category: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    standardizedTemplateId: {
      type: DataTypes.UUID,
      allowNull: true,
      field: 'standardized_template_id',
      references: { model: 'standardized_templates', key: 'id' },
    },
    settings: {
      type: DataTypes.JSONB,
      allowNull: false,
      defaultValue: {
        orientation: 'portrait',
        pageSize: 'A4',
        margins: { top: 20, bottom: 20, left: 20, right: 20 },
        title: '',
      },
    },
    pages: {
      type: DataTypes.JSONB,
      allowNull: false,
      defaultValue: [],
    },
    templateKeyValue: {
      type: DataTypes.JSONB,
      allowNull: true,
      field: 'template_key_value',
      comment: 'Extracted parameters as key-value JSON, e.g. { "field_1": "{{field_1}}", "shipper": "{{shipper}}" }',
    },
    version: {
      type: DataTypes.STRING,
      allowNull: true,
      defaultValue: '1.0',
    },
    parentTemplateId: {
      type: DataTypes.UUID,
      allowNull: true,
      field: 'parent_template_id',
      references: { model: 'templates', key: 'id' },
    },
    isActive: {
      type: DataTypes.BOOLEAN,
      defaultValue: true,
      field: 'is_active',
    },
    versionNotes: {
      type: DataTypes.TEXT,
      allowNull: true,
      field: 'version_notes',
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
    tableName: 'templates',
    hooks: {
      beforeUpdate: (template) => {
        template.updatedAt = new Date();
      },
    },
  });

  return Template;
};

module.exports = initTemplateModel;
