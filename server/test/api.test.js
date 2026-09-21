'use strict';

// Configuration is read once at require time, so it must be set before `app` is loaded.
process.env.NODE_ENV = 'test';
process.env.AI_PROVIDER = 'sample';
process.env.AI_RATE_LIMIT_MAX = '200';
delete process.env.MONGO_URI;

const test = require('node:test');
const assert = require('node:assert/strict');

const app = require('../app');

/**
 * End-to-end tests over real HTTP.
 *
 * The app is bound to an ephemeral port and driven with `fetch`, so these cover the parts
 * unit tests cannot: middleware ordering, the response envelope, status codes, and the
 * fact that an error reaches the central handler as JSON rather than an HTML stack trace.
 */

let server;
let baseUrl;

test.before(async () => {
  await new Promise((resolve) => {
    server = app.listen(0, '127.0.0.1', resolve);
  });
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

test.after(async () => {
  // `fetch` keeps connections alive, and `close()` waits for them - without this the
  // test process hangs after the last assertion.
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
});

async function call(path, init) {
  const response = await fetch(`${baseUrl}${path}`, init);
  const body = await response.json();
  return { response, body };
}

const postAnalysis = (payload) =>
  call('/api/ai/property-analysis', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

/* ------------------------------------------------------------------- health */

test('GET /api/health reports how the server is wired', async () => {
  const { response, body } = await call('/api/health');

  assert.equal(response.status, 200);
  assert.equal(body.success, true);
  assert.equal(body.data.status, 'ok');
  assert.equal(body.data.ai.primary, 'sample');
  assert.equal(body.data.ai.usingSampleFallback, true);
  assert.ok(Array.isArray(body.data.ai.available));
  assert.equal(body.data.database.configured, false);
  assert.ok(body.data.catalogue.propertyCount > 0);
  assert.ok(body.meta.requestId);
});

/* --------------------------------------------------------------- properties */

test('GET /api/properties returns a paginated envelope', async () => {
  const { response, body } = await call('/api/properties?limit=2&sortBy=priceAsc');

  assert.equal(response.status, 200);
  assert.equal(body.success, true);
  assert.equal(body.data.length, 2);
  assert.equal(body.meta.pagination.limit, 2);
  assert.equal(body.meta.pagination.hasNextPage, true);
  assert.equal(body.meta.appliedFilters.sortBy, 'priceAsc');
  assert.ok(body.data[0].price.usd <= body.data[1].price.usd);
});

test('GET /api/properties/featured returns only featured listings', async () => {
  const { response, body } = await call('/api/properties/featured?limit=2');

  assert.equal(response.status, 200);
  assert.equal(body.data.length, 2);
  assert.ok(body.data.every((item) => item.featured === true));
});

test('GET /api/properties/:id returns the requested listing', async () => {
  const { response, body } = await call('/api/properties/3');

  assert.equal(response.status, 200);
  assert.equal(body.data.id, '3');
  assert.ok(body.data.financials.netMonthlyRentUsd > 0);
  assert.ok(Array.isArray(body.data.images));
});

test('GET /api/properties/:id returns a structured 404 for an unknown id', async () => {
  const { response, body } = await call('/api/properties/4242');

  assert.equal(response.status, 404);
  assert.equal(body.success, false);
  assert.equal(body.error.code, 'NOT_FOUND');
  assert.equal(body.error.details.propertyId, '4242');
  assert.ok(body.meta.requestId);
});

test('an out-of-range query parameter is rejected with field-level detail', async () => {
  const { response, body } = await call('/api/properties?limit=500');

  assert.equal(response.status, 400);
  assert.equal(body.error.code, 'VALIDATION_FAILED');
  assert.equal(body.error.details[0].field, 'limit');
  assert.equal(body.error.details[0].code, 'out_of_range');
});

test('a misspelled filter is rejected rather than silently ignored', async () => {
  const { response, body } = await call('/api/properties?minROI=5');

  assert.equal(response.status, 400);
  assert.equal(body.error.details[0].code, 'unknown_field');
});

test('an inverted range is rejected by the cross-field check', async () => {
  const { response, body } = await call('/api/properties?minPriceUsd=2000000&maxPriceUsd=100000');

  assert.equal(response.status, 400);
  assert.equal(body.error.code, 'VALIDATION_FAILED');
  assert.equal(body.error.details[0].field, 'minPriceUsd');
});

test('a malformed id is rejected before any lookup', async () => {
  const { response, body } = await call('/api/properties/not%20an%20id!');

  assert.equal(response.status, 400);
  assert.equal(body.error.details[0].code, 'pattern_mismatch');
});

/* ----------------------------------------------------------- ai: analysis */

test('GET /api/ai/status describes the resolved provider', async () => {
  const { response, body } = await call('/api/ai/status');

  assert.equal(response.status, 200);
  assert.equal(body.data.primary, 'sample');
  assert.equal(body.data.failover, true);
  assert.equal(typeof body.data.configuredCount, 'number');
});

test('GET /api/ai/providers lists every integrated provider', async () => {
  const { response, body } = await call('/api/ai/providers');

  assert.equal(response.status, 200);
  assert.ok(Array.isArray(body.data));

  // Ten LLM vendors plus the deterministic sample provider.
  assert.ok(body.data.length >= 11, `expected 11+ providers, got ${body.data.length}`);

  for (const expected of ['anthropic', 'openai', 'google', 'mistral', 'groq', 'deepseek', 'xai', 'cohere']) {
    const entry = body.data.find((provider) => provider.id === expected);
    assert.ok(entry, `${expected} must be registered`);
    assert.ok(entry.label, `${expected} must have a label`);
    assert.ok(entry.model, `${expected} must resolve to a model id`);
    assert.ok(entry.apiKeyEnvVar, `${expected} must document its API key variable`);
  }

  // The payload names the env var to set but must never carry a credential value.
  for (const entry of body.data) {
    assert.ok(!('apiKey' in entry), `${entry.id} must not expose an apiKey field`);
    assert.ok(!('key' in entry), `${entry.id} must not expose a key field`);
  }
  assert.equal(body.meta.primary, 'sample');
  assert.ok(Array.isArray(body.meta.priorityOrder));
});

test('an unknown provider override is rejected by validation', async () => {
  const { response, body } = await postAnalysis({ propertyId: '1', provider: 'skynet' });

  assert.equal(response.status, 400);
  assert.equal(body.error.code, 'VALIDATION_FAILED');
  assert.equal(body.error.details[0].field, 'provider');
  assert.equal(body.error.details[0].code, 'not_allowed');
});

test('an explicit provider override is honoured and reported', async () => {
  const { response, body } = await postAnalysis({
    propertyId: '4',
    provider: 'sample',
    refresh: true,
  });

  assert.equal(response.status, 200);
  assert.equal(body.data.provider, 'sample');
  assert.equal(body.meta.requestedProvider, 'sample');
  assert.equal(body.meta.failedOver, false);
});

test('comparison refuses to run against a single provider', async () => {
  // Only the sample provider is available in tests, so a comparison is not meaningful.
  const { response, body } = await call('/api/ai/property-analysis/compare', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ propertyId: '1' }),
  });

  assert.equal(response.status, 400);
  assert.equal(body.error.code, 'BAD_REQUEST');
  assert.match(body.error.message, /at least two providers/i);
});

