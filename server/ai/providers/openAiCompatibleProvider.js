'use strict';

const ApiError = require('../../utils/apiError');
const { ANALYSIS_STRICT_JSON_SCHEMA } = require('../analysisSchema');
const { SYSTEM_PROMPT, buildUserPrompt } = require('../promptBuilder');
const { parseAnalysisJson } = require('./jsonExtraction');

/**
 * One adapter for every vendor that speaks the OpenAI Chat Completions protocol.
 *
 * OpenAI, Google Gemini (via its OpenAI-compatible endpoint), Mistral, Groq, DeepSeek,
 * xAI Grok, OpenRouter and a local Ollama server all accept the same request shape and
 * differ only in base URL, credentials, model id and which optional parameters they
 * honour. Writing eight near-identical SDK integrations would mean eight dependencies and
 * eight code paths to keep working; this is one of each, parameterised by the provider
 * definition in `./index.js`.
 *
 * The parts that are genuinely not uniform are handled explicitly:
 *
 *  - **Structured output.** Support ranges from strict JSON Schema, through a loose
 *    "return JSON" mode, to nothing at all. Each request walks down that ladder, and when
 *    it reaches the bottom the output contract is written into the prompt instead. Every
 *    response goes through a tolerant parser, and then through the same quality gate as
 *    every other provider - so a weaker provider is held to an identical standard.
 *  - **Token parameter.** Newer OpenAI models require `max_completion_tokens` and reject
 *    `max_tokens`; most other vendors accept only `max_tokens`. The definition declares a
 *    preference and the adapter swaps on rejection.
 *  - **Sampling.** Some reasoning models reject any `temperature` but the default.
 *
 * Each of those degradations is driven by the provider's own 400 response rather than a
 * hardcoded assumption about what it supports, so a vendor adding schema support starts
 * being used without a code change.
 */

const JSON_MODE = {
  SCHEMA: 'json_schema',
  OBJECT: 'json_object',
  NONE: 'none',
};

let cachedSdk = null;
const clientCache = new Map();

function loadSdk() {
  if (cachedSdk) return cachedSdk;

  let imported;
  try {
    // eslint-disable-next-line global-require
    imported = require('openai');
  } catch (cause) {
    throw ApiError.serviceUnavailable(
      'AI_SDK_MISSING',
      'The OpenAI-compatible SDK is not installed. Run `npm install`.'
    );
  }

  const OpenAI = imported.OpenAI || imported.default || imported;
  if (typeof OpenAI !== 'function') {
    throw ApiError.serviceUnavailable('AI_SDK_MISSING', 'The OpenAI-compatible SDK failed to load.');
  }

  cachedSdk = { OpenAI, errors: imported };
  return cachedSdk;
}

function getClient(definition) {
  const cacheKey = `${definition.id}|${definition.baseUrl}|${definition.apiKey ? 'keyed' : 'anon'}`;
  if (clientCache.has(cacheKey)) return clientCache.get(cacheKey);

  if (definition.requiresApiKey && !definition.apiKey) {
    throw ApiError.serviceUnavailable(
      'AI_NOT_CONFIGURED',
      `${definition.label} is not configured: set ${definition.apiKeyEnvVar}.`
    );
  }

  const { OpenAI } = loadSdk();
  const client = new OpenAI({
    // Ollama and other local servers need no credential, but the SDK insists on a string.
    apiKey: definition.apiKey || 'not-required',
    baseURL: definition.baseUrl,
    timeout: definition.timeoutMs,
    maxRetries: definition.maxRetries,
    defaultHeaders: definition.extraHeaders,
  });

  clientCache.set(cacheKey, client);
  return client;
}

/** True when a 400 is rejecting a parameter rather than the content of the request. */
function isUnsupportedParameterError(error, parameterName) {
  if (!error || error.status !== 400) return false;
  const haystack = `${error.message || ''} ${JSON.stringify(error.error || error.body || {})}`.toLowerCase();
  return (
    haystack.includes(parameterName.toLowerCase()) ||
    haystack.includes('unsupported') ||
    haystack.includes('unrecognized') ||
    haystack.includes('not supported')
  );
}

/** Ordered list of structured-output strategies to try for this provider. */
function buildJsonModeLadder(definition) {
  const ladder = [];
  if (definition.jsonMode === JSON_MODE.SCHEMA) {
    ladder.push({
      mode: JSON_MODE.SCHEMA,
      responseFormat: {
        type: 'json_schema',
        json_schema: {
          name: 'property_investment_analysis',
          strict: true,
          schema: ANALYSIS_STRICT_JSON_SCHEMA,
        },
      },
    });
  }
  if (definition.jsonMode !== JSON_MODE.NONE) {
    ladder.push({ mode: JSON_MODE.OBJECT, responseFormat: { type: 'json_object' } });
  }
  ladder.push({ mode: JSON_MODE.NONE, responseFormat: undefined });
  return ladder;
}

function summariseUsage(usage) {
  if (!usage) return undefined;
  return {
    inputTokens: usage.prompt_tokens,
    outputTokens: usage.completion_tokens,
    totalTokens: usage.total_tokens,
    cacheReadInputTokens: usage.prompt_tokens_details?.cached_tokens,
  };
}

