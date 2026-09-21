'use strict';

const config = require('../../config/env');

/**
 * Request schemas for the property and AI endpoints, kept in one place so the
 * documented contract (docs/API.md) and the enforced contract cannot drift apart.
 */

// Derived from the provider catalogue, so adding a provider does not mean remembering to
// widen a second, separate allow-list here.
const PROVIDER_IDS = [...config.ai.providerIds];

const PROPERTY_TYPES = ['house', 'apartment', 'villa', 'commercial'];
const FUNDING_STAGES = ['new', 'active', 'almost_funded'];
const SORT_OPTIONS = ['newest', 'priceAsc', 'priceDesc', 'roiDesc', 'fundingDesc'];
const RISK_TOLERANCES = ['conservative', 'moderate', 'aggressive'];
const INVESTMENT_GOALS = ['income', 'appreciation', 'balanced'];

/** `GET /api/properties` */
const listPropertiesQuery = {
  search: { type: 'string', maxLength: 120 },
  type: { type: 'enum', values: ['all', ...PROPERTY_TYPES], default: 'all' },
  fundingStage: { type: 'enum', values: ['all', ...FUNDING_STAGES], default: 'all' },
  minPriceUsd: { type: 'number', min: 0, max: 1e12 },
  maxPriceUsd: { type: 'number', min: 0, max: 1e12 },
  minRoiPct: { type: 'number', min: 0, max: 100 },
  maxRoiPct: { type: 'number', min: 0, max: 100 },
  sortBy: { type: 'enum', values: SORT_OPTIONS, default: 'newest' },
  page: { type: 'integer', min: 1, max: 10000, default: 1 },
  limit: { type: 'integer', min: 1, max: 48, default: 12 },
  featured: { type: 'boolean' },
};

/** `GET /api/properties/:id` and `POST /api/ai/property-analysis` share this id format. */
const PROPERTY_ID_RULE = {
  type: 'string',
  required: true,
  maxLength: 40,
  pattern: /^[A-Za-z0-9_-]+$/,
  patternMessage: 'propertyId may only contain letters, numbers, hyphens and underscores.',
};

const propertyIdParams = {
  id: { ...PROPERTY_ID_RULE },
};

const featuredPropertiesQuery = {
  limit: { type: 'integer', min: 1, max: 12, default: 3 },
};

/**
 * `POST /api/ai/property-analysis`
 *
 * `investorProfile` is entirely optional - without it the model produces a general
 * analysis; with it, the suitability verdict is assessed against the investor's
 * stated budget, horizon, risk tolerance and goal.
 */
const INVESTOR_PROFILE_RULE = {
  type: 'object',
  fields: {
    budgetUsd: { type: 'number', min: 10, max: 10000000 },
    horizonYears: { type: 'integer', min: 1, max: 40 },
    riskTolerance: { type: 'enum', values: RISK_TOLERANCES },
    goal: { type: 'enum', values: INVESTMENT_GOALS },
  },
};

const propertyAnalysisBody = {
  propertyId: { ...PROPERTY_ID_RULE },
  refresh: { type: 'boolean', default: false },
  // Optional model override. Omitted means the configured primary provider.
  provider: { type: 'enum', values: PROVIDER_IDS },
  // Set false to pin the request to the named provider instead of failing over.
  failover: { type: 'boolean', default: true },
  investorProfile: { ...INVESTOR_PROFILE_RULE },
};

/**
 * `POST /api/ai/property-analysis/compare`
 *
 * `providers` is optional; omitting it compares everything currently configured.
 */
const propertyAnalysisCompareBody = {
  propertyId: { ...PROPERTY_ID_RULE },
  refresh: { type: 'boolean', default: false },
  providers: {
    type: 'array',
    maxItems: config.ai.maxCompareProviders,
    items: { type: 'enum', values: PROVIDER_IDS },
  },
  investorProfile: { ...INVESTOR_PROFILE_RULE },
};

module.exports = {
  PROPERTY_TYPES,
  FUNDING_STAGES,
  SORT_OPTIONS,
  RISK_TOLERANCES,
  INVESTMENT_GOALS,
  PROVIDER_IDS,
  listPropertiesQuery,
  featuredPropertiesQuery,
  propertyIdParams,
  propertyAnalysisBody,
  propertyAnalysisCompareBody,
};
