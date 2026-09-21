'use strict';

/**
 * Centralised, validated environment configuration.
 *
 * Loaded once at process start. Every module reads configuration from here instead of
 * touching `process.env` directly, so that:
 *   - `.config.env` is loaded exactly once, from one place;
 *   - values are coerced and range-checked at boot rather than at first use;
 *   - misconfiguration surfaces as a startup warning instead of a runtime crash;
 *   - the set of supported LLM providers is a declarative table rather than scattered
 *     `process.env.X_API_KEY` checks.
 */

const path = require('path');
const dotenv = require('dotenv');

// Secrets live in server/config/.config.env (gitignored). Real environment variables
// always win over file values - dotenv never overrides what is already set.
dotenv.config({ path: path.resolve(__dirname, '.config.env') });

const warnings = [];

function readString(name, fallback = '') {
  const raw = process.env[name];
  return typeof raw === 'string' && raw.trim() !== '' ? raw.trim() : fallback;
}

function isSet(name) {
  const raw = process.env[name];
  return typeof raw === 'string' && raw.trim() !== '';
}

function readInt(name, fallback, { min = Number.MIN_SAFE_INTEGER, max = Number.MAX_SAFE_INTEGER } = {}) {
  const raw = process.env[name];
  if (raw === undefined || String(raw).trim() === '') return fallback;

  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
    warnings.push(`${name}="${raw}" is not an integer in [${min}, ${max}] - using ${fallback}.`);
    return fallback;
  }
  return parsed;
}

function readFloat(name, fallback, { min = -Infinity, max = Infinity } = {}) {
  const raw = process.env[name];
  if (raw === undefined || String(raw).trim() === '') return fallback;

  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < min || parsed > max) {
    warnings.push(`${name}="${raw}" is not a number in [${min}, ${max}] - using ${fallback}.`);
    return fallback;
  }
  return parsed;
}

function readBool(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || String(raw).trim() === '') return fallback;

  const normalised = String(raw).trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(normalised)) return true;
  if (['0', 'false', 'no', 'off'].includes(normalised)) return false;

  warnings.push(`${name}="${raw}" is not a boolean - using ${fallback}.`);
  return fallback;
}

function readEnum(name, allowed, fallback) {
  const raw = readString(name, fallback);
  if (!allowed.includes(raw)) {
    warnings.push(`${name}="${raw}" must be one of ${allowed.join(', ')} - using ${fallback}.`);
    return fallback;
  }
  return raw;
}

function readList(name, fallback) {
  const raw = readString(name);
  if (!raw) return fallback;
  return raw
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
}

const nodeEnv = readEnum('NODE_ENV', ['development', 'test', 'production'], 'development');

/* ------------------------------------------------------------ LLM providers */

/**
 * Supported providers.
 *
 * `kind` selects the adapter: `openai-compatible` covers every vendor that speaks the
 * OpenAI Chat Completions protocol (one adapter, one dependency), while Anthropic and
 * Cohere have their own because their APIs genuinely differ.
 *
 * Model ids are defaults, not commitments - every one is overridable through the listed
 * environment variable. Vendors retire and rename models on their own schedule, so treat
 * a `AI_MODEL_NOT_FOUND` error as "set the env var", not "the integration is broken".
 * `GET /api/ai/providers` reports exactly which model each provider will use.
 *
 * `jsonMode` is the *best* structured-output mode to attempt. Adapters walk down from
 * there (schema -> loose JSON -> prompt-only) based on what the provider actually
 * accepts, so an optimistic value here is safe.
 */
