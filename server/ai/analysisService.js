'use strict';

const crypto = require('crypto');

const config = require('../config/env');
const ApiError = require('../utils/apiError');
const TtlCache = require('../utils/ttlCache');
const { buildAnalysisFacts } = require('./analysisFacts');
const { evaluateAnalysis, toPublicScorecard } = require('./evaluation/evaluate');
const registry = require('./providers');

/**
 * Orchestrates one analysis request across the provider fleet.
 *
 * Three layers, in order:
 *
 * 1. **Quality gate.** Every candidate analysis is scored by the deterministic check suite
 *    before it can be returned. On a critical failure the exact violations are fed back
 *    into the prompt and the provider is asked again:
 *
 *      attempt 1 -> evaluate -> pass? return
 *                            -> fail? send the failures back as corrections
 *      attempt 2 -> evaluate -> pass? return
 *                            -> fail? this provider is out
 *
 * 2. **Failover.** If a provider errors, is unreachable, or cannot satisfy the gate, the
 *    next configured provider is tried. The deterministic sample provider is the last rung,
 *    so the feature degrades instead of breaking when every vendor is down. The response
 *    always reports which provider actually answered and what was tried before it.
 *
 * 3. **Fail closed.** If nothing in the chain produces an analysis that passes, the request
 *    fails rather than returning unverified financial copy. An analysis citing a yield the
 *    property does not have is worse than no analysis, because a reader cannot tell.
 *
 * Warnings never block; they travel back in the scorecard for the UI to show.
 */

const analysisCache = new TtlCache({
  ttlMs: config.ai.cacheTtlMs,
  maxEntries: config.ai.cacheMaxEntries,
});

/**
 * Cache key covering every input that can change the output. Profile keys are sorted so
 * `{budgetUsd, goal}` and `{goal, budgetUsd}` hit the same entry.
 */
function buildCacheKey(propertyId, profile, providerId) {
  const definition = registry.getDefinition(providerId);
  const normalisedProfile = Object.keys(profile || {})
    .sort()
    .map((key) => `${key}=${profile[key]}`)
    .join('&');

  return crypto
    .createHash('sha256')
    .update([propertyId, providerId, definition?.model || 'custom', normalisedProfile].join('|'))
    .digest('hex');
}

/**
 * Runs one provider through the quality gate, with the configured number of attempts.
 *
 * @returns {Promise<{ ok: true, result: object } | { ok: false, reason: object }>}
 */
async function runProviderThroughGate(providerId, facts, propertyId) {
  let provider;
  try {
    provider = registry.resolveProvider(providerId);
  } catch (error) {
    return { ok: false, reason: { provider: providerId, code: error.code, message: error.message } };
  }

  const attempts = [];
  let corrections;

  for (let attempt = 1; attempt <= config.ai.maxQualityAttempts; attempt += 1) {
    let generated;
    try {
      generated = await provider.generateAnalysis(facts, { corrections });
    } catch (error) {
      // A provider-level failure ends this provider's turn; the chain moves on.
      return {
        ok: false,
        reason: {
          provider: providerId,
          code: error.code || 'AI_PROVIDER_ERROR',
          message: error.message,
          attempts: attempts.length,
        },
      };
    }

    const evaluation = evaluateAnalysis({
      analysis: generated.analysis,
      facts,
      parseError: generated.parseError,
    });

    attempts.push({
      attempt,
      passed: evaluation.passed,
      score: evaluation.score,
      failedChecks: evaluation.checks.filter((check) => !check.passed).map((check) => check.id),
      latencyMs: generated.providerMeta.latencyMs,
    });

    if (evaluation.passed) {
      return {
        ok: true,
        result: {
          analysis: generated.analysis,
          evaluation: toPublicScorecard(evaluation),
          meta: {
            ...generated.providerMeta,
            propertyId,
            generatedAt: new Date().toISOString(),
            attempts: attempts.length,
            regenerated: attempts.length > 1,
            cached: false,
          },
        },
      };
    }

    corrections = evaluation.corrections;

    if (attempt === config.ai.maxQualityAttempts) {
      return {
        ok: false,
        reason: {
          provider: providerId,
          providerLabel: generated.providerMeta.providerLabel,
          model: generated.providerMeta.model,
          code: 'AI_OUTPUT_REJECTED',
          message: 'Output failed the quality gate on every attempt.',
          attempts: attempts.length,
          failedChecks: evaluation.checks
            .filter((check) => !check.passed && check.severity === 'critical')
            .map(({ id, label, detail }) => ({ id, label, detail })),
        },
      };
    }
  }

  /* istanbul ignore next - unreachable: the loop returns on every path. */
  return { ok: false, reason: { provider: providerId, code: 'AI_PROVIDER_ERROR' } };
}

/**
 * Generates, validates and returns an investment analysis.
 *
 * @param {object} input
 * @param {object} input.property Full property record.
 * @param {object} [input.investorProfile] Validated investor profile.
 * @param {boolean} [input.refresh] Bypass the cache for this call.
 * @param {string} [input.providerName] Provider to try first; defaults to the primary.
 * @param {boolean} [input.allowFailover=true] Set false to pin the request to one provider.
 * @returns {Promise<object>} `{ analysis, evaluation, meta }`
 */