/** Maps SDK errors onto the application's error vocabulary, without leaking credentials. */
function translateProviderError(error, definition) {
  if (error instanceof ApiError) return error;

  const status = typeof error?.status === 'number' ? error.status : undefined;
  const label = definition.label;

  if (status === 401 || status === 403) {
    return ApiError.serviceUnavailable(
      'AI_PROVIDER_UNAUTHORIZED',
      `${label} rejected the server credentials. Check ${definition.apiKeyEnvVar}.`
    );
  }
  if (status === 404) {
    return ApiError.upstreamFailure(
      'AI_MODEL_NOT_FOUND',
      `${label} does not recognise the model "${definition.model}". Set ${definition.modelEnvVar} to a model your account can use.`
    );
  }
  if (status === 429) {
    return new ApiError(429, 'AI_PROVIDER_RATE_LIMITED', `${label} is rate limiting this server.`, {
      cause: error,
    });
  }
  if (error?.name === 'APIConnectionTimeoutError') {
    return ApiError.upstreamFailure('AI_PROVIDER_TIMEOUT', `${label} did not respond in time.`);
  }
  if (error?.name === 'APIConnectionError') {
    return ApiError.serviceUnavailable(
      'AI_PROVIDER_UNAVAILABLE',
      `${label} could not be reached at ${definition.baseUrl}.`
    );
  }
  if (status === 400) {
    return ApiError.upstreamFailure('AI_REQUEST_REJECTED', `${label} rejected the analysis request.`);
  }

  return ApiError.upstreamFailure('AI_PROVIDER_ERROR', `${label} failed to produce an analysis.`);
}

/**
 * Builds a provider object for one OpenAI-compatible vendor.
 *
 * @param {object} definition Entry from the provider registry.
 * @returns {{ generateAnalysis: function }}
 */
function createOpenAiCompatibleProvider(definition) {
  async function generateAnalysis(facts, options = {}) {
    const client = getClient(definition);
    const startedAt = Date.now();
    const ladder = buildJsonModeLadder(definition);

    let lastError;
    const degradations = [];

    for (const rung of ladder) {
      const messages = [
        { role: 'system', content: SYSTEM_PROMPT },
        {
          role: 'user',
          content: buildUserPrompt(facts, {
            corrections: options.corrections,
            // Without an enforced schema the contract has to travel in the prompt.
            includeSchemaInstruction: rung.mode !== JSON_MODE.SCHEMA,
          }),
        },
      ];

      const body = { model: definition.model, messages };
      if (rung.responseFormat) body.response_format = rung.responseFormat;
      if (definition.supportsTemperature) body.temperature = definition.temperature;

      let tokenParam = definition.tokenParam;
      body[tokenParam] = definition.maxTokens;

      let response;
      try {
        response = await client.chat.completions.create(body);
      } catch (error) {
        // Swap the token parameter once if that is what was rejected.
        const alternateParam =
          tokenParam === 'max_completion_tokens' ? 'max_tokens' : 'max_completion_tokens';

        if (isUnsupportedParameterError(error, tokenParam)) {
          degradations.push(`${tokenParam} -> ${alternateParam}`);
          delete body[tokenParam];
          tokenParam = alternateParam;
          body[tokenParam] = definition.maxTokens;

          try {
            response = await client.chat.completions.create(body);
          } catch (retryError) {
            lastError = retryError;
            if (isUnsupportedParameterError(retryError, 'response_format')) continue;
            throw translateProviderError(retryError, definition);
          }
        } else if (rung.responseFormat && isUnsupportedParameterError(error, 'response_format')) {
          // Provider cannot honour this structured-output mode - drop to the next rung.
          degradations.push(`${rung.mode} unsupported`);
          lastError = error;
          continue;
        } else {
          throw translateProviderError(error, definition);
        }
      }

      const choice = response.choices?.[0];
      const finishReason = choice?.finish_reason;

      if (finishReason === 'length') {
        throw ApiError.upstreamFailure(
          'AI_RESPONSE_TRUNCATED',
          `${definition.label} cut the analysis off before it was complete. Raise ${definition.modelEnvVar.replace('_MODEL', '_MAX_TOKENS')} or retry.`
        );
      }
      if (finishReason === 'content_filter') {
        throw ApiError.upstreamFailure(
          'AI_REQUEST_REFUSED',
          `${definition.label} blocked this request with a content filter.`
        );
      }

      const { analysis, parseError } = parseAnalysisJson(choice?.message?.content ?? '');

      const providerMeta = {
        source: definition.id,
        providerLabel: definition.label,
        model: response.model || definition.model,
        jsonMode: rung.mode,
        latencyMs: Date.now() - startedAt,
        finishReason,
        usage: summariseUsage(response.usage),
        ...(degradations.length > 0 ? { degradations } : {}),
      };

      // A parse failure is returned, not thrown: the quality gate records it as a failed
      // check and the service retries with corrections, exactly as for any other defect.
      return parseError ? { analysis: null, parseError, providerMeta } : { analysis, providerMeta };
    }

    throw translateProviderError(lastError, definition);
  }

  return { id: definition.id, label: definition.label, generateAnalysis };
}

/** Test seam: drops memoised clients so configuration changes take effect. */
function resetClients() {
  clientCache.clear();
}

module.exports = { createOpenAiCompatibleProvider, resetClients, JSON_MODE };