const PROVIDER_CATALOGUE = [
  {
    id: 'anthropic',
    label: 'Anthropic Claude',
    kind: 'anthropic',
    apiKeyEnvVar: 'ANTHROPIC_API_KEY',
    modelEnvVar: 'ANTHROPIC_MODEL',
    defaultModel: 'claude-opus-5',
    jsonMode: 'json_schema',
    supportsTemperature: false,
    requiresApiKey: true,
    notes: 'Native SDK. Uses prompt caching and adaptive thinking.',
  },
  {
    id: 'openai',
    label: 'OpenAI GPT',
    kind: 'openai-compatible',
    apiKeyEnvVar: 'OPENAI_API_KEY',
    modelEnvVar: 'OPENAI_MODEL',
    defaultModel: 'gpt-5',
    defaultBaseUrl: 'https://api.openai.com/v1',
    baseUrlEnvVar: 'OPENAI_BASE_URL',
    jsonMode: 'json_schema',
    tokenParam: 'max_completion_tokens',
    // Current reasoning models reject any temperature but the default.
    supportsTemperature: false,
    requiresApiKey: true,
  },
  {
    id: 'google',
    label: 'Google Gemini',
    kind: 'openai-compatible',
    apiKeyEnvVar: 'GEMINI_API_KEY',
    modelEnvVar: 'GEMINI_MODEL',
    defaultModel: 'gemini-2.5-pro',
    // Google publishes an OpenAI-compatible surface, which avoids a second SDK.
    defaultBaseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai/',
    baseUrlEnvVar: 'GEMINI_BASE_URL',
    jsonMode: 'json_schema',
    tokenParam: 'max_tokens',
    supportsTemperature: true,
    requiresApiKey: true,
  },
  {
    id: 'mistral',
    label: 'Mistral AI',
    kind: 'openai-compatible',
    apiKeyEnvVar: 'MISTRAL_API_KEY',
    modelEnvVar: 'MISTRAL_MODEL',
    defaultModel: 'mistral-large-latest',
    defaultBaseUrl: 'https://api.mistral.ai/v1',
    baseUrlEnvVar: 'MISTRAL_BASE_URL',
    jsonMode: 'json_schema',
    tokenParam: 'max_tokens',
    supportsTemperature: true,
    requiresApiKey: true,
  },
  {
    id: 'groq',
    label: 'Groq',
    kind: 'openai-compatible',
    apiKeyEnvVar: 'GROQ_API_KEY',
    modelEnvVar: 'GROQ_MODEL',
    defaultModel: 'llama-3.3-70b-versatile',
    defaultBaseUrl: 'https://api.groq.com/openai/v1',
    baseUrlEnvVar: 'GROQ_BASE_URL',
    jsonMode: 'json_schema',
    tokenParam: 'max_tokens',
    supportsTemperature: true,
    requiresApiKey: true,
    notes: 'Open-weight models at low latency.',
  },
  {
    id: 'deepseek',
    label: 'DeepSeek',
    kind: 'openai-compatible',
    apiKeyEnvVar: 'DEEPSEEK_API_KEY',
    modelEnvVar: 'DEEPSEEK_MODEL',
    defaultModel: 'deepseek-chat',
    defaultBaseUrl: 'https://api.deepseek.com/v1',
    baseUrlEnvVar: 'DEEPSEEK_BASE_URL',
    // Loose JSON mode only - no schema enforcement, so the contract goes in the prompt.
    jsonMode: 'json_object',
    tokenParam: 'max_tokens',
    supportsTemperature: true,
    requiresApiKey: true,
  },
  {
    id: 'xai',
    label: 'xAI Grok',
    kind: 'openai-compatible',
    apiKeyEnvVar: 'XAI_API_KEY',
    modelEnvVar: 'XAI_MODEL',
    defaultModel: 'grok-4',
    defaultBaseUrl: 'https://api.x.ai/v1',
    baseUrlEnvVar: 'XAI_BASE_URL',
    jsonMode: 'json_schema',
    tokenParam: 'max_tokens',
    supportsTemperature: true,
    requiresApiKey: true,
  },
  {
    id: 'openrouter',
    label: 'OpenRouter',
    kind: 'openai-compatible',
    apiKeyEnvVar: 'OPENROUTER_API_KEY',
    modelEnvVar: 'OPENROUTER_MODEL',
    defaultModel: 'openai/gpt-5',
    defaultBaseUrl: 'https://openrouter.ai/api/v1',
    baseUrlEnvVar: 'OPENROUTER_BASE_URL',
    jsonMode: 'json_schema',
    tokenParam: 'max_tokens',
    supportsTemperature: true,
    requiresApiKey: true,
    notes: 'Gateway to many vendors - set OPENROUTER_MODEL to choose one.',
  },
  {
    id: 'cohere',
    label: 'Cohere',
    kind: 'cohere',
    apiKeyEnvVar: 'COHERE_API_KEY',
    modelEnvVar: 'COHERE_MODEL',
    defaultModel: 'command-a-03-2025',
    defaultBaseUrl: 'https://api.cohere.com',
    baseUrlEnvVar: 'COHERE_BASE_URL',
    jsonMode: 'json_schema',
    tokenParam: 'max_tokens',
    supportsTemperature: true,
    requiresApiKey: true,
  },
  {
    id: 'ollama',
    label: 'Ollama (local)',
    kind: 'openai-compatible',
    apiKeyEnvVar: 'OLLAMA_API_KEY',
    modelEnvVar: 'OLLAMA_MODEL',
    defaultModel: 'llama3.1',
    defaultBaseUrl: 'http://127.0.0.1:11434/v1',
    baseUrlEnvVar: 'OLLAMA_BASE_URL',
    jsonMode: 'json_object',
    tokenParam: 'max_tokens',
    supportsTemperature: true,
    requiresApiKey: false,
    // No credential to detect, so it is only considered available when explicitly
    // pointed at - otherwise auto-selection would pick a server that is not running.
    enabledEnvVars: ['OLLAMA_BASE_URL', 'OLLAMA_MODEL', 'OLLAMA_ENABLED'],
    notes: 'Runs models locally. Set OLLAMA_BASE_URL to enable.',
  },
  {
    id: 'sample',
    label: 'Deterministic sample',
    kind: 'sample',
    defaultModel: 'deterministic-sample',
    requiresApiKey: false,
    alwaysAvailable: true,
    notes: 'No model call. Used when no provider is configured, and as the offline baseline.',
  },
];

