'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { validate } = require('../middlewares/validator/requestValidator');
const { listPropertiesQuery, propertyAnalysisBody } = require('../middlewares/validator/schemas');

test('coerces query strings into numbers and booleans', () => {
  const { value, errors } = validate(listPropertiesQuery, {
    page: '2',
    limit: '6',
    minRoiPct: '7.5',
    featured: 'true',
  });

  assert.deepEqual(errors, []);
  assert.equal(value.page, 2);
  assert.equal(value.limit, 6);
  assert.equal(value.minRoiPct, 7.5);
  assert.equal(value.featured, true);
});

test('applies declared defaults when a field is absent', () => {
  const { value, errors } = validate(listPropertiesQuery, {});

  assert.deepEqual(errors, []);
  assert.equal(value.page, 1);
  assert.equal(value.limit, 12);
  assert.equal(value.type, 'all');
  assert.equal(value.sortBy, 'newest');
});

test('rejects out-of-range numbers with a precise field error', () => {
  const { errors } = validate(listPropertiesQuery, { limit: '500' });

  assert.equal(errors.length, 1);
  assert.equal(errors[0].field, 'limit');
  assert.equal(errors[0].code, 'out_of_range');
  assert.match(errors[0].message, /less than or equal to 48/);
});

test('rejects non-numeric input for a numeric field', () => {
  const { errors } = validate(listPropertiesQuery, { minRoiPct: 'seven' });

  assert.equal(errors.length, 1);
  assert.equal(errors[0].code, 'invalid_type');
});

test('rejects values outside an enum and lists the permitted options', () => {
  const { errors } = validate(listPropertiesQuery, { sortBy: 'cheapest' });

  assert.equal(errors[0].code, 'not_allowed');
  assert.match(errors[0].message, /priceAsc/);
});

test('reports unknown parameters instead of ignoring them', () => {
  // A typo in a filter name previously produced unfiltered results with no signal.
  const { errors } = validate(listPropertiesQuery, { minROI: '5' });

  assert.equal(errors.length, 1);
  assert.equal(errors[0].code, 'unknown_field');
  assert.equal(errors[0].field, 'minROI');
});

test('collects every failure in one pass rather than stopping at the first', () => {
  const { errors } = validate(listPropertiesQuery, {
    page: '0',
    limit: '999',
    type: 'castle',
  });

  assert.equal(errors.length, 3);
  assert.deepEqual(new Set(errors.map((error) => error.field)), new Set(['page', 'limit', 'type']));
});

test('validates nested objects and prefixes nested field paths', () => {
  const { errors } = validate(propertyAnalysisBody, {
    propertyId: '1',
    investorProfile: { budgetUsd: 5, riskTolerance: 'reckless' },
  });

  const fields = errors.map((error) => error.field);
  assert.ok(fields.includes('investorProfile.budgetUsd'));
  assert.ok(fields.includes('investorProfile.riskTolerance'));
});

test('accepts a valid analysis body and keeps the nested profile', () => {
  const { value, errors } = validate(propertyAnalysisBody, {
    propertyId: '3',
    investorProfile: { budgetUsd: 2500, horizonYears: 5, riskTolerance: 'moderate', goal: 'income' },
  });

  assert.deepEqual(errors, []);
  assert.equal(value.propertyId, '3');
  assert.equal(value.investorProfile.budgetUsd, 2500);
  assert.equal(value.refresh, false);
});

test('flags a required field that is missing', () => {
  const { errors } = validate(propertyAnalysisBody, {});

  assert.equal(errors.length, 1);
  assert.equal(errors[0].field, 'propertyId');
  assert.equal(errors[0].code, 'required');
});

test('enforces the id pattern, blocking path-traversal shaped input', () => {
  const { errors } = validate(propertyAnalysisBody, { propertyId: '../../etc/passwd' });

  assert.equal(errors[0].code, 'pattern_mismatch');
});

test('truncates echoed input so error payloads cannot reflect large strings', () => {
  const { errors } = validate(listPropertiesQuery, { type: 'x'.repeat(500) });

  assert.ok(errors[0].received.length <= 84);
  assert.ok(errors[0].received.endsWith('...'));
});
