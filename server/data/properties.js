'use strict';

/**
 * Canonical property catalogue - the single source of truth for the investment flow.
 *
 * Before this module the same listings were hardcoded three times (Home.jsx,
 * Properties.jsx, PropertyDetail.jsx) and the copies disagreed: id `1` was a Miami
 * apartment on the home page and a Beverly Hills villa on the listings page, while the
 * detail page ignored the route id entirely and always rendered the villa. Serving the
 * catalogue from one place removes that class of bug.
 *
 * Only *independent* facts are stored below. Everything that can be computed from them
 * - ETH price, token supply, available tokens, net rent, net yield, total return,
 * funding stage - is derived in `buildProperty()`. That matters twice over:
 *   1. the UI can no longer display a funding label that contradicts the funding
 *      percentage, or a token count that contradicts the price;
 *   2. the AI analysis prompt and the numeric-grounding quality check are both built
 *      from this one derived object, so they cannot disagree about what is true.
 */

/**
 * Static demo conversion rate. The product brief mentions live market data; no price
 * feed is wired up, so this is deliberately a fixed rate rather than an implied live
 * quote. Swap for a rates service before this reaches real investors.
 */
const ETH_USD_RATE = 2000;

const FUNDING_STAGE_THRESHOLDS = [
  { maxFundedPct: 30, stage: 'new', label: 'New Listing' },
  { maxFundedPct: 90, stage: 'active', label: 'Active Investment' },
  { maxFundedPct: Infinity, stage: 'almost_funded', label: 'Almost Funded' },
];

/** Rounds to `decimals` places without floating-point tails (e.g. 5.779999 -> 5.78). */
function round(value, decimals = 0) {
  const factor = 10 ** decimals;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}