async function generatePropertyAnalysis({
  property,
  investorProfile = {},
  refresh = false,
  providerName,
  allowFailover = true,
}) {
  const requested = providerName || config.ai.provider;

  if (!registry.isKnownProvider(requested)) {
    throw ApiError.serviceUnavailable(
      'AI_PROVIDER_UNKNOWN',
      `"${requested}" is not a known AI provider. Known providers: ${config.ai.providerIds.join(', ')}.`
    );
  }

  const facts = buildAnalysisFacts(property, investorProfile);
  const cacheKey = buildCacheKey(property.id, investorProfile, requested);

  if (!refresh) {
    const cached = analysisCache.get(cacheKey);
    if (cached) {
      return {
        ...cached,
        meta: { ...cached.meta, cached: true, cacheAgeMs: analysisCache.ageOf(cacheKey) },
      };
    }
  }

  const chain = allowFailover ? registry.buildProviderChain(requested) : [requested];
  const failures = [];

  for (const providerId of chain) {
    const outcome = await runProviderThroughGate(providerId, facts, property.id);

    if (outcome.ok) {
      const result = {
        ...outcome.result,
        meta: {
          ...outcome.result.meta,
          requestedProvider: requested,
          failedOver: providerId !== requested,
          ...(failures.length > 0 ? { failoverTrail: failures } : {}),
        },
      };

      analysisCache.set(cacheKey, result);
      return result;
    }

    failures.push(outcome.reason);
  }

  // Nothing in the chain produced verifiable output.
  const primaryFailure = failures[0] || {};
  throw ApiError.upstreamFailure(
    primaryFailure.code === 'AI_OUTPUT_REJECTED' ? 'AI_OUTPUT_REJECTED' : 'AI_ALL_PROVIDERS_FAILED',
    failures.length === 1
      ? `The analysis could not be produced: ${primaryFailure.message}`
      : `No configured AI provider produced an analysis that passed the quality checks (${failures.length} tried).`,
    { providersTried: chain, failures }
  );
}

/**
 * Runs several providers over the same property and scores each with the same rubric.
 *
 * This is the multi-provider payoff: identical facts, identical prompt, identical checks,
 * so the differences in the results are attributable to the models rather than to the
 * harness. Failover is disabled per provider - substituting one vendor for another would
 * make the comparison meaningless.
 *
 * @param {object} input
 * @param {object} input.property
 * @param {object} [input.investorProfile]
 * @param {Array<string>} input.providerNames
 * @param {boolean} [input.refresh]
 * @returns {Promise<{ results: Array<object>, ranking: Array<object>, summary: object }>}
 */
async function comparePropertyAnalyses({ property, investorProfile = {}, providerNames, refresh = false }) {
  const unique = [...new Set(providerNames)].slice(0, config.ai.maxCompareProviders);

  const unknown = unique.filter((id) => !registry.isKnownProvider(id));
  if (unknown.length > 0) {
    throw ApiError.badRequest(`Unknown AI provider(s): ${unknown.join(', ')}.`, {
      knownProviders: config.ai.providerIds,
    });
  }

  const settled = await Promise.all(
    unique.map(async (providerId) => {
      const definition = registry.getDefinition(providerId);
      const startedAt = Date.now();

      try {
        const result = await generatePropertyAnalysis({
          property,
          investorProfile,
          refresh,
          providerName: providerId,
          allowFailover: false,
        });

        return {
          provider: providerId,
          label: definition?.label || providerId,
          model: result.meta.model,
          ok: true,
          score: result.evaluation.score,
          passed: result.evaluation.passed,
          latencyMs: result.meta.latencyMs,
          attempts: result.meta.attempts,
          cached: result.meta.cached,
          jsonMode: result.meta.jsonMode,
          usage: result.meta.usage,
          verdict: result.analysis.suitability?.verdict,
          analysis: result.analysis,
          evaluation: result.evaluation,
        };
      } catch (error) {
        return {
          provider: providerId,
          label: definition?.label || providerId,
          model: definition?.model,
          ok: false,
          score: 0,
          passed: false,
          latencyMs: Date.now() - startedAt,
          error: {
            code: error.code || 'AI_PROVIDER_ERROR',
            message: error.message,
            failures: error.details?.failures,
          },
        };
      }
    })
  );

  const ranking = settled
    .map(({ provider, label, model, ok, passed, score, latencyMs }) => ({
      provider,
      label,
      model,
      ok,
      passed,
      score,
      latencyMs,
    }))
    // Best score first; on a tie the faster provider ranks higher.
    .sort((a, b) => b.score - a.score || a.latencyMs - b.latencyMs);

  const succeeded = settled.filter((entry) => entry.ok);

  return {
    results: settled,
    ranking,
    summary: {
      requested: unique.length,
      succeeded: succeeded.length,
      failed: settled.length - succeeded.length,
      bestProvider: ranking.find((entry) => entry.ok)?.provider || null,
      meanScore:
        succeeded.length === 0
          ? 0
          : Number((succeeded.reduce((sum, e) => sum + e.score, 0) / succeeded.length).toFixed(4)),
    },
  };
}

/** Compact AI status for the health endpoint. */
function describeProvider() {
  return { ...registry.describeProviderSummary(), cacheEntries: analysisCache.size };
}

module.exports = {
  generatePropertyAnalysis,
  comparePropertyAnalyses,
  describeProvider,
  buildCacheKey,
  analysisCache,
  // Re-exported so callers have a single entry point into the AI layer.
  resolveProvider: registry.resolveProvider,
  registerProvider: registry.registerProvider,
  describeProviders: registry.describeProviders,
};
