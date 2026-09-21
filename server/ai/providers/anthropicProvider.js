'use strict';

const ApiError = require('../../utils/apiError');
const { ANALYSIS_JSON_SCHEMA } = require('../analysisSchema');
const { SYSTEM_PROMPT, buildUserPrompt } = require('../promptBuilder');
const { parseAnalysisJson } = require('./jsonExtraction');

/**
 * Anthropic Claude adapter, using the official SDK.
 *
 * Kept separate from the OpenAI-compatible adapter because the API genuinely differs, and
 * because two of those differences are worth having:
 *
 *  - **Prompt caching.** The system prompt is byte-identical on every call and is sent as
 *    a cacheable block, so after the first request the whole instruction prefix is served
 *    from cache and only the fact sheet is charged at full rate.
 *  - **Adaptive thinking.** Claude decides how much to reason per request, with depth
 *    bounded by `AI_EFFORT`, rather than a fixed token budget.
 *
 * Structured output uses `output_config.format`, so decoding is constrained to the
 * analysis schema rather than parsed out of prose.
 *
 * The SDK is required lazily: the server must still boot, and the sample provider must
 * still work, on a machine where optional dependencies were not installed.
 */

const REFUSAL_FALLBACK_BETA = 'server-side-fallback-2026-07-01';

let cachedSdk = null;
const clientCache = new Map();

function loadSdk() {
  if (cachedSdk) return cachedSdk;

  let imported;
  try {
    // eslint-disable-next-line global-require
    imported = require('@anthropic-ai/sdk');
  } catch (cause) {
    throw ApiError.serviceUnavailable(
      'AI_SDK_MISSING',
      'The Anthropic SDK is not installed. Run `npm install`, or select another provider.'
    );
  }

  // Tolerate every published CJS/ESM interop shape.
  const Anthropic = imported.Anthropic || imported.default || imported;
  if (typeof Anthropic !== 'function') {
    throw ApiError.serviceUnavailable('AI_SDK_MISSING', 'The Anthropic SDK failed to load.');
  }

  cachedSdk = { Anthropic, errors: imported };
  return cachedSdk;
}

function getClient(definition) {
  if (clientCache.has(definition.id)) return clientCache.get(definition.id);

  if (!definition.apiKey) {
    throw ApiError.serviceUnavailable(
      'AI_NOT_CONFIGURED',
      `${definition.label} is not configured: set ${definition.apiKeyEnvVar}.`
    );
  }

  const { Anthropic } = loadSdk();
  const client = new Anthropic({
    apiKey: definition.apiKey,
    timeout: definition.timeoutMs,
    maxRetries: definition.maxRetries,
  });

  clientCache.set(definition.id, client);
  return client;
}

function buildRequest(definition, facts, options) {
  return {
    model: definition.model,
    max_tokens: definition.maxTokens,
    system: [{ type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }],
    messages: [{ role: 'user', content: buildUserPrompt(facts, options) }],
    thinking: { type: 'adaptive' },
    output_config: {
      effort: definition.effort,
      format: { type: 'json_schema', schema: ANALYSIS_JSON_SCHEMA },
    },
  };
}

/** True when a 400 is complaining about the optional refusal-fallback parameters. */
function isUnsupportedFallbackError(error) {
  if (!error || error.status !== 400) return false;
  const message = String(error.message || '').toLowerCase();
  return message.includes('fallback') || message.includes('beta');
}

/** Thinking blocks may precede the answer; the structured output is the last text block. */
function extractJsonText(content) {
  if (!Array.isArray(content)) return '';
  for (let index = content.length - 1; index >= 0; index -= 1) {
    const block = content[index];
    if (block && block.type === 'text' && typeof block.text === 'string' && block.text.trim()) {
      return block.text;
    }
  }
  return '';
}

function summariseUsage(usage) {
  if (!usage) return undefined;
  return {
    inputTokens: usage.input_tokens,
    outputTokens: usage.output_tokens,
    cacheReadInputTokens: usage.cache_read_input_tokens,
    cacheCreationInputTokens: usage.cache_creation_input_tokens,
  };
}

