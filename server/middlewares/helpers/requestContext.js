'use strict';

const { randomUUID } = require('crypto');

/**
 * Attaches a correlation id and a start timestamp to every request.
 *
 * The id is echoed in the `X-Request-Id` response header and in every response
 * envelope's `meta.requestId`, so a user-reported failure can be matched to the
 * exact server log line. An inbound `X-Request-Id` is honoured (after sanitising)
 * to keep traces intact when a gateway or the browser already assigned one.
 */

const MAX_INBOUND_ID_LENGTH = 64;
const SAFE_ID = /^[A-Za-z0-9._-]+$/;

function requestContext(req, res, next) {
  const inbound = req.get('X-Request-Id');

  req.id =
    typeof inbound === 'string' && inbound.length <= MAX_INBOUND_ID_LENGTH && SAFE_ID.test(inbound)
      ? inbound
      : randomUUID();

  req.startedAt = Date.now();
  res.setHeader('X-Request-Id', req.id);

  next();
}

module.exports = requestContext;
