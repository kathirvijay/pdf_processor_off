const express = require('express');
const router = express.Router();
const pdfController = require('../controllers/pdfController');
const uploadPdf = require('../middleware/uploadPdf');
const uploadHtml = require('../middleware/uploadHtml');

router.post('/generate', pdfController.generate);
router.post('/import-template', uploadPdf.single('file'), pdfController.importTemplate);
router.post('/import-html', uploadHtml.single('file'), pdfController.importHtml);

module.exports = router;
