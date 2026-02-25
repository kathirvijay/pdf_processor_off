const express = require('express');
const router = express.Router();
const templateController = require('../controllers/templateController');

router.get('/library', templateController.getLibrary);
router.get('/list', templateController.getTemplates);
router.get('/:id', templateController.getTemplateById);
router.post('/', templateController.createTemplate);
router.put('/:id', templateController.updateTemplate);
router.delete('/:id', templateController.deleteTemplate);

module.exports = router;