test('comparison validates the provider list', async () => {
  const { response, body } = await call('/api/ai/property-analysis/compare', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ propertyId: '1', providers: ['sample', 'not-a-vendor'] }),
  });

  assert.equal(response.status, 400);
  assert.ok(body.error.details.some((detail) => detail.field === 'providers[1]'));
});

test('POST /api/ai/property-analysis returns an analysis with its scorecard', async () => {
  const { response, body } = await postAnalysis({
    propertyId: '1',
    refresh: true,
    investorProfile: { budgetUsd: 2500, horizonYears: 6, riskTolerance: 'moderate', goal: 'income' },
  });

  assert.equal(response.status, 200);
  assert.equal(body.success, true);
  assert.equal(body.data.propertyId, '1');
  assert.equal(body.data.provider, 'sample');
  assert.equal(body.data.model, 'deterministic-sample');

  const { analysis } = body.data;
  assert.ok(analysis.summary.length > 40);
  assert.ok(analysis.risks.length >= 2);
  assert.ok(analysis.keyMetrics.length >= 3);
  assert.match(analysis.disclaimer, /not financial advice/i);

  assert.equal(body.meta.evaluation.passed, true);
  assert.equal(body.meta.evaluation.score, 1);
  assert.equal(body.meta.evaluation.checks.length, 12);
  assert.ok(response.headers.get('x-request-id'));
});

