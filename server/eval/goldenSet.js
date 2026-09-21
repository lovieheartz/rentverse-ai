'use strict';

/**
 * Golden set for the AI investment analysis.
 *
 * These are not happy-path samples. Each case targets a way the analysis is known to be
 * able to fail, so a regression shows up as a specific check going red rather than as a
 * vague drop in an aggregate score:
 *
 *   - no profile              -> does the model correctly abstain instead of inventing a fit?
 *   - budget below minimum    -> does it say so, or quietly assume the investment is possible?
 *   - budget above allocation -> does it use the capped token count it was given?
 *   - one-year horizon        -> does it flag horizon mismatch, or default to optimism?
 *   - conservative + commercial, aggressive + low-growth -> does it soften a bad fit?
 *   - early-stage listing     -> does it raise round-completion risk unprompted?
 *
 * Add a case whenever a real failure is found in production; that is what keeps an eval
 * set honest over time.
 */

const GOLDEN_CASES = [
  {
    id: 'no-profile-baseline',
    propertyId: '1',
    investorProfile: null,
    intent: 'No investor profile: suitability must abstain rather than assert a fit.',
  },
  {
    id: 'income-seeker-aligned',
    propertyId: '1',
    investorProfile: { budgetUsd: 5000, horizonYears: 7, riskTolerance: 'moderate', goal: 'income' },
    intent: 'Well-matched income investor on a yield-led residential listing.',
  },
  {
    id: 'conservative-on-commercial',
    propertyId: '5',
    investorProfile: {
      budgetUsd: 2500,
      horizonYears: 10,
      riskTolerance: 'conservative',
      goal: 'income',
    },
    intent: 'Conservative profile against tenant-concentrated commercial: mismatch must be stated.',
  },
  {
    id: 'budget-below-minimum',
    propertyId: '2',
    investorProfile: { budgetUsd: 10, horizonYears: 5, riskTolerance: 'moderate', goal: 'balanced' },
    intent: 'Budget at the floor: must not imply a larger position than the budget allows.',
  },
  {
    id: 'budget-exceeds-allocation',
    propertyId: '2',
    investorProfile: {
      budgetUsd: 250000,
      horizonYears: 8,
      riskTolerance: 'aggressive',
      goal: 'balanced',
    },
    intent: 'Budget larger than the remaining allocation on a 95%-funded round.',
  },
  {
    id: 'short-horizon-mismatch',
    propertyId: '3',
    investorProfile: {
      budgetUsd: 15000,
      horizonYears: 1,
      riskTolerance: 'moderate',
      goal: 'appreciation',
    },
    intent: 'One-year horizon on an appreciation-dependent asset: must flag the mismatch.',
  },
  {
    id: 'aggressive-low-growth',
    propertyId: '5',
    investorProfile: {
      budgetUsd: 40000,
      horizonYears: 4,
      riskTolerance: 'aggressive',
      goal: 'appreciation',
    },
    intent: 'Appreciation goal against the lowest-growth listing in the catalogue.',
  },
  {
    id: 'early-stage-round',
    propertyId: '6',
    investorProfile: {
      budgetUsd: 1000,
      horizonYears: 6,
      riskTolerance: 'conservative',
      goal: 'balanced',
    },
    intent: 'Listing at 12% funded: round-completion risk should surface without prompting.',
  },
  {
    id: 'high-expense-coastal',
    propertyId: '3',
    investorProfile: { budgetUsd: 8000, horizonYears: 12, riskTolerance: 'moderate', goal: 'income' },
    intent: 'Highest operating expense ratio in the catalogue: cost drag should be surfaced.',
  },
  {
    id: 'no-profile-commercial',
    propertyId: '6',
    investorProfile: null,
    intent: 'Second abstain case on a commercial listing, to catch verdict drift by asset type.',
  },
];

module.exports = { GOLDEN_CASES };
