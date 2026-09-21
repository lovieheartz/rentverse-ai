'use strict';

process.env.NODE_ENV = 'test';
process.env.AI_PROVIDER = 'sample';

const test = require('node:test');
const assert = require('node:assert/strict');

const { getRawPropertyById } = require('../services/propertyService');
const {
  generatePropertyAnalysis,
  registerProvider,
  analysisCache,
  buildCacheKey,
} = require('../ai/analysisService');
const sampleProvider = require('../ai/providers/sampleProvider');

const PROPERTY = getRawPropertyById('1');
const PROFILE = { budgetUsd: 5000, horizonYears: 7, riskTolerance: 'moderate', goal: 'income' };

/** A provider that always emits a figure absent from the source data. */
registerProvider('always-hallucinates', {
  async generateAnalysis(facts) {
    const { analysis } = await sampleProvider.generateAnalysis(facts);
    analysis.summary = `${analysis.summary} Comparable units yield 23.7% annually.`;
    return { analysis, providerMeta: { source: 'test-stub', model: 'stub', latencyMs: 0 } };
  },
});

/** Fails the first attempt, then honours the corrections it is given on the retry. */
let firstAttemptCalls = 0;
registerProvider('recovers-on-retry', {
  async generateAnalysis(facts, options = {}) {
    const { analysis } = await sampleProvider.generateAnalysis(facts);
    const isRetry = Array.isArray(options.corrections) && options.corrections.length > 0;

    if (!isRetry) {
      firstAttemptCalls += 1;
      analysis.disclaimer = 'Returns are strong and the outlook is positive.';
    }

    return { analysis, providerMeta: { source: 'test-stub', model: 'stub', latencyMs: 0 } };
  },
});

test.beforeEach(() => analysisCache.clear());

test('a clean analysis passes the gate and is returned with its scorecard', async () => {
  const result = await generatePropertyAnalysis({ property: PROPERTY, investorProfile: PROFILE });

  assert.equal(result.evaluation.passed, true);
  assert.equal(result.evaluation.score, 1);
  assert.equal(result.meta.source, 'sample');
  assert.equal(result.meta.attempts, 1);
  assert.equal(result.meta.regenerated, false);
  assert.equal(result.meta.cached, false);
  assert.equal(result.analysis.suitability.verdict !== 'not_assessed', true);
  assert.equal(result.evaluation.checks.length, 12);
});

test('an identical request is served from cache', async () => {
  const first = await generatePropertyAnalysis({ property: PROPERTY, investorProfile: PROFILE });
  const second = await generatePropertyAnalysis({ property: PROPERTY, investorProfile: PROFILE });

  assert.equal(first.meta.cached, false);
  assert.equal(second.meta.cached, true);
  assert.equal(typeof second.meta.cacheAgeMs, 'number');
  assert.deepEqual(second.analysis, first.analysis);
});

test('refresh bypasses the cache', async () => {
  await generatePropertyAnalysis({ property: PROPERTY, investorProfile: PROFILE });
  const refreshed = await generatePropertyAnalysis({
    property: PROPERTY,
    investorProfile: PROFILE,
    refresh: true,
  });

  assert.equal(refreshed.meta.cached, false);
});

test('a different investor profile is a different cache entry', async () => {
  await generatePropertyAnalysis({ property: PROPERTY, investorProfile: PROFILE });
  const other = await generatePropertyAnalysis({
    property: PROPERTY,
    investorProfile: { ...PROFILE, goal: 'appreciation' },
  });

  assert.equal(other.meta.cached, false);
});

test('cache keys ignore profile key order', () => {
  const a = buildCacheKey('1', { budgetUsd: 100, goal: 'income' }, 'sample');
  const b = buildCacheKey('1', { goal: 'income', budgetUsd: 100 }, 'sample');

  assert.equal(a, b);
});

test('the gate regenerates once and accepts the corrected attempt', async () => {
  firstAttemptCalls = 0;

  const result = await generatePropertyAnalysis({
    property: PROPERTY,
    investorProfile: PROFILE,
    providerName: 'recovers-on-retry',
  });

  assert.equal(firstAttemptCalls, 1, 'the first attempt must have been made and rejected');
  assert.equal(result.meta.attempts, 2);
  assert.equal(result.meta.regenerated, true);
  assert.equal(result.evaluation.passed, true);
});

test('output that keeps failing is withheld rather than returned', async () => {
  // Failover is pinned off so the gate is tested in isolation; the failover behaviour
  // itself is covered by the next test.
  await assert.rejects(
    () =>
      generatePropertyAnalysis({
        property: PROPERTY,
        investorProfile: PROFILE,
        providerName: 'always-hallucinates',
        allowFailover: false,
      }),
    (error) => {
      assert.equal(error.statusCode, 502);
      assert.equal(error.code, 'AI_OUTPUT_REJECTED');
      assert.equal(error.details.failures.length, 1);
      assert.equal(error.details.failures[0].attempts, 2);
      assert.ok(
        error.details.failures[0].failedChecks.some((check) => check.id === 'numeric_grounding')
      );
      return true;
    }
  );
});

test('a provider whose output cannot pass the gate is failed over', async () => {
  const result = await generatePropertyAnalysis({
    property: PROPERTY,
    investorProfile: PROFILE,
    providerName: 'always-hallucinates',
    allowFailover: true,
  });

  // The chain moved on and the response says so rather than pretending otherwise.
  assert.equal(result.evaluation.passed, true);
  assert.equal(result.meta.requestedProvider, 'always-hallucinates');
  assert.equal(result.meta.failedOver, true);
  assert.equal(result.meta.source, 'sample');
  assert.equal(result.meta.failoverTrail.length, 1);
  assert.equal(result.meta.failoverTrail[0].provider, 'always-hallucinates');
  assert.equal(result.meta.failoverTrail[0].code, 'AI_OUTPUT_REJECTED');
});

test('a provider that throws is failed over', async () => {
  registerProvider('always-throws', {
    async generateAnalysis() {
      throw Object.assign(new Error('upstream exploded'), { code: 'AI_PROVIDER_ERROR' });
    },
  });

  const result = await generatePropertyAnalysis({
    property: PROPERTY,
    providerName: 'always-throws',
    allowFailover: true,
  });

  assert.equal(result.meta.source, 'sample');
  assert.equal(result.meta.failedOver, true);
  assert.equal(result.meta.failoverTrail[0].message, 'upstream exploded');
});

test('a rejected analysis is never cached', async () => {
  await assert.rejects(() =>
    generatePropertyAnalysis({
      property: PROPERTY,
      investorProfile: PROFILE,
      providerName: 'always-hallucinates',
      allowFailover: false,
    })
  );

  assert.equal(analysisCache.size, 0);
});

test('an unknown provider name is reported as a configuration failure', async () => {
  await assert.rejects(
    () => generatePropertyAnalysis({ property: PROPERTY, providerName: 'not-a-provider' }),
    (error) => {
      assert.equal(error.code, 'AI_PROVIDER_UNKNOWN');
      return true;
    }
  );
});

test('without a profile the analysis abstains from a suitability verdict', async () => {
  const result = await generatePropertyAnalysis({ property: PROPERTY });

  assert.equal(result.analysis.suitability.verdict, 'not_assessed');
  assert.equal(result.evaluation.passed, true);
});

test('registerProvider rejects a malformed provider', () => {
  assert.throws(() => registerProvider('broken', {}), TypeError);
});