const DEFAULT_PROVIDER_PRIORITY = [
  'anthropic',
  'openai',
  'google',
  'mistral',
  'groq',
  'xai',
  'deepseek',
  'openrouter',
  'cohere',
  'ollama',
];

const sharedTimeoutMs = readInt('AI_TIMEOUT_MS', 90000, { min: 5000, max: 600000 });
const sharedMaxRetries = readInt('AI_MAX_RETRIES', 2, { min: 0, max: 5 });
const sharedMaxTokens = readInt('AI_MAX_TOKENS', 16000, { min: 1024, max: 128000 });
const sharedTemperature = readFloat('AI_TEMPERATURE', 0.2, { min: 0, max: 2 });

/** Resolves one catalogue entry against the environment. */
function resolveProviderDefinition(entry) {
  const apiKey = entry.apiKeyEnvVar ? readString(entry.apiKeyEnvVar) : '';
  const baseUrl = entry.baseUrlEnvVar
    ? readString(entry.baseUrlEnvVar, entry.defaultBaseUrl || '')
    : entry.defaultBaseUrl || '';

  let configured;
  if (entry.alwaysAvailable) configured = true;
  else if (Array.isArray(entry.enabledEnvVars)) configured = entry.enabledEnvVars.some(isSet);
  else configured = Boolean(apiKey);

  const perProviderMaxTokens = entry.id
    ? readInt(`${entry.id.toUpperCase()}_MAX_TOKENS`, sharedMaxTokens, { min: 256, max: 128000 })
    : sharedMaxTokens;

  return Object.freeze({
    id: entry.id,
    label: entry.label,
    kind: entry.kind,
    notes: entry.notes,
    configured,
    requiresApiKey: Boolean(entry.requiresApiKey),
    apiKey,
    apiKeyEnvVar: entry.apiKeyEnvVar || null,
    modelEnvVar: entry.modelEnvVar || null,
    model: entry.modelEnvVar ? readString(entry.modelEnvVar, entry.defaultModel) : entry.defaultModel,
    defaultModel: entry.defaultModel,
    baseUrl,
    jsonMode: entry.jsonMode || 'none',
    tokenParam: entry.tokenParam || 'max_tokens',
    supportsTemperature: Boolean(entry.supportsTemperature),
    temperature: sharedTemperature,
    maxTokens: perProviderMaxTokens,
    timeoutMs: sharedTimeoutMs,
    maxRetries: sharedMaxRetries,
    extraHeaders:
      entry.id === 'openrouter'
        ? {
            // OpenRouter attributes traffic using these; harmless elsewhere.
            'HTTP-Referer': readString('OPENROUTER_SITE_URL', 'http://localhost:3000'),
            'X-Title': readString('OPENROUTER_APP_NAME', 'RentVerse'),
          }
        : undefined,
    // Anthropic-only knobs.
    effort: readEnum('AI_EFFORT', ['low', 'medium', 'high', 'xhigh', 'max'], 'medium'),
    refusalFallback: readBool('AI_REFUSAL_FALLBACK', true),
  });
}

