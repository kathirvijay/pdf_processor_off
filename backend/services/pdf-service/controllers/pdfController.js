const { initializeModels } = require('../../../shared/models');
const { getStaticUserId } = require('../../../shared/config/staticUser');
const { generatePdf } = require('../utils/pdfGenerator');
const { generatePdfPuppeteer } = require('../utils/pdfGeneratorPuppeteer');
const { pdfToTemplate } = require('../utils/pdfToTemplate');
const { extractTemplateNameFromHtml } = require('../utils/htmlImport');
const path = require('path');
const fs = require('fs');

const uploadsDir = path.join(__dirname, '../../../uploads/pdfs');

const pdfController = {
  importTemplate: async (req, res) => {
    try {
      if (!req.file || !req.file.path) {
        return res.status(400).json({ message: 'PDF file is required' });
      }
      const pdfPath = path.isAbsolute(req.file.path) ? req.file.path : path.resolve(process.cwd(), req.file.path);
      const result = await pdfToTemplate(pdfPath);
      if (result.message && (!result.boxes || result.boxes.length === 0)) {
        return res.status(200).json({
          message: result.message,
          boxes: [],
          templateName: result.templateName,
          pageSize: result.pageSize,
          orientation: result.orientation,
        });
      }
      res.json({
        message: 'PDF template imported successfully',
        boxes: result.boxes,
        templateName: result.templateName,
        pageSize: result.pageSize,
        orientation: result.orientation,
      });
    } catch (error) {
      console.error('Import PDF template error:', error);
      res.status(500).json({
        message: error.message || 'Error converting PDF to template',
        error: error.message,
      });
    }
  },

  importHtml: async (req, res) => {
    let filePath = null;
    try {
      if (!req.file || !req.file.path) {
        return res.status(400).json({ message: 'HTML file is required' });
      }
      filePath = path.isAbsolute(req.file.path) ? req.file.path : path.resolve(process.cwd(), req.file.path);
      const htmlContent = fs.readFileSync(filePath, 'utf8');
      try {
        fs.unlinkSync(filePath);
      } catch (_) {
        /* ignore */
      }
      filePath = null;
      const stem = String(req.file.originalname || 'template').replace(/\.(html?|htm)$/i, '');
      const templateName = extractTemplateNameFromHtml(htmlContent, stem);
      res.json({
        message: 'HTML imported successfully',
        htmlContent,
        templateName,
      });
    } catch (error) {
      if (filePath) {
        try {
          fs.unlinkSync(filePath);
        } catch (_) {
          /* ignore */
        }
      }
      console.error('Import HTML error:', error);
      res.status(500).json({
        message: error.message || 'Error reading HTML file',
        error: error.message,
      });
    }
  },

  generate: async (req, res) => {
    try {
      const userId = getStaticUserId();
      const templateId = req.body.templateId || req.query.templateId;
      const rawData = req.body.data !== undefined ? req.body.data : req.body;
      const data = rawData && typeof rawData === 'object' && !Array.isArray(rawData) ? rawData : {};

      if (!templateId) {
        return res.status(400).json({ message: 'Template ID is required' });
      }

      const models = await initializeModels();
      const { Template, GeneratedPdf } = models;

      const template = await Template.findOne({
        where: {
          id: templateId,
          userId,
        },
      });
      if (!template) {
        return res.status(404).json({ message: 'Template not found' });
      }

      if (!fs.existsSync(uploadsDir)) {
        fs.mkdirSync(uploadsDir, { recursive: true });
      }

      let settings = template.settings;
      if (settings != null && typeof settings === 'string') {
        try {
          settings = JSON.parse(settings);
        } catch (_) {
          settings = {};
        }
      }
      if (!settings || typeof settings !== 'object') settings = {};

      let pages = template.pages;
      if (pages != null && typeof pages === 'string') {
        try {
          pages = JSON.parse(pages);
        } catch (_) {
          pages = [];
        }
      }
      pages = Array.isArray(pages) ? pages : (pages != null ? [pages] : []);
      if (pages.length === 0) {
        return res.status(400).json({ message: 'Template has no pages', error: 'Template has no pages' });
      }

      const templatePlain = {
        id: template.id,
        name: template.name,
        settings,
        pages,
      };

      const usePuppeteer = process.env.USE_PUPPETEER_PDF !== '0';
      const result = usePuppeteer
        ? await generatePdfPuppeteer(templatePlain, data, uploadsDir)
        : await generatePdf(templatePlain, data, uploadsDir);
      if (!result || typeof result !== 'object') {
        throw new Error('PDF generation did not return file info');
      }
      const { filename, filepath, fileSize } = result;

      try {
        await GeneratedPdf.create({
          templateId: template.id,
          userId,
          fileName: filename,
          filePath: filepath,
          fileSize: fileSize,
          dataUsed: data,
        });
      } catch (createErr) {
        console.error('GeneratedPdf.create error (PDF was generated):', createErr);
      }

      if (!fs.existsSync(filepath)) {
        return res.status(500).json({ message: 'Generated file not found' });
      }
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      res.sendFile(filepath, (err) => {
        if (err && !res.headersSent) {
          res.status(500).json({ message: 'Error sending PDF', error: err.message });
        }
      });
    } catch (error) {
      console.error('Generate PDF error:', error);
      const message = error.message || 'Error generating PDF';
      const status = message === 'Template has no pages' ? 400 : 500;
      const body = { message, error: message };
      if (process.env.NODE_ENV !== 'production' && error.stack) body.stack = error.stack;
      res.status(status).json(body);
    }
  },
};

module.exports = pdfController;
