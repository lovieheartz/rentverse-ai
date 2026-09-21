import { apiRequest } from './apiClient';

/**
 * AI endpoints.
 *
 * Model calls take seconds, not milliseconds, so these use a much longer timeout than the
 * catalogue calls - and comparison, which fans out to several providers at once, longer
 * still.
 */

const ANALYSIS_TIMEOUT_MS = 120000;
const COMPARISON_TIMEOUT_MS = 180000;

/** Strips empty fields so the server sees an absent profile rather than an invalid one. */
function cleanInvestorProfile(profile) {
  if (!profile) return undefined;

  const cleaned = Object.entries(profile).reduce((accumulator, [key, value]) => {
    if (value === undefined || value === null || value === '') return accumulator;
    accumulator[key] = value;
    return accumulator;
  }, {});

  return Object.keys(cleaned).length > 0 ? cleaned : undefined;
}

/**
 * Requests an investment analysis for one listing.
 *
 * @param {object} input
 * @param {string} input.propertyId
 * @param {object} [input.investorProfile]
 * @param {string} [input.provider] Provider id; omit to use the server's primary.
 * @param {boolean} [input.refresh] Bypass the server-side cache.
 * @param {AbortSignal} [signal]
 */
export function requestPropertyAnalysis({ propertyId, investorProfile, provider, refresh }, signal) {
  return apiRequest('/api/ai/property-analysis', {
    method: 'POST',
    body: {
      propertyId,
      ...(provider ? { provider } : {}),
      ...(refresh ? { refresh: true } : {}),
      ...(cleanInvestorProfile(investorProfile)
        ? { investorProfile: cleanInvestorProfile(investorProfile) }
        : {}),
    },
    signal,
    timeoutMs: ANALYSIS_TIMEOUT_MS,
  });
}

/** Runs the same listing through several providers and scores each with the same rubric. */
export function compareProviderAnalyses({ propertyId, investorProfile, providers, refresh }, signal) {
  return apiRequest('/api/ai/property-analysis/compare', {
    method: 'POST',
    body: {
      propertyId,
      ...(providers && providers.length > 0 ? { providers } : {}),
      ...(refresh ? { refresh: true } : {}),
      ...(cleanInvestorProfile(investorProfile)
        ? { investorProfile: cleanInvestorProfile(investorProfile) }
        : {}),
    },
    signal,
    timeoutMs: COMPARISON_TIMEOUT_MS,
  });
}

/** Lists which providers are integrated, which are configured, and the model each uses. */
export function fetchAiProviders(signal) {
  return apiRequest('/api/ai/providers', { signal });
}
