'use strict';

const { round } = require('../../data/properties');

/**
 * Deterministic, non-LLM analysis provider.
 *
 * This exists so the feature is reviewable and testable without credentials or spend:
 *  - a reviewer can clone, `npm start`, and exercise the whole flow end to end;
 *  - the offline evaluation suite has a fixed baseline that must always score 1.0, which
 *    is what catches bugs in the *checks* themselves (a check that fails a known-good
 *    analysis is broken, and without a fixed baseline that is invisible);
 *  - CI can run the full pipeline with no network access.
 *
 * It composes its output from the same fact sheet the model receives, so every figure it
 * emits is grounded by construction. Output is labelled `source: "sample"` all the way
 * through to the UI badge - it is never presented as model output.
 */

const currency = (value) =>
  `$${Number(value).toLocaleString('en-US', { maximumFractionDigits: 2 })}`;
const percent = (value) => `${value}%`;

/** Rule-based suitability verdict, used only when an investor profile was supplied. */
function assessSuitability(facts) {
  const profile = facts.investorProfile;
  if (!profile) {
    return {
      verdict: 'not_assessed',
      rationale:
        `No investor profile was supplied, so fit cannot be assessed. On its own figures this ` +
        `listing suits an investor who wants rental income at a net yield of ` +
        `${percent(facts.economics.netRentalYieldPct)} with projected annual appreciation of ` +
        `${percent(facts.economics.projectedAnnualAppreciationPct)}, and who is comfortable holding ` +
        `an illiquid, single-property position.`,
    };
  }

  const reasons = [];
  let mismatches = 0;

  // Always state the return mix against the profile, so the rationale references at
  // least one profile dimension even when nothing is mismatched.
  reasons.push(
    `a ${profile.riskTolerance || 'unstated'} risk tolerance is being matched against a net rental ` +
      `yield of ${percent(facts.economics.netRentalYieldPct)} plus projected appreciation of ` +
      `${percent(facts.economics.projectedAnnualAppreciationPct)}`
  );

  const yieldLed = facts.economics.netRentalYieldPct >= facts.economics.projectedAnnualAppreciationPct;
  if (profile.primaryGoal === 'income' && !yieldLed) {
    mismatches += 1;
    reasons.push(
      `the stated goal is income, but this listing's projected appreciation of ` +
        `${percent(facts.economics.projectedAnnualAppreciationPct)} exceeds its net rental yield of ` +
        `${percent(facts.economics.netRentalYieldPct)}`
    );
  } else if (profile.primaryGoal === 'income') {
    reasons.push(
      `the stated goal is income and the position is yield-led, at a net rental yield of ` +
        `${percent(facts.economics.netRentalYieldPct)}`
    );
  }

  if (profile.primaryGoal === 'appreciation' && yieldLed) {
    mismatches += 1;
    reasons.push(
      `the stated goal is appreciation, but returns here are weighted towards rent rather than ` +
        `capital growth, which is projected at ${percent(facts.economics.projectedAnnualAppreciationPct)}`
    );
  }

  // Commercial tenancy and heavy operating costs are the two risk proxies in the data set.
  const higherRisk =
    facts.property.propertyType === 'commercial' ||
    facts.economics.totalOperatingExpenseRatioPct >= 18;

  if (profile.riskTolerance === 'conservative' && higherRisk) {
    mismatches += 1;
    reasons.push(
      `the profile is conservative, while this listing carries an operating expense ratio of ` +
        `${percent(facts.economics.totalOperatingExpenseRatioPct)} and tenant concentration typical of ` +
        `its property type`
    );
  }

  if (profile.holdingHorizonYears !== undefined && profile.holdingHorizonYears < 3) {
    mismatches += 1;
    reasons.push(
      `the holding horizon of ${profile.holdingHorizonYears} years is short for an asset whose ` +
        `return depends on appreciation accruing over time, and secondary-market liquidity may not be ` +
        `available on demand`
    );
  }

  const projection = facts.investorProjection;
  if (projection && projection.tokensPurchasable === 0) {
    mismatches += 2;
    reasons.push(
      `the stated budget does not cover the minimum investment of ` +
        `${currency(facts.tokenisation.minimumInvestmentUsd)}`
    );
  } else if (projection && projection.budgetExceedsRemainingAllocation) {
    reasons.push(
      `the budget exceeds the remaining allocation, so at most ` +
        `${projection.tokensPurchasable.toLocaleString('en-US')} tokens could be bought in this round`
    );
  }

  const verdict = mismatches === 0 ? 'aligned' : mismatches === 1 ? 'partially_aligned' : 'not_aligned';

  return {
    verdict,
    rationale: `Assessed against the supplied profile: ${reasons.join('; ')}.`,
  };
}

