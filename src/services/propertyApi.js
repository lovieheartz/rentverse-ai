import { apiRequest, toQueryString } from './apiClient';

/**
 * Property catalogue endpoints.
 *
 * Filtering, sorting and pagination all happen server-side; the UI sends its filter state
 * and renders what comes back. Previously each page held its own copy of the listings and
 * filtered in the browser, which is why the same id showed a different property depending
 * on which page you came from.
 */

/**
 * @param {object} [filters] search, type, fundingStage, minPriceUsd, maxPriceUsd,
 *   minRoiPct, maxRoiPct, sortBy, page, limit, featured.
 * @param {AbortSignal} [signal]
 */
export function fetchProperties(filters = {}, signal) {
  return apiRequest(`/api/properties${toQueryString(filters)}`, { signal });
}

export function fetchFeaturedProperties(limit = 3, signal) {
  return apiRequest(`/api/properties/featured${toQueryString({ limit })}`, { signal });
}

export function fetchProperty(id, signal) {
  return apiRequest(`/api/properties/${encodeURIComponent(id)}`, { signal });
}
