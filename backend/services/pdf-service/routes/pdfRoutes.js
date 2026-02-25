const express = require('express');
const router = express.Router();
const pdfController = require('../controllers/pdfController');
const uploadPdf = require('../middleware/uploadPdf');

router.post('/generate', pdfController.generate);
router.post('/import-template', uploadPdf.single('file'), pdfController.importTemplate);

module.exports = router;
