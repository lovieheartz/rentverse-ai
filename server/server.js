'use strict';

// Loaded first: every other module reads configuration from here, and the loader is
// responsible for reading server/config/.config.env before anything else runs.
const config = require('./config/env');

const cloudinary = require('cloudinary');

const app = require('./app');
const connectDatabase = require('./config/database');

/**
 * Process entry point.
 *
 * Changes from the original: configuration is loaded before anything reads it, startup
 * warnings are printed once, the database connection is opt-in rather than commented
 * out, and the process shuts down cleanly instead of calling `process.exit(1)` from an
 * uncaught-exception handler that ran before any logging existed.
 */

for (const warning of config.warnings) {
  console.warn(`[config] ${warning}`);
}

if (config.mongoUri) {
  connectDatabase();
} else {
  console.warn(
    '[startup] MONGO_URI is not set - the legacy /api/product, /api/order, /api/payment and ' +
      '/api/user routes will answer 503. The property catalogue and AI endpoints do not need it.'
  );
}

if (config.cloudinary.name) {
  cloudinary.config({
    cloud_name: config.cloudinary.name,
    api_key: config.cloudinary.apiKey,
    api_secret: config.cloudinary.apiSecret,
  });
}

const server = app.listen(config.port, () => {
  console.log(`[startup] RentVerse API listening on http://localhost:${config.port} (${config.nodeEnv})`);
  console.log(
    `[startup] AI provider: ${config.ai.provider}` +
      (config.ai.provider === 'anthropic'
        ? ` (${config.ai.model})`
        : ' (deterministic sample - set ANTHROPIC_API_KEY for model-generated analysis)')
  );
});

function shutdown(signal) {
  console.log(`[shutdown] ${signal} received, closing server.`);
  server.close(() => process.exit(0));

  // Do not hang forever on in-flight requests.
  setTimeout(() => process.exit(1), 10000).unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

process.on('unhandledRejection', (reason) => {
  console.error('[fatal] Unhandled promise rejection:', reason);
  shutdown('unhandledRejection');
});

process.on('uncaughtException', (error) => {
  // The process state is unknown after an uncaught exception; log fully, then exit.
  console.error('[fatal] Uncaught exception:', error);
  process.exit(1);
});

module.exports = server;
