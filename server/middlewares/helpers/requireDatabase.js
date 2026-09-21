'use strict';

const mongoose = require('mongoose');

const ApiError = require('../../utils/apiError');

/**
 * Guards the legacy Mongo-backed routers.
 *
 * `connectDatabase()` is opt-in (it only runs when `MONGO_URI` is configured), so on a
 * default checkout the original `/api/product`, `/api/order`, `/api/payment` and
 * `/api/user` routes have no connection behind them. Mongoose buffers those queries and
 * rejects after ~10 seconds, which surfaces to the caller as a hung request.
 *
 * Answering immediately with 503 is both faster and truthful.
 */
function requireDatabase(req, res, next) {
  // 1 === connected, 2 === connecting.
  if (mongoose.connection.readyState === 1) return next();

  return next(
    ApiError.serviceUnavailable(
      'DATABASE_UNAVAILABLE',
      'This endpoint requires the database, which is not connected. Set MONGO_URI to enable it.',
      { readyState: mongoose.connection.readyState }
    )
  );
}

module.exports = requireDatabase;
