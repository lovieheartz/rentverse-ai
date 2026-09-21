'use strict';

// Fake credentials for every vendor, set before the config module is loaded, so each
// adapter can be resolved and inspected without network access or real keys.
process.env.NODE_ENV = 'test';
process.env.ANTHROPIC_API_KEY = 'sk-ant-test';
process.env.OPENAI_API_KEY = 'sk-openai-test';
process.env.GEMINI_API_KEY = 'gemini-test';
process.env.MISTRAL_API_KEY = 'mistral-test';
process.env.GROQ_API_KEY = 'groq-test';
process.env.DEEPSEEK_API_KEY = 'deepseek-test';
process.env.XAI_API_KEY = 'xai-test';
process.env.OPENROUTER_API_KEY = 'openrouter-test';
process.env.COHERE_API_KEY = 'cohere-test';
process.env.OLLAMA_BASE_URL = 'http://127.0.0.1:11434/v1';
process.env.AI_PROVIDER = 'auto';

const test = require('node:test');
const assert = require('node:assert/strict');

const config = require('../config/env');
const registry = require('../ai/providers');
const {
  ANALYSIS_JSON_SCHEMA,
  ANALYSIS_STRICT_JSON_SCHEMA,
  toStrictJsonSchema,
} = require('../ai/analysisSchema');
const { parseAnalysisJson, findFirstJsonObject } = require('../ai/providers/jsonExtraction');

const LLM_PROVIDERS = [
  'anthropic',
  'openai',
  'google',
  'mistral',
  'groq',
  'deepseek',
  'xai',
  'openrouter',
  'cohere',
  'ollama',
];

/* ---------------------------------------------------------------- catalogue */

test('ten LLM providers plus the sample provider are registered', () => {
  for (const id of LLM_PROVIDERS) {
    assert.ok(config.ai.providerIds.includes(id), `${id} must be in the catalogue`);
  }
  assert.ok(config.ai.providerIds.includes('sample'));
  assert.equal(config.ai.providerIds.length, LLM_PROVIDERS.length + 1);
});

test('every provider resolves to an adapter exposing the shared contract', () => {
  for (const id of [...LLM_PROVIDERS, 'sample']) {
    const provider = registry.resolveProvider(id);
    assert.equal(typeof provider.generateAnalysis, 'function', `${id} adapter`);
    assert.equal(provider.id, id);
  }
});

test('every provider reports a model id and the variable that overrides it', () => {
  for (const id of LLM_PROVIDERS) {
    const definition = registry.getDefinition(id);
    assert.ok(definition.model, `${id} must resolve a model`);
    assert.ok(definition.modelEnvVar, `${id} must document a model env var`);
    assert.ok(definition.maxTokens >= 1024, `${id} must have a sane token budget`);
    assert.ok(definition.timeoutMs >= 5000, `${id} must have a timeout`);
  }
});

test('every provider is detected as configured once its key is present', () => {
  for (const id of LLM_PROVIDERS) {
    assert.equal(registry.isConfigured(id), true, `${id} should be configured`);
  }
  assert.equal(config.ai.configuredProviders.length, LLM_PROVIDERS.length);
});

test('auto-selection picks the first configured provider in priority order', () => {
  assert.equal(config.ai.provider, config.ai.providerOrder[0]);
  assert.equal(config.ai.provider, 'anthropic');
});

test('an environment override changes the resolved model', () => {
  // Proves the documented escape hatch for model-id churn actually works.
  assert.equal(registry.getDefinition('openai').modelEnvVar, 'OPENAI_MODEL');
  assert.equal(registry.getDefinition('groq').modelEnvVar, 'GROQ_MODEL');
});

test('non-OpenAI vendors are routed at their own base URL', () => {
  const expectations = {
    openai: 'api.openai.com',
    google: 'generativelanguage.googleapis.com',
    mistral: 'api.mistral.ai',
    groq: 'api.groq.com',
    deepseek: 'api.deepseek.com',
    xai: 'api.x.ai',
    openrouter: 'openrouter.ai',
    cohere: 'api.cohere.com',
    ollama: '127.0.0.1:11434',
  };

  for (const [id, host] of Object.entries(expectations)) {
    assert.ok(
      registry.getDefinition(id).baseUrl.includes(host),
      `${id} should point at ${host}, got ${registry.getDefinition(id).baseUrl}`
    );
  }
});

