'use strict';

const config = require('../../config/env');
const ApiError = require('../../utils/apiError');
const { sendError } = require('../../utils/apiResponse');

/**
 * Central error handling for the API.
 *
 * Before this existed, `asyncErrorHandler` forwarded rejections to `next()` and nothing
 * was registered to receive them: Express fell through to its default handler, which
 * returns an HTML stack trace in development and a bare 500 in production. Every failure
 * now produces the same JSON envelope, carrying the request id so a report can be matched
 * to a log line.
 *
 * Error shapes understood here:
 *   - `ApiError`                      - status, stable code and details, all preset;
 *   - legacy `ErrorHandler`           - has `statusCode`, used by the original controllers;
 *   - Mongoose `CastError` / `ValidationError` / duplicate key;
 *   - JWT `JsonWebTokenError` / `TokenExpiredError`;
 *   - malformed JSON bodies from `express.json()`;
 *   - anything else                   - 500, with the message withheld in production.
 */

function normaliseError(error) {
  if (error instanceof ApiError) return error;

  // express.json() sets `type: 'entity.parse.failed'` on malformed bodies.
  if (error && error.type === 'entity.parse.failed') {
    return ApiError.badRequest('Request body is not valid JSON.');
  }
  if (error && error.type === 'entity.too.large') {
    return new ApiError(413, 'PAYLOAD_TOO_LARGE', 'Request body is larger than the configured limit.');
  }

  if (error && error.name === 'CastError') {
    return ApiError.badRequest(`Invalid value for "${error.path}".`);
  }

  if (error && error.name === 'ValidationError' && error.errors) {
    return ApiError.validationFailed(
      Object.values(error.errors).map((detail) => ({
        field: detail.path,
        code: 'invalid_value',
        message: detail.message,
      }))
    );
  }

  if (error && error.code === 11000) {
    const fields = Object.keys(error.keyValue || {});
    return new ApiError(409, 'DUPLICATE_KEY', `Duplicate value for: ${fields.join(', ') || 'field'}.`);
  }

  if (error && (error.name === 'JsonWebTokenError' || error.name === 'TokenExpiredError')) {
    return new ApiError(401, 'INVALID_TOKEN', 'Authentication token is invalid or has expired.');
  }

  // Original controllers throw `ErrorHandler`, which only carries a status code.
  if (error && typeof error.statusCode === 'number') {
    const status = error.statusCode;
    return new ApiError(status, status >= 500 ? 'INTERNAL_ERROR' : 'REQUEST_FAILED', error.message, {
      cause: error,
    });
  }

  return ApiError.internal(error && error.message ? error.message : undefined, error);
}

/* eslint-disable-next-line no-unused-vars -- Express identifies error handlers by arity. */
function errorMiddleware(error, req, res, next) {
  const apiError = normaliseError(error);
  const isServerError = apiError.statusCode >= 500;

  // Only genuinely unexpected failures justify a stack trace. A deliberate 502/503 - an
  // unreachable provider, an unconfigured database - is an operational condition we
  // already describe precisely, and printing its stack on every request buries the real
  // ones. Client errors log a single line so a scripted 404 sweep cannot flood the log.
  const isUnexpected = isServerError && apiError.code === 'INTERNAL_ERROR';
  const location = `[${req.id || '-'}] ${req.method} ${req.originalUrl} -> ${apiError.statusCode} ${apiError.code}`;

  if (isUnexpected) {
    console.error(location, apiError.cause || apiError);
  } else if (!config.isTest) {
    const log = isServerError ? console.error : console.warn;
    log(`${location}: ${apiError.message}`);
  }

  // Never surface an internal message to a client in production.
  const message =
    isServerError && config.isProduction
      ? 'An unexpected error occurred. Please try again.'
      : apiError.message;

  return sendError(res, {
    status: apiError.statusCode,
    code: apiError.code,
    message,
    details: apiError.details,
  });
}

module.exports = { errorMiddleware, normaliseError };
