const express = require('express');
const router = express.Router();
const upload = require('../middleware/upload');
const csvController = require('../controllers/csvController');

router.post('/import-structure', upload.single('file'), csvController.importStructure);
router.post('/validate', upload.single('file'), csvController.validate);

module.exports = router;