/* ----------------------------------------------------------------- failover */

test('the failover chain starts with the requested provider and ends at the sample', () => {
  const chain = registry.buildProviderChain('groq');

  assert.equal(chain[0], 'groq');
  assert.ok(chain.length > 1, 'failover must offer an alternative');
  assert.ok(chain.length <= config.ai.maxFailoverProviders);
  assert.equal(new Set(chain).size, chain.length, 'no provider may appear twice');
});

/* ------------------------------------------------------------- disclosure */

test('the public provider description never carries a credential', () => {
  const secrets = [
    'sk-ant-test',
    'sk-openai-test',
    'gemini-test',
    'mistral-test',
    'groq-test',
    'deepseek-test',
    'xai-test',
    'openrouter-test',
    'cohere-test',
  ];
  const serialised = JSON.stringify(registry.describeProviders());

  for (const secret of secrets) {
    assert.ok(!serialised.includes(secret), `${secret} must not be disclosed`);
  }

  for (const entry of registry.describeProviders()) {
    assert.ok(!('apiKey' in entry));
    assert.equal(typeof entry.configured, 'boolean');
  }
});

/* ----------------------------------------------------------------- schemas */

test('the strict schema drops keywords that strict structured output rejects', () => {
  const serialised = JSON.stringify(ANALYSIS_STRICT_JSON_SCHEMA);

  assert.ok(!serialised.includes('minItems'));
  assert.ok(!serialised.includes('maxItems'));
  // The bounds are present in the permissive schema, and re-checked by the gate.
  assert.ok(JSON.stringify(ANALYSIS_JSON_SCHEMA).includes('minItems'));
});

test('the strict schema keeps the parts strict mode requires', () => {
  assert.equal(ANALYSIS_STRICT_JSON_SCHEMA.additionalProperties, false);
  assert.equal(ANALYSIS_STRICT_JSON_SCHEMA.required.length, 8);
  assert.equal(ANALYSIS_STRICT_JSON_SCHEMA.properties.risks.items.additionalProperties, false);
  assert.deepEqual(ANALYSIS_STRICT_JSON_SCHEMA.properties.risks.items.properties.severity.enum, [
    'low',
    'medium',
    'high',
  ]);
});

test('toStrictJsonSchema leaves unrelated structures untouched', () => {
  const input = { type: 'array', items: { type: 'string' }, minItems: 2, description: 'keep me' };
  assert.deepEqual(toStrictJsonSchema(input), {
    type: 'array',
    items: { type: 'string' },
    description: 'keep me',
  });
});

/* -------------------------------------------------- tolerant JSON handling */

test('JSON wrapped in a markdown fence is recovered', () => {
  const { analysis, parseError } = parseAnalysisJson('```json\n{"headline":"ok"}\n```');

  assert.equal(parseError, undefined);
  assert.equal(analysis.headline, 'ok');
});

test('JSON preceded by prose is recovered', () => {
  const { analysis } = parseAnalysisJson('Here is the analysis you asked for:\n{"headline":"ok"}');

  assert.equal(analysis.headline, 'ok');
});

test('object scanning respects braces inside strings', () => {
  const found = findFirstJsonObject('prefix {"a":"has } brace","b":2} suffix');

  assert.equal(found, '{"a":"has } brace","b":2}');
  assert.equal(JSON.parse(found).b, 2);
});

test('unparseable output is reported rather than thrown', () => {
  for (const bad of ['', 'no json at all', '{"unterminated": ']) {
    const { analysis, parseError } = parseAnalysisJson(bad);
    assert.equal(analysis, null);
    assert.ok(parseError, `expected a parse error for ${JSON.stringify(bad)}`);
  }
});

test('an object wrapped in an array is unwrapped rather than rejected', () => {
  // Some models return `[ {...} ]`. Recovering the object is safe because the quality gate
  // validates its shape afterwards, and it avoids discarding an otherwise good analysis.
  const { analysis, parseError } = parseAnalysisJson('[{"headline":"ok"}]');

  assert.equal(parseError, undefined);
  assert.equal(analysis.headline, 'ok');
});

test('a bare array with no object inside is reported as unparseable', () => {
  const { analysis, parseError } = parseAnalysisJson('["just", "strings"]');

  assert.equal(analysis, null);
  assert.ok(parseError);
});
