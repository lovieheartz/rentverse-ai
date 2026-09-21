'use strict';

const config = require('../../config/env');
const ApiError = require('../../utils/apiError');
const { createAnthropicProvider } = require('./anthropicProvider');
const { createOpenAiCompatibleProvider } = require('./openAiCompatibleProvider');
const { createCohereProvider } = require('./cohereProvider');
const sampleProvider = require('./sampleProvider');

/**
 * Provider registry.
 *
 * Every provider - ten LLM vendors plus the deterministic sample - is reached through one
 * contract:
 *
 *   generateAnalysis(facts, { corrections }) -> { analysis, parseError?, providerMeta }
 *
 * That uniformity is what makes the rest of the system provider-agnostic: the same quality
 * gate scores all of them, failover can substitute one for another mid-request, the
 * comparison endpoint can fan out to several at once, and the offline evaluation suite can
 * rank them against identical inputs.
 *
 * Adapters are built lazily and memoised, so an unconfigured or uninstalled provider costs
 * nothing until something actually asks for it.
 */

const ADAPTER_FACTORIES = {
  anthropic: createAnthropicProvider,
  'openai-compatible': createOpenAiCompatibleProvider,
  cohere: createCohereProvider,
  sample: () => sampleProvider,
};

const instances = new Map();

/** Additional providers registered at runtime (extension point and test seam). */
const customProviders = new Map();

function getDefinition(id) {
  return config.ai.providers[id];
}

/**
 * @param {string} [id] Provider id; defaults to the configured primary.
 * @returns {{ id: string, label: string, generateAnalysis: function }}
 */
function resolveProvider(id = config.ai.provider) {
  if (customProviders.has(id)) return customProviders.get(id);
  if (instances.has(id)) return instances.get(id);

  const definition = getDefinition(id);
  if (!definition) {
    throw ApiError.serviceUnavailable(
      'AI_PROVIDER_UNKNOWN',
      `"${id}" is not a known AI provider. Known providers: ${config.ai.providerIds.join(', ')}.`
    );
  }

  const factory = ADAPTER_FACTORIES[definition.kind];
  if (!factory) {
    throw ApiError.serviceUnavailable(
      'AI_PROVIDER_UNKNOWN',
      `No adapter is registered for provider kind "${definition.kind}".`
    );
  }

  const instance = factory(definition);
  instances.set(id, instance);
  return instance;
}

/**
 * Registers an extra provider at runtime.
 *
 * The extension point for a vendor not in the catalogue, and the seam the gate tests use
 * to inject a provider that deliberately produces bad output - the retry-then-refuse path
 * is not otherwise reachable without paying a real model to behave badly.
 */
function registerProvider(id, provider) {
  if (!provider || typeof provider.generateAnalysis !== 'function') {
    throw new TypeError('A provider must expose a generateAnalysis(facts, options) function.');
  }
  customProviders.set(id, { id, label: provider.label || id, ...provider });
}

function isKnownProvider(id) {
  return Boolean(getDefinition(id)) || customProviders.has(id);
}

/** True when the provider has the credentials or endpoint it needs to be used. */
function isConfigured(id) {
  if (customProviders.has(id)) return true;
  const definition = getDefinition(id);
  return Boolean(definition && definition.configured);
}

/**
 * The provider chain for one request: the requested provider first, then the other
 * configured providers in priority order, then the sample provider as the final rung so a
 * request never fails purely because every vendor is unreachable.
 *
 * @param {string} [requested]
 * @returns {Array<string>}
 */
function buildProviderChain(requested = config.ai.provider) {
  const chain = [requested];

  if (config.ai.failover) {
    for (const id of config.ai.configuredProviders) {
      if (!chain.includes(id)) chain.push(id);
    }
    if (!chain.includes('sample')) chain.push('sample');
  }

  return chain.slice(0, Math.max(1, config.ai.maxFailoverProviders));
}

/**
 * Public description of every provider, for `GET /api/ai/providers`, the health endpoint
 * and the UI's model picker. Never includes credentials - only whether one is present.
 */
function describeProviders() {
  const entries = config.ai.providerIds.map((id) => {
    const definition = getDefinition(id);
    return {
      id: definition.id,
      label: definition.label,
      kind: definition.kind,
      model: definition.model,
      configured: definition.configured,
      requiresApiKey: definition.requiresApiKey,
      apiKeyEnvVar: definition.apiKeyEnvVar,
      modelEnvVar: definition.modelEnvVar,
      structuredOutput: definition.jsonMode,
      isPrimary: definition.id === config.ai.provider,
      notes: definition.notes,
    };
  });

  for (const [id, provider] of customProviders) {
    if (!config.ai.providers[id]) {
      entries.push({
        id,
        label: provider.label,
        kind: 'custom',
        model: 'custom',
        configured: true,
        requiresApiKey: false,
        structuredOutput: 'unknown',
        isPrimary: id === config.ai.provider,
      });
    }
  }

  return entries;
}

/** Compact summary for the health endpoint. */
function describeProviderSummary() {
  const primary = getDefinition(config.ai.provider);

  return {
    primary: config.ai.provider,
    primaryLabel: primary ? primary.label : config.ai.provider,
    primaryModel: primary ? primary.model : 'unknown',
    selection: config.ai.requestedProvider === 'auto' ? 'auto' : 'explicit',
    failover: config.ai.failover,
    configured: config.ai.configuredProviders,
    configuredCount: config.ai.configuredProviders.length,
    available: config.ai.providerIds,
    usingSampleFallback: config.ai.provider === 'sample',
  };
}

/** Test seam. */
function resetRegistry() {
  instances.clear();
  customProviders.clear();
}

module.exports = {
  resolveProvider,
  registerProvider,
  isKnownProvider,
  isConfigured,
  buildProviderChain,
  describeProviders,
  describeProviderSummary,
  getDefinition,
  resetRegistry,
};
