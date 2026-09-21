'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { getRawPropertyById } = require('../services/propertyService');
const { buildAnalysisFacts } = require('../ai/analysisFacts');
const { evaluateAnalysis } = require('../ai/evaluation/evaluate');
const { isGrounded, extractNumbers } = require('../ai/evaluation/checks');
const sampleProvider = require('../ai/providers/sampleProvider');

/**
 * These tests are the ones that matter most in this suite.
 *
 * A check suite that passes everything is indistinguishable from no check suite at all,
 * so each critical check gets a case that *must* fail it. Without these, a regression
 * that quietly disables a check would never be noticed - the offline eval would keep
 * reporting 100%.
 */

const PROPERTY = getRawPropertyById('1');
const PROFILE = { budgetUsd: 5000, horizonYears: 7, riskTolerance: 'moderate', goal: 'income' };
const FACTS = buildAnalysisFacts(PROPERTY, PROFILE);

let baseline;

test.before(async () => {
  const { analysis } = await sampleProvider.generateAnalysis(FACTS);
  baseline = analysis;
});

/** Deep clone so each mutation starts from the known-good baseline. */
const clone = () => JSON.parse(JSON.stringify(baseline));

const evaluate = (analysis, facts = FACTS) => evaluateAnalysis({ analysis, facts });
const checkById = (result, id) => result.checks.find((check) => check.id === id);

test('the known-good baseline passes every check', () => {
  const result = evaluate(baseline);

  assert.equal(result.passed, true, JSON.stringify(result.summary));
  assert.equal(result.score, 1);
  assert.equal(result.summary.failed, 0);
});

test('output_parsed fails when the provider returned unparseable output', () => {
  const result = evaluateAnalysis({ analysis: null, facts: FACTS, parseError: 'Unexpected token }' });

  assert.equal(result.passed, false);
  assert.equal(checkById(result, 'output_parsed').passed, false);
});

test('numeric_grounding catches a hallucinated yield', () => {
  const analysis = clone();
  // 19.4% appears nowhere in the property data - exactly the failure this check exists for.
  analysis.summary = `${analysis.summary} The property delivers a net rental yield of 19.4%.`;

  const result = evaluate(analysis);
  const check = checkById(result, 'numeric_grounding');

  assert.equal(result.passed, false);
  assert.equal(check.passed, false);
  assert.ok(check.evidence.some((entry) => entry.startsWith('19.4')));
});

test('numeric_grounding catches an invented dollar amount', () => {
  const analysis = clone();
  analysis.keyMetrics[0].interpretation = 'Comparable homes nearby rent for $12,345 per month.';

  const result = evaluate(analysis);

  assert.equal(checkById(result, 'numeric_grounding').passed, false);
});

test('numeric_grounding accepts figures copied or sensibly rounded from the data', () => {
  const analysis = clone();
  const exact = PROPERTY.metrics.netYieldPct;
  const rounded = Math.round(exact);
  analysis.summary = `${analysis.summary} Net yield is ${exact}%, or about ${rounded}%.`;

  assert.equal(checkById(evaluate(analysis), 'numeric_grounding').passed, true);
});

test('isGrounded tolerates rounding but rejects fabrication', () => {
  const facts = new Set([5.78, 850000, 4817]);

  assert.equal(isGrounded(5.78, facts), true, 'exact match');
  assert.equal(isGrounded(5.8, facts), true, 'rounded to one decimal');
  assert.equal(isGrounded(6, facts), true, 'rounded to a whole number');
  assert.equal(isGrounded(9.5, facts), false, 'fabricated figure');
  assert.equal(isGrounded(999999, facts), false, 'fabricated figure');
  assert.equal(isGrounded(7, facts), true, 'small integers are always allowed');
});

test('extractNumbers handles currency, percentages and thousands separators', () => {
  assert.deepEqual(extractNumbers('$1,234,567 at 5.78% over 7 years'), [1234567, 5.78, 7]);
});

test('no_guarantee_language catches guaranteed-return phrasing', () => {
  for (const phrase of [
    'This investment offers a guaranteed 4.5% return.',
    'It is effectively a risk-free position.',
    'Investors are assured of monthly distributions.',
    'There is no risk to capital here.',
  ]) {
    const analysis = clone();
    analysis.summary = `${analysis.summary} ${phrase}`;

    const result = evaluate(analysis);
    assert.equal(result.passed, false, `expected rejection for: ${phrase}`);
    assert.equal(checkById(result, 'no_guarantee_language').passed, false);
  }
});

test('risk_coverage fails when risks are dropped or reduced to filler', () => {
  const tooFew = clone();
  tooFew.risks = [tooFew.risks[0]];
  assert.equal(checkById(evaluate(tooFew), 'risk_coverage').passed, false);

  const filler = clone();
  filler.risks = filler.risks.map((risk) => ({ ...risk, mitigation: 'None.' }));
  assert.equal(checkById(evaluate(filler), 'risk_coverage').passed, false);

  const restated = clone();
  restated.risks = restated.risks.map((risk) => ({ ...risk, mitigation: risk.risk }));
  assert.equal(checkById(evaluate(restated), 'risk_coverage').passed, false);
});

