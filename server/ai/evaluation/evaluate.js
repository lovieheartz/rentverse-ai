'use strict';

const { CHECKS, Severity, SEVERITY_WEIGHT } = require('./checks');

/**
 * Runs the quality suite over one generated analysis and returns a scorecard.
 *
 * A check that throws is recorded as a failure rather than propagating: a bug in a check
 * must not take down the endpoint it is protecting, and a silently skipped check is worse
 * than a loud one.
 */

/**
 * @param {object} input
 * @param {object|null} input.analysis Parsed analysis, or null when parsing failed.
 * @param {object} input.facts Fact sheet the analysis was generated from.
 * @param {string} [input.parseError] JSON parse error message, if any.
 * @returns {{
 *   passed: boolean,
 *   score: number,
 *   checks: Array<object>,
 *   summary: object,
 *   corrections: Array<string>
 * }}
 */
function evaluateAnalysis({ analysis, facts, parseError }) {
  const context = { analysis, facts, parseError };
  const results = [];

  for (const check of CHECKS) {
    let outcome;
    try {
      outcome = check.run(context);
    } catch (error) {
      outcome = {
        passed: false,
        detail: `Check threw an error: ${error.message}`,
      };
    }

    results.push({
      id: check.id,
      label: check.label,
      severity: check.severity,
      passed: Boolean(outcome.passed),
      detail: outcome.detail,
      ...(outcome.evidence ? { evidence: outcome.evidence } : {}),
    });
  }

  const totalWeight = results.reduce((sum, result) => sum + SEVERITY_WEIGHT[result.severity], 0);
  const earnedWeight = results.reduce(
    (sum, result) => sum + (result.passed ? SEVERITY_WEIGHT[result.severity] : 0),
    0
  );

  const failures = results.filter((result) => !result.passed);
  const criticalFailures = failures.filter((result) => result.severity === Severity.CRITICAL);

  return {
    passed: criticalFailures.length === 0,
    score: totalWeight === 0 ? 1 : Number((earnedWeight / totalWeight).toFixed(4)),
    checks: results,
    summary: {
      total: results.length,
      passed: results.length - failures.length,
      failed: failures.length,
      criticalFailed: criticalFailures.length,
      warningFailed: failures.length - criticalFailures.length,
    },
    // Fed back into the prompt on a retry. Only critical failures are worth a second
    // model call; warnings are reported to the client and left alone.
    corrections: criticalFailures.map((failure) => {
      const evidence = Array.isArray(failure.evidence) ? ` Examples: ${failure.evidence.join('; ')}.` : '';
      return `${failure.label}: ${failure.detail}${evidence}`;
    }),
  };
}

/** Strips internal-only fields for the client-facing scorecard. */
function toPublicScorecard(evaluation) {
  return {
    passed: evaluation.passed,
    score: evaluation.score,
    summary: evaluation.summary,
    checks: evaluation.checks.map(({ id, label, severity, passed, detail }) => ({
      id,
      label,
      severity,
      passed,
      detail,
    })),
  };
}

module.exports = { evaluateAnalysis, toPublicScorecard };