test('a repeated analysis request is served from cache', async () => {
  const payload = {
    propertyId: '2',
    investorProfile: { budgetUsd: 1000, horizonYears: 4, riskTolerance: 'conservative', goal: 'income' },
  };

  const first = await postAnalysis({ ...payload, refresh: true });
  const second = await postAnalysis(payload);

  assert.equal(first.body.meta.cached, false);
  assert.equal(second.body.meta.cached, true);
});

test('an analysis request for an unknown property returns 404', async () => {
  const { response, body } = await postAnalysis({ propertyId: '9999' });

  assert.equal(response.status, 404);
  assert.equal(body.error.code, 'NOT_FOUND');
});

test('an analysis request without a property id is rejected', async () => {
  const { response, body } = await postAnalysis({});

  assert.equal(response.status, 400);
  assert.equal(body.error.code, 'VALIDATION_FAILED');
  assert.equal(body.error.details[0].field, 'propertyId');
  assert.equal(body.error.details[0].code, 'required');
});

test('an invalid investor profile is rejected with nested field paths', async () => {
  const { response, body } = await postAnalysis({
    propertyId: '1',
    investorProfile: { budgetUsd: 1, horizonYears: 99, riskTolerance: 'yolo' },
  });

  assert.equal(response.status, 400);
  const fields = body.error.details.map((detail) => detail.field);
  assert.ok(fields.includes('investorProfile.budgetUsd'));
  assert.ok(fields.includes('investorProfile.horizonYears'));
  assert.ok(fields.includes('investorProfile.riskTolerance'));
});

test('an unknown field in the body is rejected', async () => {
  const { response, body } = await postAnalysis({ propertyId: '1', tone: 'bullish' });

  assert.equal(response.status, 400);
  assert.ok(body.error.details.some((detail) => detail.field === 'tone'));
});

test('a malformed JSON body produces a structured 400, not an HTML error page', async () => {
  const response = await fetch(`${baseUrl}/api/ai/property-analysis`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{"propertyId": ',
  });
  const body = await response.json();

  assert.equal(response.status, 400);
  assert.equal(body.error.code, 'BAD_REQUEST');
});

/* ------------------------------------------------------- routing behaviour */

test('an unknown API path returns JSON, not the SPA shell', async () => {
  const { response, body } = await call('/api/does-not-exist');

  assert.equal(response.status, 404);
  assert.equal(response.headers.get('content-type')?.includes('application/json'), true);
  assert.equal(body.error.code, 'NOT_FOUND');
});

test('legacy Mongo-backed routes fail fast while the database is unconfigured', async () => {
  const { response, body } = await call('/api/product/products');

  assert.equal(response.status, 503);
  assert.equal(body.error.code, 'DATABASE_UNAVAILABLE');
});

test('an inbound request id is echoed back for trace continuity', async () => {
  const { response, body } = await call('/api/health', {
    headers: { 'X-Request-Id': 'trace-abc-123' },
  });

  assert.equal(response.headers.get('x-request-id'), 'trace-abc-123');
  assert.equal(body.meta.requestId, 'trace-abc-123');
});

test('a hostile inbound request id is replaced rather than reflected', async () => {
  const { body } = await call('/api/health', {
    headers: { 'X-Request-Id': '<script>alert(1)</script>' },
  });

  assert.notEqual(body.meta.requestId, '<script>alert(1)</script>');
  assert.match(body.meta.requestId, /^[0-9a-f-]{36}$/);
});
