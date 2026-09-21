'use strict';

const ApiError = require('../../utils/apiError');

/**
 * Fixed-window rate limiter, scoped to a single process.
 *
 * Applied to the AI endpoint, where each request costs real money and takes seconds of
 * upstream capacity - without a limit, one tab on a refresh loop is an open invoice.
 *
 * Limitation, stated plainly: counters live in memory, so behind N instances the
 * effective limit is N x max. Move the counter to Redis before running more than one
 * process. This is sized to stop accidental abuse, not a determined attacker.
 */

function defaultKeyGenerator(req) {
  // `req.ip` honours `trust proxy` when the app sets it.
  return req.ip || req.connection?.remoteAddress || 'unknown';
}

/**
 * @param {object} options
 * @param {number} options.windowMs Window length in milliseconds.
 * @param {number} options.max Requests allowed per key per window.
 * @param {function} [options.keyGenerator]
 * @param {string} [options.message]
 */
function createRateLimiter({ windowMs, max, keyGenerator = defaultKeyGenerator, message }) {
  const hits = new Map();

  // Drop expired windows periodically so the map cannot grow without bound.
  // `unref()` keeps the timer from holding the event loop open in tests.
  const sweeper = setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of hits) {
      if (entry.resetAt <= now) hits.delete(key);
    }
  }, windowMs);
  if (typeof sweeper.unref === 'function') sweeper.unref();

  function rateLimiter(req, res, next) {
    const key = keyGenerator(req);
    const now = Date.now();
    let entry = hits.get(key);

    if (!entry || entry.resetAt <= now) {
      entry = { count: 0, resetAt: now + windowMs };
      hits.set(key, entry);
    }

    entry.count += 1;

    const remaining = Math.max(0, max - entry.count);
    const resetSeconds = Math.ceil((entry.resetAt - now) / 1000);

    res.setHeader('X-RateLimit-Limit', String(max));
    res.setHeader('X-RateLimit-Remaining', String(remaining));
    res.setHeader('X-RateLimit-Reset', String(resetSeconds));

    if (entry.count > max) {
      res.setHeader('Retry-After', String(resetSeconds));
      return next(
        ApiError.tooManyRequests(
          message || `Too many requests. Try again in ${resetSeconds} second(s).`,
          { limit: max, windowMs, retryAfterSeconds: resetSeconds }
        )
      );
    }

    return next();
  }

  rateLimiter.reset = () => hits.clear();
  rateLimiter.stop = () => clearInterval(sweeper);

  return rateLimiter;
}

module.exports = createRateLimiter;
