'use strict';

const express = require('express');
const mongoose = require('mongoose');

const config = require('../config/env');
const { sendSuccess } = require('../utils/apiResponse');
const { PROPERTIES } = require('../data/properties');
const { describeProvider } = require('../ai/analysisService');

const router = express.Router();

const DB_STATES = ['disconnected', 'connected', 'connecting', 'disconnecting'];

/**
 * `GET /api/health`
 *
 * Reports what is actually wired up, so a reviewer or a deployment probe can tell the
 * difference between "the catalogue is served from memory and the AI is in sample mode"
 * and "something is misconfigured" - without reading the source or making a paid call.
 */
router.get('/', (req, res) => {
  const ai = describeProvider();

  return sendSuccess(res, {
    status: 'ok',
    environment: config.nodeEnv,
    uptimeSeconds: Math.round(process.uptime()),
    catalogue: { source: 'in-memory', propertyCount: PROPERTIES.length },
    database: {
      configured: Boolean(config.mongoUri),
      state: DB_STATES[mongoose.connection.readyState] || 'unknown',
    },
    ai,
    configWarnings: config.warnings,
  });
});

module.exports = router;
