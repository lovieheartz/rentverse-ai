'use strict';

/**
 * Every JSON response from the routes added in this change uses one of two envelopes,
 * so clients can branch on `success` without special-casing each endpoint:
 *
 *   success: { success: true,  data: <payload>, meta: { requestId, timestamp, durationMs, ... } }
 *   failure: { success: false, error: { code, message, details? }, meta: { requestId, ... } }
 *
 * The original controllers return bare `{ success, products }` shapes; those are left
 * untouched so existing consumers keep working.
 */

/** Builds the `meta` block shared by both envelopes. */
function buildMeta(req, extra) {
  const meta = {
    requestId: req && req.id ? req.id : undefined,
    timestamp: new Date().toISOString(),
  };

  if (req && typeof req.startedAt === 'number') {
    meta.durationMs = Math.max(0, Date.now() - req.startedAt);
  }

  if (extra && typeof extra === 'object') Object.assign(meta, extra);

  // Drop undefined keys so the payload stays clean.
  for (const key of Object.keys(meta)) {
    if (meta[key] === undefined) delete meta[key];
  }

  return meta;
}

/**
 * Sends a success envelope.
 * @param {import('express').Response} res
 * @param {*} data Response payload.
 * @param {object} [options]
 * @param {number} [options.status=200]
 * @param {object} [options.meta] Extra fields merged into `meta`.
 */
function sendSuccess(res, data, { status = 200, meta } = {}) {
  return res.status(status).json({
    success: true,
    data,
    meta: buildMeta(res.req, meta),
  });
}

/**
 * Sends a failure envelope.
 * @param {import('express').Response} res
 * @param {object} error
 * @param {number} error.status HTTP status code.
 * @param {string} error.code Stable machine-readable code.
 * @param {string} error.message Human-readable summary.
 * @param {*} [error.details] Machine-readable specifics.
 * @param {object} [options]
 * @param {object} [options.meta]
 */
function sendError(res, { status, code, message, details }, { meta } = {}) {
  const body = {
    success: false,
    error: { code, message },
    meta: buildMeta(res.req, meta),
  };

  if (details !== undefined) body.error.details = details;

  return res.status(status).json(body);
}

module.exports = { sendSuccess, sendError, buildMeta };
