'use strict';

/**
 * Application error carrying everything the HTTP layer needs to build a response:
 * a status code, a stable machine-readable `code`, and optional structured `details`.
 *
 * `ErrorHandler` (server/utils/errorHandler.js) remains the legacy error type used by
 * the original controllers; the central error middleware understands both.
 */
class ApiError extends Error {
  /**
   * @param {number} statusCode HTTP status to send.
   * @param {string} code Stable identifier clients can branch on, e.g. `VALIDATION_FAILED`.
   * @param {string} message Human-readable summary. Safe to show to end users.
   * @param {object} [options]
   * @param {Array<object>|object} [options.details] Machine-readable specifics (field errors, etc.).
   * @param {Error} [options.cause] Underlying error, kept for logs only - never serialised.
   */
  constructor(statusCode, code, message, { details, cause } = {}) {
    super(message);
    this.name = 'ApiError';
    this.statusCode = statusCode;
    this.code = code;
    if (details !== undefined) this.details = details;
    if (cause !== undefined) this.cause = cause;

    // `expose` marks errors whose message is safe for clients. 5xx messages are
    // replaced with a generic string in production to avoid leaking internals.
    this.expose = statusCode < 500;

    Error.captureStackTrace(this, this.constructor);
  }

  static badRequest(message, details) {
    return new ApiError(400, 'BAD_REQUEST', message, { details });
  }

  static validationFailed(details, message = 'One or more request parameters are invalid.') {
    return new ApiError(400, 'VALIDATION_FAILED', message, { details });
  }

  static notFound(message = 'Resource not found.', details) {
    return new ApiError(404, 'NOT_FOUND', message, { details });
  }

  static tooManyRequests(message, details) {
    return new ApiError(429, 'RATE_LIMIT_EXCEEDED', message, { details });
  }

  static serviceUnavailable(code, message, details) {
    return new ApiError(503, code, message, { details });
  }

  static upstreamFailure(code, message, details) {
    return new ApiError(502, code, message, { details });
  }

  static internal(message = 'An unexpected error occurred.', cause) {
    return new ApiError(500, 'INTERNAL_ERROR', message, { cause });
  }
}

module.exports = ApiError;