function buildStrengths(facts) {
  const strengths = [
    {
      point: 'Entry cost is low relative to direct property ownership',
      evidence:
        `Tokens are priced at ${currency(facts.tokenisation.tokenPriceUsd)} with a minimum ` +
        `investment of ${currency(facts.tokenisation.minimumInvestmentUsd)} against an asking price of ` +
        `${currency(facts.economics.askingPriceUsd)}.`,
    },
    {
      point: 'Rental income is the primary return driver and is already quantified',
      evidence:
        `Net monthly rent is ${currency(facts.economics.netMonthlyRentUsd)} from gross rent of ` +
        `${currency(facts.economics.grossMonthlyRentUsd)}, a net rental yield of ` +
        `${percent(facts.economics.netRentalYieldPct)}.`,
    },
  ];

  if (facts.tokenisation.percentFunded >= 60) {
    strengths.push({
      point: 'The round has substantial existing participation',
      evidence:
        `${percent(facts.tokenisation.percentFunded)} of the allocation is funded across ` +
        `${facts.tokenisation.currentInvestorCount.toLocaleString('en-US')} investors, raising ` +
        `${currency(facts.tokenisation.capitalRaisedUsd)}.`,
    });
  } else {
    strengths.push({
      point: 'The allocation is still largely open',
      evidence:
        `${facts.tokenisation.tokensStillAvailable.toLocaleString('en-US')} of ` +
        `${facts.tokenisation.totalTokenSupply.toLocaleString('en-US')} tokens remain unsold at ` +
        `${percent(facts.tokenisation.percentFunded)} funded.`,
    });
  }

  return strengths;
}

function buildRisks(facts) {
  const risks = [
    {
      risk: 'Returns are projections, not contracted income, and depend on the property staying tenanted',
      severity: 'medium',
      mitigation:
        `Ask for the actual lease schedule and historical vacancy behind the quoted gross rent of ` +
        `${currency(facts.economics.grossMonthlyRentUsd)} per month before committing capital.`,
    },
    {
      risk: 'Operating costs are deducted before any distribution and could rise',
      severity: facts.economics.totalOperatingExpenseRatioPct >= 18 ? 'high' : 'medium',
      mitigation:
        `Operating expenses already absorb ${percent(facts.economics.totalOperatingExpenseRatioPct)} of ` +
        `gross rent; request the basis for each component and whether any are capped.`,
    },
    {
      risk: 'The position is a single property in one location, with no diversification',
      severity: 'medium',
      mitigation:
        `Treat exposure to ${facts.property.location} as concentrated, and size the position ` +
        `accordingly against the rest of a portfolio.`,
    },
  ];

  if (facts.property.propertyType === 'commercial') {
    risks.push({
      risk: 'Commercial tenancy concentrates income in a small number of tenants',
      severity: 'high',
      mitigation:
        'Request the tenant list, lease expiry dates and break clauses, and model income with the ' +
        'largest tenant removed.',
    });
  }

  if (facts.tokenisation.percentFunded < 30) {
    risks.push({
      risk: 'The funding round may not complete',
      severity: 'medium',
      mitigation:
        `At ${percent(facts.tokenisation.percentFunded)} funded, ask what happens to committed ` +
        'capital if the round does not close, and over what period.',
    });
  }

  return risks.slice(0, 5);
}

