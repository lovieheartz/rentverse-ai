'use strict';

const ApiError = require('../../utils/apiError');
const { ANALYSIS_STRICT_JSON_SCHEMA } = require('../analysisSchema');
const { SYSTEM_PROMPT, buildUserPrompt } = require('../promptBuilder');
const { parseAnalysisJson } = require('./jsonExtraction');

/**
 * Cohere Chat v2 adapter.
 *
 * Cohere does not speak the OpenAI protocol, so it needs its own adapter - but it is a
 * small, stable REST surface, so this talks to it with the platform `fetch` rather than
 * adding another SDK. The provider contract is identical to every other provider here:
 * `generateAnalysis(facts, options) -> { analysis, providerMeta }`, with the same tolerant
 * parsing and the same quality gate applied afterwards.
 */

const ENDPOINT_PATH = '/v2/chat';

function buildRequestBody(definition, facts, options, useSchema) {
  const body = {
    model: definition.model,
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      {
        role: 'user',
        content: buildUserPrompt(facts, {
          corrections: options.corrections,
          includeSchemaInstruction: !useSchema,
        }),
      },
    ],
    max_tokens: definition.maxTokens,
  };

  if (definition.supportsTemperature) body.temperature = definition.temperature;

  if (useSchema) {
    body.response_format = { type: 'json_object', json_schema: ANALYSIS_STRICT_JSON_SCHEMA };
  } else {
    body.response_format = { type: 'json_object' };
  }

  return body;
}

/** Cohere returns content as an array of typed blocks; join the text ones. */
function extractText(payload) {
  const content = payload?.message?.content;
  if (!Array.isArray(content)) return '';
  return content
    .filter((block) => block && block.type === 'text' && typeof block.text === 'string')
    .map((block) => block.text)
    .join('\n')
    .trim();
}

function createCohereProvider(definition) {
  async function generateAnalysis(facts, options = {}) {
    if (!definition.apiKey) {
      throw ApiError.serviceUnavailable(
        'AI_NOT_CONFIGURED',
        `${definition.label} is not configured: set ${definition.apiKeyEnvVar}.`
      );
    }

    const startedAt = Date.now();
    const degradations = [];

    // Try schema-constrained JSON first, then plain JSON mode.
    for (const useSchema of [true, false]) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), definition.timeoutMs);

      let response;
      let payload;
      try {
        response = await fetch(`${definition.baseUrl.replace(/\/+$/, '')}${ENDPOINT_PATH}`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${definition.apiKey}`,
            'Content-Type': 'application/json',
            Accept: 'application/json',
          },
          body: JSON.stringify(buildRequestBody(definition, facts, options, useSchema)),
          signal: controller.signal,
        });
        payload = await response.json().catch(() => ({}));
      } catch (error) {
        if (error.name === 'AbortError') {
          throw ApiError.upstreamFailure(
            'AI_PROVIDER_TIMEOUT',
            `${definition.label} did not respond within ${definition.timeoutMs}ms.`
          );
        }
        throw ApiError.serviceUnavailable(
          'AI_PROVIDER_UNAVAILABLE',
          `${definition.label} could not be reached.`
        );
      } finally {
        clearTimeout(timeout);
      }

      if (!response.ok) {
        const message = String(payload?.message || payload?.error || '').toLowerCase();

        // Drop the schema and retry if that is what was rejected.
        if (response.status === 400 && useSchema && /schema|response_format/.test(message)) {
          degradations.push('json_schema unsupported');
          continue;
        }

        if (response.status === 401 || response.status === 403) {
          throw ApiError.serviceUnavailable(
            'AI_PROVIDER_UNAUTHORIZED',
            `${definition.label} rejected the server credentials. Check ${definition.apiKeyEnvVar}.`
          );
        }
        if (response.status === 404) {
          throw ApiError.upstreamFailure(
            'AI_MODEL_NOT_FOUND',
            `${definition.label} does not recognise the model "${definition.model}". Set ${definition.modelEnvVar}.`
          );
        }
        if (response.status === 429) {
          throw new ApiError(
            429,
            'AI_PROVIDER_RATE_LIMITED',
            `${definition.label} is rate limiting this server.`
          );
        }
        throw ApiError.upstreamFailure(
          'AI_PROVIDER_ERROR',
          `${definition.label} returned HTTP ${response.status}.`
        );
      }

      if (payload.finish_reason === 'MAX_TOKENS') {
        throw ApiError.upstreamFailure(
          'AI_RESPONSE_TRUNCATED',
          `${definition.label} cut the analysis off before it was complete.`
        );
      }

      const { analysis, parseError } = parseAnalysisJson(extractText(payload));

      const providerMeta = {
        source: definition.id,
        providerLabel: definition.label,
        model: definition.model,
        jsonMode: useSchema ? 'json_schema' : 'json_object',
        latencyMs: Date.now() - startedAt,
        finishReason: payload.finish_reason,
        usage: payload.usage?.tokens
          ? {
              inputTokens: payload.usage.tokens.input_tokens,
              outputTokens: payload.usage.tokens.output_tokens,
            }
          : undefined,
        ...(degradations.length > 0 ? { degradations } : {}),
      };

      return parseError ? { analysis: null, parseError, providerMeta } : { analysis, providerMeta };
    }

    throw ApiError.upstreamFailure(
      'AI_PROVIDER_ERROR',
      `${definition.label} rejected every supported request shape.`
    );
  }

  return { id: definition.id, label: definition.label, generateAnalysis };
}

module.exports = { createCohereProvider };
