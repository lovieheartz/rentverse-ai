'use strict';

const { PROPERTIES, PROPERTIES_BY_ID } = require('../data/properties');

/**
 * Query, projection and pagination logic for the property catalogue.
 *
 * Everything here is a pure function over the frozen catalogue, which keeps it unit
 * testable and means the controllers stay thin. Filtering and sorting moved server-side
 * from `Properties.jsx`, where it could only ever see the page the browser already had.
 */

const SORTERS = {
  newest: (a, b) => Date.parse(b.listedAt) - Date.parse(a.listedAt),
  priceAsc: (a, b) => a.price.usd - b.price.usd,
  priceDesc: (a, b) => b.price.usd - a.price.usd,
  roiDesc: (a, b) => b.metrics.totalAnnualReturnPct - a.metrics.totalAnnualReturnPct,
  fundingDesc: (a, b) => b.metrics.fundedPct - a.metrics.fundedPct,
};

/** Fields a free-text search scans. */
function searchHaystack(property) {
  return [
    property.title,
    property.location.label,
    property.location.city,
    property.location.state,
    property.type,
    ...property.features,
  ]
    .join(' ')
    .toLowerCase();
}

function matchesFilters(property, filters) {
  const {
    search,
    type,
    fundingStage,
    minPriceUsd,
    maxPriceUsd,
    minRoiPct,
    maxRoiPct,
    featured,
  } = filters;

  if (search && !searchHaystack(property).includes(search.toLowerCase())) return false;
  if (type && type !== 'all' && property.type !== type) return false;
  if (fundingStage && fundingStage !== 'all' && property.status.stage !== fundingStage) return false;
  if (minPriceUsd !== undefined && property.price.usd < minPriceUsd) return false;
  if (maxPriceUsd !== undefined && property.price.usd > maxPriceUsd) return false;
  if (minRoiPct !== undefined && property.metrics.totalAnnualReturnPct < minRoiPct) return false;
  if (maxRoiPct !== undefined && property.metrics.totalAnnualReturnPct > maxRoiPct) return false;
  if (featured !== undefined && property.featured !== featured) return false;

  return true;
}

/** Trimmed shape for grid/card rendering - keeps list responses small. */
function toSummary(property) {
  return {
    id: property.id,
    slug: property.slug,
    title: property.title,
    type: property.type,
    location: property.location,
    status: property.status,
    price: property.price,
    metrics: property.metrics,
    tokenDetails: {
      tokenPriceUsd: property.tokenDetails.tokenPriceUsd,
      totalTokens: property.tokenDetails.totalTokens,
      availableTokens: property.tokenDetails.availableTokens,
    },
    features: property.features.slice(0, 3),
    image: property.images[0],
    listedAt: property.listedAt,
    featured: property.featured,
  };
}

/** Full shape for the detail page. */
function toDetail(property) {
  return {
    ...property,
    location: { ...property.location },
    status: { ...property.status },
    price: { ...property.price },
    metrics: { ...property.metrics },
    financials: { ...property.financials, expenseRatios: { ...property.financials.expenseRatios } },
    tokenDetails: { ...property.tokenDetails },
    details: { ...property.details },
    features: [...property.features],
    images: [...property.images],
    advisor: { ...property.advisor },
  };
}

/**
 * Applies filters, sorting and pagination.
 *
 * @param {object} query Already validated by `schemas.listPropertiesQuery`.
 * @returns {{ items: Array<object>, pagination: object, appliedFilters: object }}
 */
function listProperties(query = {}) {
  const { sortBy = 'newest', page = 1, limit = 12, ...filters } = query;

  const matched = PROPERTIES.filter((property) => matchesFilters(property, filters));

  // Sort on a copy, with a stable id tiebreak so equal keys keep a deterministic order
  // across requests (otherwise pagination can show or skip the same item twice).
  const sorted = [...matched].sort((a, b) => {
    const primary = SORTERS[sortBy](a, b);
    return primary !== 0 ? primary : a.id.localeCompare(b.id);
  });

  const totalItems = sorted.length;
  const pageCount = Math.max(1, Math.ceil(totalItems / limit));
  // Clamp rather than 404: a filter change that shrinks the result set should not break
  // a client still holding the old page number.
  const currentPage = Math.min(page, pageCount);
  const offset = (currentPage - 1) * limit;

  return {
    items: sorted.slice(offset, offset + limit).map(toSummary),
    pagination: {
      page: currentPage,
      requestedPage: page,
      limit,
      pageCount,
      totalItems,
      catalogueSize: PROPERTIES.length,
      hasNextPage: currentPage < pageCount,
      hasPreviousPage: currentPage > 1,
    },
    appliedFilters: { sortBy, ...filters },
  };
}

/** @returns {object|null} The full property, or null when the id is unknown. */
function getPropertyById(id) {
  const property = PROPERTIES_BY_ID[id];
  return property ? toDetail(property) : null;
}

/** Raw frozen record - used internally where no copy is needed (e.g. AI fact extraction). */
function getRawPropertyById(id) {
  return PROPERTIES_BY_ID[id] || null;
}

function getFeaturedProperties(limit = 3) {
  return PROPERTIES.filter((property) => property.featured)
    .sort((a, b) => Date.parse(b.listedAt) - Date.parse(a.listedAt))
    .slice(0, limit)
    .map(toSummary);
}

module.exports = {
  listProperties,
  getPropertyById,
  getRawPropertyById,
  getFeaturedProperties,
  toSummary,
  toDetail,
  SORT_KEYS: Object.keys(SORTERS),
};
