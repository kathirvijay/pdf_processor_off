const express = require('express');
const router = express.Router();
const standardizedTemplateController = require('../controllers/standardizedTemplateController');

router.get('/', standardizedTemplateController.list);
router.get('/:id', standardizedTemplateController.getById);
router.post('/', standardizedTemplateController.create);
router.put('/:id', standardizedTemplateController.update);

module.exports = router;
