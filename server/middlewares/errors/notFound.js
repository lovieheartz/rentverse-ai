'use strict';

const ApiError = require('../../utils/apiError');

/**
 * Terminal handler for unmatched `/api/*` paths.
 *
 * Without it an unknown API path falls through to the SPA/static handler and returns
 * HTML, which a `fetch()` caller then fails to parse - producing a confusing client-side
 * error instead of a clear 404.
 */
function apiNotFound(req, res, next) {
  next(ApiError.notFound(`No API route matches ${req.method} ${req.originalUrl}.`));
}

module.exports = apiNotFound;
