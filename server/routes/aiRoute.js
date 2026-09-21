'use strict';

const express = require('express');

const config = require('../config/env');
const {
  analyseProperty,
  compareProviders,
  listProviders,
  getAiStatus,
} = require('../controllers/aiController');
const { validateBody } = require('../middlewares/validator/validateRequest');
const {
  propertyAnalysisBody,
  propertyAnalysisCompareBody,
} = require('../middlewares/validator/schemas');
const createRateLimiter = require('../middlewares/helpers/rateLimiter');

const router = express.Router();

// Each analysis is a paid upstream call, so these endpoints are rate limited per client.
const analysisRateLimiter = createRateLimiter({
  windowMs: config.ai.rateLimit.windowMs,
  max: config.ai.rateLimit.max,
  message: 'Too many analysis requests from this client. Please wait before trying again.',
});

// Comparison fans out to several providers at once, so it gets a tighter budget.
const compareRateLimiter = createRateLimiter({
  windowMs: config.ai.rateLimit.windowMs,
  max: config.ai.rateLimit.compareMax,
  message: 'Too many model-comparison requests from this client. Please wait before trying again.',
});

router.get('/status', getAiStatus);
router.get('/providers', listProviders);

// Declared before the bare path so it is not shadowed by it.
router.post(
  '/property-analysis/compare',
  compareRateLimiter,
  validateBody(propertyAnalysisCompareBody),
  compareProviders
);
router.post('/property-analysis', analysisRateLimiter, validateBody(propertyAnalysisBody), analyseProperty);

module.exports = router;