/** Maps SDK errors onto the application's error vocabulary, without leaking credentials. */
function translateProviderError(error, definition) {
  if (error instanceof ApiError) return error;

  const { errors } = cachedSdk || {};
  const status = typeof error?.status === 'number' ? error.status : undefined;
  const isType = (name) => Boolean(errors && errors[name] && error instanceof errors[name]);

  if (isType('AuthenticationError') || status === 401 || status === 403) {
    return ApiError.serviceUnavailable(
      'AI_PROVIDER_UNAUTHORIZED',
      `${definition.label} rejected the server credentials. Check ${definition.apiKeyEnvVar}.`
    );
  }
  if (isType('NotFoundError') || status === 404) {
    return ApiError.upstreamFailure(
      'AI_MODEL_NOT_FOUND',
      `${definition.label} does not recognise the model "${definition.model}". Set ${definition.modelEnvVar}.`
    );
  }
  if (isType('RateLimitError') || status === 429) {
    return new ApiError(429, 'AI_PROVIDER_RATE_LIMITED', `${definition.label} is rate limiting this server.`, {
      cause: error,
    });
  }
  if (isType('APIConnectionTimeoutError') || error?.name === 'APIConnectionTimeoutError') {
    return ApiError.upstreamFailure('AI_PROVIDER_TIMEOUT', `${definition.label} did not respond in time.`);
  }
  if (isType('APIConnectionError') || error?.name === 'APIConnectionError') {
    return ApiError.serviceUnavailable(
      'AI_PROVIDER_UNAVAILABLE',
      `${definition.label} could not be reached.`
    );
  }
  if (status === 400) {
    // A 400 here is a bug in our request shape, not the caller's input.
    return ApiError.upstreamFailure('AI_REQUEST_REJECTED', `${definition.label} rejected the analysis request.`);
  }

  return ApiError.upstreamFailure('AI_PROVIDER_ERROR', `${definition.label} failed to produce an analysis.`);
}

function createAnthropicProvider(definition) {
  async function generateAnalysis(facts, options = {}) {
    const client = getClient(definition);
    const request = buildRequest(definition, facts, options);
    const startedAt = Date.now();

    let response;
    let fallbackEnabled = definition.refusalFallback;

    try {
      if (fallbackEnabled) {
        try {
          // Ask the API to re-run a policy-declined request on a fallback model in the
          // same call, instead of surfacing a refusal to the user.
          response = await client.beta.messages.create({
            ...request,
            betas: [REFUSAL_FALLBACK_BETA],
            fallbacks: 'default',
          });
        } catch (error) {
          // Accounts without the beta enabled would otherwise lose the feature entirely.
          if (!isUnsupportedFallbackError(error)) throw error;
          fallbackEnabled = false;
          response = await client.messages.create(request);
        }
      } else {
        response = await client.messages.create(request);
      }
    } catch (error) {
      throw translateProviderError(error, definition);
    }

    if (response.stop_reason === 'refusal') {
      throw ApiError.upstreamFailure(
        'AI_REQUEST_REFUSED',
        `${definition.label} declined to analyse this listing.`,
        response.stop_details ? { category: response.stop_details.category } : undefined
      );
    }
    if (response.stop_reason === 'max_tokens') {
      throw ApiError.upstreamFailure(
        'AI_RESPONSE_TRUNCATED',
        `${definition.label} cut the analysis off before it was complete. Raise AI_MAX_TOKENS or retry.`
      );
    }

    const { analysis, parseError } = parseAnalysisJson(extractJsonText(response.content));

    const servedByFallbackModel = Array.isArray(response.content)
      ? response.content.some((block) => block && block.type === 'fallback')
      : false;

    const providerMeta = {
      source: definition.id,
      providerLabel: definition.label,
      model: response.model || definition.model,
      jsonMode: 'json_schema',
      effort: definition.effort,
      latencyMs: Date.now() - startedAt,
      stopReason: response.stop_reason,
      usage: summariseUsage(response.usage),
      refusalFallbackEnabled: fallbackEnabled,
      ...(servedByFallbackModel ? { servedByFallbackModel: true } : {}),
    };

    // A parse failure is returned, not thrown: the quality gate records it as a failed
    // check and the service retries with corrections, as for any other defect.
    return parseError ? { analysis: null, parseError, providerMeta } : { analysis, providerMeta };
  }

  return { id: definition.id, label: definition.label, generateAnalysis };
}

/** Test seam: drops memoised clients so configuration changes take effect. */
function resetClients() {
  clientCache.clear();
}

module.exports = { createAnthropicProvider, resetClients, REFUSAL_FALLBACK_BETA };
