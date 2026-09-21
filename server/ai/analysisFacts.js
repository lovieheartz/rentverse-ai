'use strict';

const { round } = require('../data/properties');

/**
 * Builds the fact sheet handed to the model, and the numeric allow-set used to verify
 * the model's answer.
 *
 * Both come from this one function on purpose. The most valuable quality check on
 * LLM-generated financial copy is "does every figure in the prose actually exist in the
 * source data" - and that check is only trustworthy if the set of permitted figures is
 * derived from exactly the same object the prompt was built from. If the prompt and the
 * checker were built separately they would drift, and the checker would start rejecting
 * correct output (or passing hallucinations).
 *
 * A second consequence: because hallucinated arithmetic is the common failure mode, the
 * investor-specific projections the model would otherwise have to compute itself
 * (affordable tokens, ownership share, projected income) are pre-computed here and
 * supplied as facts. The model quotes; it does not calculate.
 */

/** Simple compounding - no reinvestment of income, no fees, no tax. */
function compound(principal, ratePct, years) {
  return principal * (1 + ratePct / 100) ** years;
}

/**
 * @param {object} property A record from the property catalogue.
 * @param {object} [profile] Validated investor profile (all fields optional).
 * @returns {object} Fact sheet: `property`, `economics`, `tokenisation`, and - when a
 *   profile with a budget is supplied - `investorProjection`.
 */
function buildAnalysisFacts(property, profile = {}) {
  const facts = {
    property: {
      id: property.id,
      title: property.title,
      propertyType: property.type,
      location: property.location.label,
      yearBuilt: property.details.yearBuilt,
      interiorSqFt: property.details.interiorSqFt,
      lotSizeAcres: property.details.lotSizeAcres,
      parkingSpaces: property.details.parkingSpaces,
      keyFeatures: [...property.features],
      listedOn: property.listedAt.slice(0, 10),
      fundingStage: property.status.label,
    },
    economics: {
      askingPriceUsd: property.price.usd,
      askingPriceEth: property.price.eth,
      ethUsdRateUsed: property.price.ethUsdRate,
      grossRentalYieldPct: property.metrics.grossYieldPct,
      netRentalYieldPct: property.metrics.netYieldPct,
      projectedAnnualAppreciationPct: property.metrics.appreciationPct,
      totalAnnualReturnPct: property.metrics.totalAnnualReturnPct,
      grossMonthlyRentUsd: property.financials.grossMonthlyRentUsd,
      netMonthlyRentUsd: property.financials.netMonthlyRentUsd,
      grossAnnualRentUsd: property.financials.grossAnnualRentUsd,
      netAnnualRentUsd: property.financials.netAnnualRentUsd,
      totalOperatingExpenseRatioPct: property.financials.totalExpenseRatioPct,
      expenseBreakdownPct: { ...property.financials.expenseRatios },
      monthlyNetIncomePer1000UsdInvested: property.metrics.monthlyIncomePer1000Usd,
      // Stated explicitly so "per $1,000 invested" phrasing is itself grounded.
      incomeProjectionBasisUsd: 1000,
    },
    tokenisation: {
      blockchain: property.tokenDetails.blockchain,
      tokenSymbol: property.tokenDetails.symbol,
      tokenPriceUsd: property.tokenDetails.tokenPriceUsd,
      totalTokenSupply: property.tokenDetails.totalTokens,
      tokensStillAvailable: property.tokenDetails.availableTokens,
      tokensAlreadySold: property.tokenDetails.soldTokens,
      capitalRaisedUsd: property.tokenDetails.raisedUsd,
      percentFunded: property.metrics.fundedPct,
      currentInvestorCount: property.metrics.totalInvestors,
      minimumInvestmentUsd: property.metrics.minInvestmentUsd,
    },
  };

  const hasProfile = profile && Object.keys(profile).length > 0;
  if (hasProfile) {
    facts.investorProfile = {
      budgetUsd: profile.budgetUsd,
      holdingHorizonYears: profile.horizonYears,
      riskTolerance: profile.riskTolerance,
      primaryGoal: profile.goal,
    };

    if (typeof profile.budgetUsd === 'number') {
      const tokenPrice = property.tokenDetails.tokenPriceUsd;
      const affordableTokens = Math.floor(profile.budgetUsd / tokenPrice);
      const cappedTokens = Math.min(affordableTokens, property.tokenDetails.availableTokens);
      const investedUsd = cappedTokens * tokenPrice;
      const ownershipShare = cappedTokens / property.tokenDetails.totalTokens;

      const projection = {
        affordableTokensAtThisBudget: affordableTokens,
        tokensPurchasable: cappedTokens,
        capitalDeployedUsd: investedUsd,
        ownershipSharePct: round(ownershipShare * 100, 4),
        projectedMonthlyNetIncomeUsd: round(property.financials.netMonthlyRentUsd * ownershipShare, 2),
        projectedAnnualNetIncomeUsd: round(property.financials.netAnnualRentUsd * ownershipShare, 2),
        budgetExceedsRemainingAllocation: affordableTokens > property.tokenDetails.availableTokens,
      };

      if (typeof profile.horizonYears === 'number') {
        const years = profile.horizonYears;
        const capitalAtHorizon = compound(investedUsd, property.metrics.appreciationPct, years);
        const cumulativeIncome = projection.projectedAnnualNetIncomeUsd * years;

        projection.holdingHorizonYears = years;
        projection.projectedCapitalValueAtHorizonUsd = round(capitalAtHorizon, 2);
        projection.projectedCumulativeIncomeOverHorizonUsd = round(cumulativeIncome, 2);
        projection.projectedTotalValueAtHorizonUsd = round(capitalAtHorizon + cumulativeIncome, 2);
        projection.projectionBasis =
          'Appreciation compounded annually on deployed capital; income accrued without reinvestment. Excludes fees, taxes and vacancy.';
      }

      facts.investorProjection = projection;
    }
  }

  return facts;
}

/**
 * Collects every numeric value reachable in the fact sheet.
 * Used to build the grounding allow-set for the quality gate.
 *
 * @param {*} node
 * @param {Set<number>} [collected]
 * @returns {Set<number>}
 */
function collectNumericFacts(node, collected = new Set()) {
  if (typeof node === 'number' && Number.isFinite(node)) {
    collected.add(node);
    return collected;
  }

  if (Array.isArray(node)) {
    node.forEach((item) => collectNumericFacts(item, collected));
    return collected;
  }

  if (node && typeof node === 'object') {
    Object.values(node).forEach((value) => collectNumericFacts(value, collected));
    return collected;
  }

  // Numbers embedded in fact strings (e.g. "Seismic Retrofit 2021") count as grounded.
  if (typeof node === 'string') {
    const matches = node.match(/\d+(?:\.\d+)?/g) || [];
    matches.forEach((match) => {
      const parsed = Number(match);
      if (Number.isFinite(parsed)) collected.add(parsed);
    });
  }

  return collected;
}

module.exports = { buildAnalysisFacts, collectNumericFacts };
