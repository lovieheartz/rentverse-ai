'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { PROPERTIES } = require('../data/properties');
const {
  listProperties,
  getPropertyById,
  getFeaturedProperties,
} = require('../services/propertyService');

test('every catalogue entry is internally consistent', () => {
  for (const property of PROPERTIES) {
    // Token supply must reconcile with the asking price.
    assert.equal(
      property.tokenDetails.totalTokens * property.tokenDetails.tokenPriceUsd,
      property.price.usd,
      `${property.id}: token supply does not reconcile with price`
    );

    // Available tokens must reconcile with the funding percentage.
    const impliedAvailable = Math.round(
      property.tokenDetails.totalTokens * (1 - property.metrics.fundedPct / 100)
    );
    assert.equal(property.tokenDetails.availableTokens, impliedAvailable, `${property.id}: token split`);
    assert.equal(
      property.tokenDetails.soldTokens + property.tokenDetails.availableTokens,
      property.tokenDetails.totalTokens,
      `${property.id}: sold + available !== total`
    );

    // The funding label must agree with the funding percentage - the specific
    // contradiction the original static data contained.
    const { fundedPct } = property.metrics;
    const expectedStage = fundedPct < 30 ? 'new' : fundedPct < 90 ? 'active' : 'almost_funded';
    assert.equal(property.status.stage, expectedStage, `${property.id}: funding stage`);

    // Net rent must be gross rent less the stated expense ratio.
    const expectedNet = Math.round(
      property.financials.grossMonthlyRentUsd * (1 - property.financials.totalExpenseRatioPct / 100)
    );
    assert.equal(property.financials.netMonthlyRentUsd, expectedNet, `${property.id}: net rent`);

    assert.ok(property.metrics.netYieldPct < property.metrics.grossYieldPct, `${property.id}: yields`);
    assert.equal(
      property.metrics.totalAnnualReturnPct,
      Math.round((property.metrics.netYieldPct + property.metrics.appreciationPct) * 100) / 100,
      `${property.id}: total return`
    );
  }
});

test('returns every property when no filters are applied', () => {
  const { items, pagination } = listProperties({ page: 1, limit: 50, sortBy: 'newest' });

  assert.equal(items.length, PROPERTIES.length);
  assert.equal(pagination.totalItems, PROPERTIES.length);
  assert.equal(pagination.pageCount, 1);
  assert.equal(pagination.hasNextPage, false);
});

test('filters by property type', () => {
  const { items } = listProperties({ type: 'commercial', page: 1, limit: 50, sortBy: 'newest' });

  assert.ok(items.length > 0);
  assert.ok(items.every((item) => item.type === 'commercial'));
});

test('free-text search matches title, location and features', () => {
  const byCity = listProperties({ search: 'seattle', page: 1, limit: 50, sortBy: 'newest' });
  assert.equal(byCity.items.length, 1);
  assert.equal(byCity.items[0].location.city, 'Seattle');

  const byFeature = listProperties({ search: 'wine cellar', page: 1, limit: 50, sortBy: 'newest' });
  assert.ok(byFeature.items.length >= 1);
});

test('filters by funding stage using the derived stage, not a free-text label', () => {
  const { items } = listProperties({ fundingStage: 'new', page: 1, limit: 50, sortBy: 'newest' });

  assert.ok(items.length > 0);
  assert.ok(items.every((item) => item.metrics.fundedPct < 30));
});

test('filters by price and return range', () => {
  const { items } = listProperties({
    minPriceUsd: 1000000,
    maxPriceUsd: 2000000,
    page: 1,
    limit: 50,
    sortBy: 'newest',
  });

  assert.ok(items.length > 0);
  assert.ok(items.every((item) => item.price.usd >= 1000000 && item.price.usd <= 2000000));

  const highReturn = listProperties({ minRoiPct: 8, page: 1, limit: 50, sortBy: 'newest' });
  assert.ok(highReturn.items.every((item) => item.metrics.totalAnnualReturnPct >= 8));
});

test('sorts by each supported key', () => {
  const ascending = listProperties({ sortBy: 'priceAsc', page: 1, limit: 50 }).items;
  const descending = listProperties({ sortBy: 'priceDesc', page: 1, limit: 50 }).items;

  assert.deepEqual(
    ascending.map((item) => item.price.usd),
    [...ascending.map((item) => item.price.usd)].sort((a, b) => a - b)
  );
  assert.equal(descending[0].price.usd, Math.max(...PROPERTIES.map((p) => p.price.usd)));

  const byReturn = listProperties({ sortBy: 'roiDesc', page: 1, limit: 50 }).items;
  for (let index = 1; index < byReturn.length; index += 1) {
    assert.ok(
      byReturn[index - 1].metrics.totalAnnualReturnPct >= byReturn[index].metrics.totalAnnualReturnPct
    );
  }
});

test('paginates without repeating or dropping items', () => {
  const first = listProperties({ page: 1, limit: 2, sortBy: 'priceAsc' });
  const second = listProperties({ page: 2, limit: 2, sortBy: 'priceAsc' });

  assert.equal(first.items.length, 2);
  assert.equal(first.pagination.hasNextPage, true);
  assert.equal(second.pagination.hasPreviousPage, true);

  const overlap = first.items.filter((item) => second.items.some((other) => other.id === item.id));
  assert.equal(overlap.length, 0);
});

test('clamps a page number beyond the last page instead of returning nothing', () => {
  const { items, pagination } = listProperties({ page: 99, limit: 2, sortBy: 'newest' });

  assert.ok(items.length > 0);
  assert.equal(pagination.requestedPage, 99);
  assert.equal(pagination.page, pagination.pageCount);
});

test('getPropertyById returns the requested property, not a fixed one', () => {
  // The regression this guards: the detail page ignored the route id entirely.
  const ids = PROPERTIES.map((property) => property.id);
  const titles = new Set();

  for (const id of ids) {
    const property = getPropertyById(id);
    assert.equal(property.id, id);
    titles.add(property.title);
  }

  assert.equal(titles.size, ids.length, 'each id must resolve to a distinct property');
});

test('getPropertyById returns null for an unknown id', () => {
  assert.equal(getPropertyById('does-not-exist'), null);
  assert.equal(getPropertyById('__proto__'), null);
});

test('featured properties are flagged and limited', () => {
  const featured = getFeaturedProperties(2);

  assert.equal(featured.length, 2);
  assert.ok(featured.every((item) => item.featured === true));
});
