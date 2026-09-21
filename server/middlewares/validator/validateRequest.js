'use strict';

const { validate } = require('./requestValidator');
const ApiError = require('../../utils/apiError');

/**
 * Express middleware factories that validate a request part against a schema.
 *
 * Validated output is written to `req.validated.{query,body,params}` rather than
 * over `req.query` / `req.params`: those are prototype getters in Express, and
 * reassigning them is a known portability trap. Controllers read `req.validated`,
 * which is guaranteed to be coerced, defaulted and range-checked.
 *
 * All failures for a request part are reported together, so a form can highlight
 * every bad field in one round trip instead of one per submit.
 */

function ensureContainer(req) {
  if (!req.validated) req.validated = {};
  return req.validated;
}

function createValidator(part, schema, { allowUnknown = false } = {}) {
  return function validationMiddleware(req, res, next) {
    const { value, errors } = validate(schema, req[part], { allowUnknown });

    if (errors.length > 0) {
      return next(
        ApiError.validationFailed(
          errors,
          `Invalid request ${part}: ${errors.length} problem${errors.length === 1 ? '' : 's'} found.`
        )
      );
    }

    ensureContainer(req)[part] = value;
    return next();
  };
}

const validateQuery = (schema, options) => createValidator('query', schema, options);
const validateBody = (schema, options) => createValidator('body', schema, options);
const validateParams = (schema, options) => createValidator('params', schema, options);

module.exports = { validateQuery, validateBody, validateParams };