function buildKeyMetrics(facts) {
  const metrics = [
    {
      label: 'Net rental yield',
      value: percent(facts.economics.netRentalYieldPct),
      interpretation:
        'Annual rent after operating expenses, as a share of the asking price. This is the income ' +
        'component of the return.',
    },
    {
      label: 'Projected annual appreciation',
      value: percent(facts.economics.projectedAnnualAppreciationPct),
      interpretation:
        'The capital growth assumption in the listing. It is a projection and may not be realised.',
    },
    {
      label: 'Operating expense ratio',
      value: percent(facts.economics.totalOperatingExpenseRatioPct),
      interpretation:
        'Share of gross rent consumed by management, maintenance, insurance and property tax before ' +
        'anything is distributed.',
    },
    {
      label: 'Funding progress',
      value: percent(facts.tokenisation.percentFunded),
      interpretation:
        `${facts.tokenisation.tokensStillAvailable.toLocaleString('en-US')} tokens remain of ` +
        `${facts.tokenisation.totalTokenSupply.toLocaleString('en-US')}, which sets how much of this ` +
        'round is still open.',
    },
  ];

  if (facts.investorProjection && facts.investorProjection.tokensPurchasable > 0) {
    metrics.push({
      label: 'Projected income at this budget',
      value: currency(facts.investorProjection.projectedAnnualNetIncomeUsd),
      interpretation:
        `Annual net income implied by an ownership share of ` +
        `${percent(facts.investorProjection.ownershipSharePct)}, before fees and tax.`,
    });
  } else {
    metrics.push({
      label: 'Monthly net income per $1,000 invested',
      value: currency(facts.economics.monthlyNetIncomePer1000UsdInvested),
      interpretation: 'Lets the income component be scaled to any position size.',
    });
  }

  return metrics.slice(0, 6);
}

function buildQuestions(facts) {
  const questions = [
    `What are the current lease terms and the historical vacancy record behind the quoted gross rent of ${currency(facts.economics.grossMonthlyRentUsd)} per month?`,
    'What are the entry, management and exit fees charged on the token itself, and are they included in the quoted net figures?',
    `How is secondary-market liquidity for ${facts.tokenisation.tokenSymbol} provided, and what has actual trading volume been?`,
    `What legal claim does a token holder have on the underlying asset in ${facts.property.location}, and who holds the title?`,
  ];

  if (facts.investorProjection && facts.investorProjection.budgetExceedsRemainingAllocation) {
    questions.push('Can an allocation above the remaining supply be reserved for a future round?');
  }

  return questions.slice(0, 5);
}

/**
 * @param {object} facts Fact sheet from `buildAnalysisFacts`.
 * @returns {Promise<{ analysis: object, providerMeta: object }>}
 */
async function generateAnalysis(facts) {
  const startedAt = Date.now();

  const analysis = {
    headline:
      `${facts.property.title}: ${percent(facts.economics.netRentalYieldPct)} net yield, ` +
      `${percent(facts.tokenisation.percentFunded)} funded`,
    summary:
      `${facts.property.title} is a ${facts.property.propertyType} listing in ${facts.property.location}, ` +
      `offered at ${currency(facts.economics.askingPriceUsd)} and split into ` +
      `${facts.tokenisation.totalTokenSupply.toLocaleString('en-US')} tokens of ` +
      `${currency(facts.tokenisation.tokenPriceUsd)} each. Return comes from two sources: net rent of ` +
      `${currency(facts.economics.netMonthlyRentUsd)} per month, a net yield of ` +
      `${percent(facts.economics.netRentalYieldPct)}, and projected appreciation of ` +
      `${percent(facts.economics.projectedAnnualAppreciationPct)} per year, for a combined projected ` +
      `total return of ${percent(facts.economics.totalAnnualReturnPct)}. The round is ` +
      `${percent(facts.tokenisation.percentFunded)} funded.`,
    suitability: assessSuitability(facts),
    strengths: buildStrengths(facts),
    risks: buildRisks(facts),
    keyMetrics: buildKeyMetrics(facts),
    questionsToAsk: buildQuestions(facts),
    disclaimer:
      'This is an automated analysis of the listing data shown on this page. It is not financial ' +
      'advice, not a recommendation, and does not account for your circumstances. Projected returns ' +
      'may not be achieved and invested capital is at risk.',
  };

  return {
    analysis,
    providerMeta: {
      source: 'sample',
      providerLabel: 'Deterministic sample',
      model: 'deterministic-sample',
      jsonMode: 'not_applicable',
      latencyMs: Date.now() - startedAt,
      note:
        'Generated locally without a model call. Configure any provider API key ' +
        '(see docs/AI_PROVIDERS.md) for model-generated analysis.',
    },
  };
}

module.exports = { id: 'sample', label: 'Deterministic sample', generateAnalysis, round };