const providers = Object.freeze(
  PROVIDER_CATALOGUE.reduce((accumulator, entry) => {
    accumulator[entry.id] = resolveProviderDefinition(entry);
    return accumulator;
  }, Object.create(null))
);

const providerIds = PROVIDER_CATALOGUE.map((entry) => entry.id);

// Order used for auto-selection and failover.
const requestedOrder = readList('AI_PROVIDER_ORDER', DEFAULT_PROVIDER_PRIORITY);
const unknownInOrder = requestedOrder.filter((id) => !providerIds.includes(id));
if (unknownInOrder.length > 0) {
  warnings.push(`AI_PROVIDER_ORDER lists unknown provider(s): ${unknownInOrder.join(', ')}.`);
}
const providerOrder = requestedOrder.filter((id) => providerIds.includes(id));

const configuredProviders = providerOrder.filter((id) => providers[id].configured);

// `mock` is accepted as a friendlier alias for the deterministic sample provider.
if (readString('AI_PROVIDER').toLowerCase() === 'mock') process.env.AI_PROVIDER = 'sample';

const requestedProvider = readEnum('AI_PROVIDER', ['auto', ...providerIds], 'auto');

let primaryProvider;
if (requestedProvider === 'auto') {
  primaryProvider = configuredProviders[0] || 'sample';
} else {
  primaryProvider = requestedProvider;
  if (!providers[requestedProvider].configured) {
    warnings.push(
      `AI_PROVIDER=${requestedProvider} but it is not configured ` +
        `(set ${providers[requestedProvider].apiKeyEnvVar || 'its environment variables'}). Requests to it will fail.`
    );
  }
}

const config = Object.freeze({
  nodeEnv,
  isProduction: nodeEnv === 'production',
  isTest: nodeEnv === 'test',
  port: readInt('PORT', 3099, { min: 0, max: 65535 }),

  // Browsers only need CORS when the client is served from a different origin than the
  // API. In development the CRA dev server proxies /api, so this is mostly a safety net.
  corsOrigins: readList('CORS_ORIGINS', ['http://localhost:3000', 'http://127.0.0.1:3000']),

  jsonBodyLimit: readString('JSON_BODY_LIMIT', '100kb'),

  mongoUri: readString('MONGO_URI'),

  ai: Object.freeze({
    provider: primaryProvider,
    requestedProvider,
    providerOrder: Object.freeze(providerOrder),
    configuredProviders: Object.freeze(configuredProviders),
    providers,
    providerIds: Object.freeze(providerIds),

    // Try the next configured provider when one errors or its output fails the gate.
    failover: readBool('AI_FAILOVER', true),
    maxFailoverProviders: readInt('AI_MAX_FAILOVER_PROVIDERS', 3, { min: 1, max: 10 }),
    // How many providers a single /compare request may fan out to.
    maxCompareProviders: readInt('AI_MAX_COMPARE_PROVIDERS', 6, { min: 2, max: 10 }),

    // One automatic regeneration attempt when the quality gate rejects an output.
    maxQualityAttempts: readInt('AI_MAX_QUALITY_ATTEMPTS', 2, { min: 1, max: 4 }),

    cacheTtlMs: readInt('AI_CACHE_TTL_MS', 10 * 60 * 1000, { min: 0, max: 24 * 60 * 60 * 1000 }),
    cacheMaxEntries: readInt('AI_CACHE_MAX_ENTRIES', 200, { min: 1, max: 10000 }),

    rateLimit: Object.freeze({
      windowMs: readInt('AI_RATE_LIMIT_WINDOW_MS', 60 * 1000, { min: 1000, max: 60 * 60 * 1000 }),
      max: readInt('AI_RATE_LIMIT_MAX', 20, { min: 1, max: 10000 }),
      compareMax: readInt('AI_COMPARE_RATE_LIMIT_MAX', 5, { min: 1, max: 1000 }),
    }),
  }),

  cloudinary: Object.freeze({
    name: readString('CLOUDINARY_NAME'),
    apiKey: readString('CLOUDINARY_API_KEY'),
    apiSecret: readString('CLOUDINARY_API_SECRET'),
  }),

  warnings: Object.freeze(warnings),
});

module.exports = config;