test('disclaimer_present fails when the not-advice wording is missing', () => {
  const analysis = clone();
  analysis.disclaimer = 'Past performance is indicative of strong future results.';

  const result = evaluate(analysis);

  assert.equal(result.passed, false);
  assert.equal(checkById(result, 'disclaimer_present').passed, false);
});

test('no_instruction_leak catches model self-reference and prompt scaffolding', () => {
  for (const phrase of [
    'As an AI language model, I cannot value property.',
    'Following the system prompt, here is the analysis.',
  ]) {
    const analysis = clone();
    analysis.headline = phrase;
    assert.equal(checkById(evaluate(analysis), 'no_instruction_leak').passed, false);
  }
});

test('profile_alignment fails when a supplied profile is ignored', () => {
  const analysis = clone();
  analysis.suitability = { verdict: 'not_assessed', rationale: 'No profile was supplied.' };

  const result = evaluate(analysis);

  assert.equal(result.passed, false);
  assert.equal(checkById(result, 'profile_alignment').passed, false);
});

test('profile_alignment fails when a verdict is asserted without a profile', () => {
  const factsWithoutProfile = buildAnalysisFacts(PROPERTY, {});
  const analysis = clone();
  analysis.suitability = { verdict: 'aligned', rationale: 'This suits the investor very well.' };

  const result = evaluate(analysis, factsWithoutProfile);

  assert.equal(checkById(result, 'profile_alignment').passed, false);
});

test('profile_alignment fails when the rationale never references the profile', () => {
  const analysis = clone();
  analysis.suitability = {
    verdict: 'aligned',
    rationale: 'The building is well located and recently constructed.',
  };

  assert.equal(checkById(evaluate(analysis), 'profile_alignment').passed, false);
});

test('schema_shape fails on a missing section or an invalid enum', () => {
  const missing = clone();
  delete missing.keyMetrics;
  assert.equal(checkById(evaluate(missing), 'schema_shape').passed, false);

  const badSeverity = clone();
  badSeverity.risks[0].severity = 'catastrophic';
  assert.equal(checkById(evaluate(badSeverity), 'schema_shape').passed, false);

  const badVerdict = clone();
  badVerdict.suitability.verdict = 'probably fine';
  assert.equal(checkById(evaluate(badVerdict), 'schema_shape').passed, false);
});

test('not_advice is a warning: it is reported but does not block the response', () => {
  const analysis = clone();
  analysis.summary = `${analysis.summary} We recommend you buy tokens in this listing.`;

  const result = evaluate(analysis);

  assert.equal(checkById(result, 'not_advice').passed, false);
  assert.equal(result.passed, true, 'warnings must not block the response');
  assert.ok(result.score < 1, 'warnings must still reduce the score');
});

test('property_reference is a warning and fires on generic output', () => {
  const analysis = clone();
  const generic = 'A property investment with rental income and projected capital growth.';
  analysis.headline = generic;
  analysis.summary = generic;
  analysis.suitability.rationale = 'The stated risk tolerance and income goal are broadly served.';
  analysis.strengths = analysis.strengths.map((item) => ({
    point: 'Income is quantified',
    evidence: 'The listing states a net yield of 5.78%.',
  }));
  analysis.risks = analysis.risks.map((risk) => ({
    risk: 'Projected returns depend on continued tenancy and may not be achieved',
    severity: 'medium',
    mitigation: 'Request the lease schedule and the historical vacancy record before committing.',
  }));
  analysis.keyMetrics = analysis.keyMetrics.map((metric) => ({
    label: 'Net rental yield',
    value: '5.78%',
    interpretation: 'Rent after operating expenses as a share of price.',
  }));
  analysis.questionsToAsk = ['What fees apply to the token?', 'Who holds legal title to the asset?'];

  const result = evaluate(analysis);

  assert.equal(checkById(result, 'property_reference').passed, false);
  assert.equal(result.passed, true);
});

test('length_bounds is a warning and fires on an over-long section', () => {
  const analysis = clone();
  analysis.headline = 'A'.repeat(200);

  const result = evaluate(analysis);

  assert.equal(checkById(result, 'length_bounds').passed, false);
  assert.equal(result.passed, true);
});

test('corrections describe only the critical failures, for the retry prompt', () => {
  const analysis = clone();
  analysis.disclaimer = 'Returns look strong.';
  analysis.summary = `${analysis.summary} We recommend you buy now.`;

  const result = evaluate(analysis);

  assert.equal(result.passed, false);
  assert.equal(result.corrections.length, result.summary.criticalFailed);
  assert.ok(result.corrections.some((entry) => entry.includes('not financial advice')));
  assert.ok(
    !result.corrections.some((entry) => entry.toLowerCase().includes('recommendation')),
    'warnings must not be fed back as corrections'
  );
});

test('a check that throws is recorded as a failure rather than crashing the request', () => {
  // A frozen object makes the checks run against a hostile shape.
  const result = evaluateAnalysis({ analysis: Object.freeze({}), facts: FACTS });

  assert.equal(result.passed, false);
  assert.equal(result.checks.length > 0, true);
});