function slugify(text) {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function resolveFundingStage(fundedPct) {
  const match = FUNDING_STAGE_THRESHOLDS.find((tier) => fundedPct < tier.maxFundedPct);
  return { stage: match.stage, label: match.label };
}

/** Independent facts only. Derived values live in `buildProperty()`. */
const PROPERTY_FACTS = [
  {
    id: '1',
    title: 'Modern Villa with Pool',
    type: 'villa',
    location: { city: 'Beverly Hills', state: 'CA', country: 'USA' },
    priceUsd: 850000,
    tokenPriceUsd: 10,
    minInvestmentUsd: 10,
    grossYieldPct: 6.8,
    expenseRatios: { managementPct: 8, maintenancePct: 4, insurancePct: 2, propertyTaxPct: 1 },
    appreciationPct: 4.5,
    fundedPct: 89,
    totalInvestors: 142,
    listedAt: '2026-05-12T09:00:00.000Z',
    featured: true,
    token: { symbol: 'RVVILLA1', blockchain: 'Ethereum', contractAddress: '0x7a3f...9c21' },
    details: { yearBuilt: 2020, parkingSpaces: 3, lotSizeAcres: 0.5, interiorSqFt: 5200 },
    description:
      'A modern villa in the Beverly Hills flats with high-end finishes throughout. The title is held ' +
      'in a single-asset entity and tokenised for fractional ownership, so investors can take a ' +
      'position from $10 and receive a pro-rata share of net rental income.',
    features: [
      'Swimming Pool',
      'Smart Home System',
      'Gourmet Kitchen',
      'Home Theater',
      'Wine Cellar',
      'Outdoor Kitchen',
      'Fire Pit',
      'Three-Car Garage',
    ],
    images: [
      'https://images.unsplash.com/photo-1613490493576-7fde63acd811?w=1200&q=80',
      'https://images.unsplash.com/photo-1512917774080-9991f1c4c750?w=1200&q=80',
      'https://images.unsplash.com/photo-1600585154340-be6161a56a0c?w=1200&q=80',
    ],
    advisor: {
      name: 'Amara Osei',
      title: 'Investment Advisor',
      phone: '+1 (555) 123-4567',
      email: 'amara.osei@rentverse.example',
      image: 'https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=400&q=80',
    },
  },
  {
    id: '2',
    title: 'Luxury Penthouse',
    type: 'apartment',
    location: { city: 'Manhattan', state: 'NY', country: 'USA' },
    priceUsd: 1200000,
    tokenPriceUsd: 10,
    minInvestmentUsd: 10,
    grossYieldPct: 6.1,
    expenseRatios: { managementPct: 8, maintenancePct: 5, insurancePct: 2, propertyTaxPct: 1.5 },
    appreciationPct: 5.2,
    fundedPct: 95,
    totalInvestors: 203,
    listedAt: '2026-04-28T09:00:00.000Z',
    featured: true,
    token: { symbol: 'RVPENT2', blockchain: 'Ethereum', contractAddress: '0x41b8...5de7' },
    details: { yearBuilt: 2018, parkingSpaces: 1, lotSizeAcres: 0, interiorSqFt: 3100 },
    description:
      'A full-floor penthouse in a doorman building with a private terrace and river views. Short ' +
      'time-to-lease and strong tenant demand make this a income-led position rather than a ' +
      'development play.',
    features: ['Doorman', 'Private Terrace', 'Residents Gym', 'Concierge', 'River Views', 'Storage Unit'],
    images: [
      'https://images.unsplash.com/photo-1512917774080-9991f1c4c750?w=1200&q=80',
      'https://images.unsplash.com/photo-1502672260266-1c1ef2d93688?w=1200&q=80',
      'https://images.unsplash.com/photo-1560448204-e02f11c3d0e2?w=1200&q=80',
    ],
    advisor: {
      name: 'Daniel Whitfield',
      title: 'Investment Advisor',
      phone: '+1 (555) 204-8811',
      email: 'daniel.whitfield@rentverse.example',
      image: 'https://images.unsplash.com/photo-1472099645785-5658abf4ff4e?w=400&q=80',
    },
  },
  {
    id: '3',
    title: 'Waterfront Estate',
    type: 'house',
    location: { city: 'Miami Beach', state: 'FL', country: 'USA' },
    priceUsd: 2100000,
    tokenPriceUsd: 10,
    minInvestmentUsd: 10,
    grossYieldPct: 7.4,
    expenseRatios: { managementPct: 9, maintenancePct: 6, insurancePct: 4, propertyTaxPct: 1.1 },
    appreciationPct: 6.1,
    fundedPct: 45,
    totalInvestors: 89,
    listedAt: '2026-06-30T09:00:00.000Z',
    featured: true,
    token: { symbol: 'RVWATER3', blockchain: 'Ethereum', contractAddress: '0x9d02...77af' },
    details: { yearBuilt: 2016, parkingSpaces: 4, lotSizeAcres: 0.8, interiorSqFt: 6400 },
    description:
      'A waterfront estate with a private dock on a protected canal. Insurance costs are materially ' +
      'higher than the portfolio average because of coastal exposure, which is reflected in the ' +
      'expense ratios below.',
    features: ['Waterfront', 'Private Dock', 'Wine Cellar', 'Guest House', 'Summer Kitchen', 'Generator'],
    images: [
      'https://images.unsplash.com/photo-1600596542815-ffad4c1539a9?w=1200&q=80',
      'https://images.unsplash.com/photo-1613490493576-7fde63acd811?w=1200&q=80',
      'https://images.unsplash.com/photo-1600607687939-ce8a6c25118c?w=1200&q=80',
    ],
    advisor: {
      name: 'Priya Raghunathan',
      title: 'Investment Advisor',
      phone: '+1 (555) 330-1190',
      email: 'priya.raghunathan@rentverse.example',
      image: 'https://images.unsplash.com/photo-1573496359142-b8d87734a5a2?w=400&q=80',
    },
  },
  {
    id: '4',
    title: 'Luxury Downtown Apartment',
    type: 'apartment',
    location: { city: 'Miami', state: 'FL', country: 'USA' },
    priceUsd: 640000,
    tokenPriceUsd: 10,
    minInvestmentUsd: 10,
    grossYieldPct: 7.1,
    expenseRatios: { managementPct: 8, maintenancePct: 4, insurancePct: 3, propertyTaxPct: 1.1 },
    appreciationPct: 4.1,
    fundedPct: 62,
    totalInvestors: 118,
    listedAt: '2026-06-02T09:00:00.000Z',
    featured: false,
    token: { symbol: 'RVDTMIA4', blockchain: 'Ethereum', contractAddress: '0x5c67...1b90' },
    details: { yearBuilt: 2021, parkingSpaces: 1, lotSizeAcres: 0, interiorSqFt: 1450 },
    description:
      'A two-bedroom apartment in a downtown Miami tower with amenity-led tenant demand and a short ' +
      'average vacancy window. Positioned as a steady income holding.',
    features: ['Rooftop Pool', 'Co-working Lounge', 'Residents Gym', 'Secure Parking', 'Pet Friendly'],
    images: [
      'https://images.unsplash.com/photo-1545324418-cc1a3fa10c00?w=1200&q=80',
      'https://images.unsplash.com/photo-1502005229762-cf1b2da7c5d6?w=1200&q=80',
      'https://images.unsplash.com/photo-1484154218962-a197022b5858?w=1200&q=80',
    ],
    advisor: {
      name: 'Marcus Lindgren',
      title: 'Investment Advisor',
      phone: '+1 (555) 441-2277',
      email: 'marcus.lindgren@rentverse.example',
      image: 'https://images.unsplash.com/photo-1519085360753-af0119f7cbe7?w=400&q=80',
    },
  },
  {
    id: '5',
    title: 'Tech District Live-Work Complex',
    type: 'commercial',
    location: { city: 'Austin', state: 'TX', country: 'USA' },
    priceUsd: 1450000,
    tokenPriceUsd: 10,
    minInvestmentUsd: 10,
    grossYieldPct: 8.2,
    expenseRatios: { managementPct: 10, maintenancePct: 6, insurancePct: 2, propertyTaxPct: 1.8 },
    appreciationPct: 3.4,
    fundedPct: 74,
    totalInvestors: 167,
    listedAt: '2026-05-20T09:00:00.000Z',
    featured: false,
    token: { symbol: 'RVTECH5', blockchain: 'Ethereum', contractAddress: '0x2e44...c803' },
    details: { yearBuilt: 2019, parkingSpaces: 22, lotSizeAcres: 1.2, interiorSqFt: 18400 },
    description:
      'A mixed-use live-work complex leased to four commercial tenants on staggered terms. Higher ' +
      'gross yield than the residential listings, with concentration risk if an anchor tenant exits.',
    features: [
      'Four Commercial Tenants',
      'Fibre Backbone',
      'EV Charging',
      'Loading Bay',
      'On-site Management',
    ],
    images: [
      'https://images.unsplash.com/photo-1486406146926-c627a92ad1ab?w=1200&q=80',
      'https://images.unsplash.com/photo-1497366216548-37526070297c?w=1200&q=80',
      'https://images.unsplash.com/photo-1497366811353-6870744d04b2?w=1200&q=80',
    ],
    advisor: {
      name: 'Sofia Berrada',
      title: 'Commercial Investment Advisor',
      phone: '+1 (555) 512-7788',
      email: 'sofia.berrada@rentverse.example',
      image: 'https://images.unsplash.com/photo-1487412720507-e7ab37603c6f?w=400&q=80',
    },
  },
  {
    id: '6',
    title: 'Waterfront Commercial Space',
    type: 'commercial',
    location: { city: 'Seattle', state: 'WA', country: 'USA' },
    priceUsd: 1875000,
    tokenPriceUsd: 10,
    minInvestmentUsd: 10,
    grossYieldPct: 7.9,
    expenseRatios: { managementPct: 9, maintenancePct: 7, insurancePct: 3, propertyTaxPct: 1.0 },
    appreciationPct: 3.9,
    fundedPct: 12,
    totalInvestors: 34,
    listedAt: '2026-08-18T09:00:00.000Z',
    featured: false,
    token: { symbol: 'RVSEA6', blockchain: 'Ethereum', contractAddress: '0xb1fa...4e56' },
    details: { yearBuilt: 2015, parkingSpaces: 14, lotSizeAcres: 0.6, interiorSqFt: 12100 },
    description:
      'Ground-floor retail and first-floor office space on the Seattle waterfront. Recently listed, so ' +
      'the funding round is still early and the token allocation is largely unsold.',
    features: ['Harbour Frontage', 'Ground-floor Retail', 'Transit Adjacent', 'Seismic Retrofit 2021'],
    images: [
      'https://images.unsplash.com/photo-1541888946425-d81bb19240f5?w=1200&q=80',
      'https://images.unsplash.com/photo-1524230572899-a752b3835840?w=1200&q=80',
      'https://images.unsplash.com/photo-1556761175-b413da4baf72?w=1200&q=80',
    ],
    advisor: {
      name: 'Nathan Okonkwo',
      title: 'Commercial Investment Advisor',
      phone: '+1 (555) 619-4402',
      email: 'nathan.okonkwo@rentverse.example',
      image: 'https://images.unsplash.com/photo-1500648767791-00dcc994a43e?w=400&q=80',
    },
  },
];

/** Expands a fact record into the full, internally consistent property object. */
function buildProperty(facts) {
  const totalExpenseRatioPct = round(
    Object.values(facts.expenseRatios).reduce((sum, ratio) => sum + ratio, 0),
    2
  );

  const grossMonthlyRentUsd = Math.round((facts.priceUsd * facts.grossYieldPct) / 1200);
  const netMonthlyRentUsd = Math.round(grossMonthlyRentUsd * (1 - totalExpenseRatioPct / 100));
  const netYieldPct = round(((netMonthlyRentUsd * 12) / facts.priceUsd) * 100, 2);
  const totalAnnualReturnPct = round(netYieldPct + facts.appreciationPct, 2);

  const totalTokens = Math.round(facts.priceUsd / facts.tokenPriceUsd);
  const availableTokens = Math.round(totalTokens * (1 - facts.fundedPct / 100));
  const { stage, label } = resolveFundingStage(facts.fundedPct);

  return Object.freeze({
    id: facts.id,
    slug: slugify(facts.title),
    title: facts.title,
    type: facts.type,
    description: facts.description,
    status: { stage, label, fundedPct: facts.fundedPct },
    location: Object.freeze({
      ...facts.location,
      label: `${facts.location.city}, ${facts.location.state}`,
    }),
    price: Object.freeze({
      usd: facts.priceUsd,
      eth: round(facts.priceUsd / ETH_USD_RATE, 4),
      ethUsdRate: ETH_USD_RATE,
    }),
    metrics: Object.freeze({
      grossYieldPct: facts.grossYieldPct,
      netYieldPct,
      appreciationPct: facts.appreciationPct,
      totalAnnualReturnPct,
      monthlyIncomePer1000Usd: round((netMonthlyRentUsd / facts.priceUsd) * 1000, 2),
      minInvestmentUsd: facts.minInvestmentUsd,
      totalInvestors: facts.totalInvestors,
      fundedPct: facts.fundedPct,
    }),
    financials: Object.freeze({
      grossMonthlyRentUsd,
      netMonthlyRentUsd,
      grossAnnualRentUsd: grossMonthlyRentUsd * 12,
      netAnnualRentUsd: netMonthlyRentUsd * 12,
      totalExpenseRatioPct,
      expenseRatios: Object.freeze({ ...facts.expenseRatios }),
    }),
    tokenDetails: Object.freeze({
      ...facts.token,
      tokenPriceUsd: facts.tokenPriceUsd,
      totalTokens,
      availableTokens,
      soldTokens: totalTokens - availableTokens,
      raisedUsd: (totalTokens - availableTokens) * facts.tokenPriceUsd,
    }),
    details: Object.freeze({ ...facts.details }),
    features: Object.freeze([...facts.features]),
    images: Object.freeze([...facts.images]),
    advisor: Object.freeze({ ...facts.advisor }),
    listedAt: facts.listedAt,
    featured: facts.featured,
  });
}

const PROPERTIES = Object.freeze(PROPERTY_FACTS.map(buildProperty));
const PROPERTIES_BY_ID = Object.freeze(
  PROPERTIES.reduce((index, property) => {
    index[property.id] = property;
    return index;
  }, Object.create(null))
);

module.exports = {
  PROPERTIES,
  PROPERTIES_BY_ID,
  ETH_USD_RATE,
  FUNDING_STAGE_THRESHOLDS,
  round,
  slugify,
  resolveFundingStage,
};
