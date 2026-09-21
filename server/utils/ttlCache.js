'use strict';

/**
 * Minimal in-process TTL cache with a bounded size and LRU-ish eviction.
 *
 * Used to avoid paying for an identical model call twice - the same property and the same
 * investor profile produce the same analysis, and users re-open a listing far more often
 * than they change their inputs.
 *
 * Scope is deliberately one process. With multiple server instances each keeps its own
 * copy, which is acceptable for a cache (a miss is only a cost, never a correctness
 * problem) but would need Redis or similar to be effective at scale.
 */
class TtlCache {
  /**
   * @param {object} [options]
   * @param {number} [options.ttlMs=600000] Entry lifetime. `0` disables caching entirely.
   * @param {number} [options.maxEntries=200] Hard cap on retained entries.
   */
  constructor({ ttlMs = 10 * 60 * 1000, maxEntries = 200 } = {}) {
    this.ttlMs = ttlMs;
    this.maxEntries = maxEntries;
    this.store = new Map();
  }

  get(key) {
    if (this.ttlMs <= 0) return undefined;

    const entry = this.store.get(key);
    if (!entry) return undefined;

    if (entry.expiresAt <= Date.now()) {
      this.store.delete(key);
      return undefined;
    }

    // Re-insert so Map iteration order approximates least-recently-used.
    this.store.delete(key);
    this.store.set(key, entry);
    return entry.value;
  }

  set(key, value) {
    if (this.ttlMs <= 0) return value;

    if (this.store.has(key)) this.store.delete(key);
    this.store.set(key, { value, expiresAt: Date.now() + this.ttlMs, storedAt: Date.now() });

    // Evict the oldest entries, and any that have already expired.
    while (this.store.size > this.maxEntries) {
      const oldestKey = this.store.keys().next().value;
      this.store.delete(oldestKey);
    }

    return value;
  }

  /** @returns {number|undefined} Age in ms of a live entry, for response metadata. */
  ageOf(key) {
    const entry = this.store.get(key);
    if (!entry || entry.expiresAt <= Date.now()) return undefined;
    return Date.now() - entry.storedAt;
  }

  delete(key) {
    return this.store.delete(key);
  }

  clear() {
    this.store.clear();
  }

  get size() {
    return this.store.size;
  }
}

module.exports = TtlCache;
