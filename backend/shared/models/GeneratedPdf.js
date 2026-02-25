const { DataTypes } = require('sequelize');

/**
 * Same schema as pdf_processor; userId is required (static user for pdf_processor_o).
 */
const initGeneratedPdfModel = (sequelize) => {
  const GeneratedPdf = sequelize.define('GeneratedPdf', {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    templateId: {
      type: DataTypes.UUID,
      allowNull: false,
      field: 'template_id',
      references: { model: 'templates', key: 'id' },
    },
    userId: {
      type: DataTypes.UUID,
      allowNull: false,
      field: 'user_id',
      references: { model: 'users', key: 'id' },
    },
    fileName: {
      type: DataTypes.STRING,
      allowNull: false,
      field: 'file_name',
    },
    filePath: {
      type: DataTypes.TEXT,
      allowNull: false,
      field: 'file_path',
    },
    fileSize: {
      type: DataTypes.BIGINT,
      allowNull: true,
      field: 'file_size',
    },
    dataUsed: {
      type: DataTypes.JSONB,
      allowNull: true,
      field: 'data_used',
    },
    createdAt: {
      type: DataTypes.DATE,
      defaultValue: DataTypes.NOW,
      field: 'created_at',
    },
  }, {
    tableName: 'generated_pdfs',
    timestamps: false,
  });

  return GeneratedPdf;
};

module.exports = initGeneratedPdfModel;
