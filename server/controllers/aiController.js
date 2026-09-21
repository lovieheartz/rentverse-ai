'use strict';

const config = require('../config/env');
const asyncErrorHandler = require('../middlewares/helpers/asyncErrorHandler');
const ApiError = require('../utils/apiError');
const { sendSuccess } = require('../utils/apiResponse');
const propertyService = require('../services/propertyService');
const {
  generatePropertyAnalysis,
  comparePropertyAnalyses,
  describeProvider,
  describeProviders,
} = require('../ai/analysisService');

/**
 * AI endpoints for the property investment flow.
 */

function loadPropertyOr404(propertyId) {
  const property = propertyService.getRawPropertyById(propertyId);
  if (!property) {
    throw ApiError.notFound(`No property exists with id "${propertyId}".`, { propertyId });
  }
  return property;
}

/**
 * `POST /api/ai/property-analysis`
 *
 * Generates an evidence-led investment analysis for one listing, optionally assessed
 * against a prospective investor's profile, using the configured LLM provider (or the one
 * named in `provider`). Every response carries the quality scorecard that was applied
 * before it was allowed out, so the client can show what was verified.
 */
exports.analyseProperty = asyncErrorHandler(async (req, res) => {
  const { propertyId, investorProfile, refresh, provider, failover } = req.validated.body;
  const property = loadPropertyOr404(propertyId);

  const { analysis, evaluation, meta } = await generatePropertyAnalysis({
    property,
    investorProfile,
    refresh,
    providerName: provider,
    allowFailover: failover,
  });

  return sendSuccess(
    res,
    {
      propertyId: property.id,
      propertyTitle: property.title,
      generatedAt: meta.generatedAt,
      provider: meta.source,
      providerLabel: meta.providerLabel,
      model: meta.model,
      analysis,
    },
    {
      meta: {
        requestedProvider: meta.requestedProvider,
        failedOver: meta.failedOver,
        failoverTrail: meta.failoverTrail,
        structuredOutputMode: meta.jsonMode,
        degradations: meta.degradations,
        effort: meta.effort,
        providerLatencyMs: meta.latencyMs,
        attempts: meta.attempts,
        regenerated: meta.regenerated,
        cached: meta.cached,
        cacheAgeMs: meta.cacheAgeMs,
        usage: meta.usage,
        providerNote: meta.note,
        evaluation,
      },
    }
  );
});

/**
 * `POST /api/ai/property-analysis/compare`
 *
 * Runs the same listing and the same investor profile through several providers and scores
 * each result with the same rubric, so model differences are attributable to the models
 * rather than to the prompt or the checks.
 */
exports.compareProviders = asyncErrorHandler(async (req, res) => {
  const { propertyId, investorProfile, refresh, providers } = req.validated.body;
  const property = loadPropertyOr404(propertyId);

  // Default to everything that is actually usable. The sample provider is included only
  // when it is the sole option, so a comparison is never a single deterministic row.
  const requested =
    providers && providers.length > 0
      ? providers
      : config.ai.configuredProviders.length > 0
        ? config.ai.configuredProviders
        : ['sample'];

  if (requested.length < 2) {
    throw ApiError.badRequest(
      'Comparison needs at least two providers. Configure another provider API key, or name two in "providers".',
      { requested, configured: config.ai.configuredProviders }
    );
  }

  const { results, ranking, summary } = await comparePropertyAnalyses({
    property,
    investorProfile,
    providerNames: requested,
    refresh,
  });

  return sendSuccess(
    res,
    {
      propertyId: property.id,
      propertyTitle: property.title,
      results,
    },
    { meta: { ranking, summary, providersRequested: requested } }
  );
});

/** `GET /api/ai/providers` - what is integrated, what is configured, which model each uses. */
exports.listProviders = asyncErrorHandler(async (req, res) => {
  const providers = describeProviders();

  return sendSuccess(res, providers, {
    meta: {
      primary: config.ai.provider,
      selection: config.ai.requestedProvider === 'auto' ? 'auto' : 'explicit',
      priorityOrder: config.ai.providerOrder,
      configured: config.ai.configuredProviders,
      failover: config.ai.failover,
      integratedCount: providers.length,
      configuredCount: providers.filter((entry) => entry.configured && entry.id !== 'sample').length,
    },
  });
});

/** `GET /api/ai/status` - lets a reviewer confirm the wiring without making a paid call. */
exports.getAiStatus = asyncErrorHandler(async (req, res) => {
  return sendSuccess(res, describeProvider());
});
