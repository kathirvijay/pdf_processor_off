const express = require('express');
const router = express.Router();
const templateDesignController = require('../controllers/templateDesignController');

router.get('/', templateDesignController.list);
router.get('/:id', templateDesignController.getById);
router.post('/', templateDesignController.create);
router.put('/:id', templateDesignController.update);
router.delete('/:id', templateDesignController.delete);

module.exports = router;
