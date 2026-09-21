'use strict';

const mongoose = require('mongoose');

const config = require('./env');

/**
 * Connects to MongoDB when `MONGO_URI` is configured.
 *
 * The original implementation had no `.catch()`, so a bad URI produced an unhandled
 * rejection and - via the process-level handler - killed the server on boot. A failed
 * connection is now logged and the process keeps running: only the legacy Mongo-backed
 * routes depend on it, and they answer 503 while it is down (see `requireDatabase`).
 *
 * Driver options `useNewUrlParser` / `useUnifiedTopology` were removed: they are no-ops
 * in the Mongoose 8 line this project depends on.
 */
function connectDatabase() {
  if (!config.mongoUri) {
    console.warn('[database] MONGO_URI is not set - skipping connection.');
    return Promise.resolve(null);
  }

  mongoose.connection.on('error', (error) => {
    console.error('[database] Connection error:', error.message);
  });
  mongoose.connection.on('disconnected', () => {
    console.warn('[database] Disconnected.');
  });

  return mongoose
    .connect(config.mongoUri, { serverSelectionTimeoutMS: 10000 })
    .then((connection) => {
      console.log(`[database] Connected to ${connection.connection.host}`);
      return connection;
    })
    .catch((error) => {
      console.error(`[database] Initial connection failed: ${error.message}`);
      return null;
    });
}

module.exports = connectDatabase;
