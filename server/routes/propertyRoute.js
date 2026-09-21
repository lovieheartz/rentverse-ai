'use strict';

const express = require('express');

const {
  listProperties,
  listFeaturedProperties,
  getPropertyDetails,
} = require('../controllers/propertyController');
const { validateQuery, validateParams } = require('../middlewares/validator/validateRequest');
const {
  listPropertiesQuery,
  featuredPropertiesQuery,
  propertyIdParams,
} = require('../middlewares/validator/schemas');

const router = express.Router();

// `/featured` is declared before `/:id` so it is not captured as an id.
router.get('/featured', validateQuery(featuredPropertiesQuery), listFeaturedProperties);
router.get('/', validateQuery(listPropertiesQuery), listProperties);
router.get('/:id', validateParams(propertyIdParams), validateQuery({}), getPropertyDetails);

module.exports = router;
