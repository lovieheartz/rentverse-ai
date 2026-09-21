#!/usr/bin/env node
'use strict';

/**
 * Offline evaluation runner for the AI investment analysis.
 *
 *   npm run eval:ai                              # deterministic baseline, free, no network
 *   npm run eval:ai -- --provider=anthropic
 *   npm run eval:ai -- --provider=all            # every configured provider, ranked
 *   npm run eval:ai -- --provider=openai,google,groq --repeat=3
 *
 * Every provider is scored with the same check suite that gates live traffic, over the same
 * golden cases, from the same fact sheets. That is what makes the comparison meaningful:
 * the only variable is the model.
 *
 * Only the *first* response per case is scored, deliberately. The live path gets one
 * corrective retry; measuring post-retry output would hide a model or prompt regression
 * behind the retry's success.
 *
 * Output: a provider leaderboard, a per-check pass-rate table, per-case results, a JSON
 * report under `server/eval/reports/`, and a non-zero exit code when a tested provider is
 * below threshold - so it can be wired into CI as a blocking step.
 */

const fs = require('fs');
const path = require('path');

const config = require('../config/env');
const { getRawPropertyById } = require('../services/propertyService');
const { buildAnalysisFacts } = require('../ai/analysisFacts');
const { evaluateAnalysis } = require('../ai/evaluation/evaluate');
const { CHECKS, Severity } = require('../ai/evaluation/checks');
const registry = require('../ai/providers');
const { GOLDEN_CASES } = require('./goldenSet');

/* ---------------------------------------------------------------- arguments */

const HELP = `
RentVerse AI analysis evaluation

  node server/eval/runEval.js [options]

  --provider=<spec>          mock | all | configured | <id>[,<id>...]   (default: mock)
                             ids: ${config.ai.providerIds.join(', ')}
  --repeat=N                 Runs per case, to expose variance          (default: 1)
  --threshold=0..1           Minimum critical-check pass rate           (default: 1)
  --require=all|any|primary  Which providers must meet the threshold    (default: all)
  --concurrency=N            Parallel in-flight runs                    (default: 3)
  --limit=N                  Only the first N golden cases
  --filter=<substring>       Only cases whose id contains this
  --no-report                Skip writing the JSON report
  --help                     Show this message
`;

function parseArgs(argv) {
  const options = {
    providerSpec: 'mock',
    threshold: 1,
    repeat: 1,
    concurrency: 3,
    limit: Infinity,
    filter: null,
    require: 'all',
    reportDir: path.resolve(__dirname, 'reports'),
    writeReport: true,
  };

  for (const arg of argv) {
    const [rawKey, rawValue] = arg.replace(/^--/, '').split('=');
    const value = rawValue === undefined ? 'true' : rawValue;

    switch (rawKey) {
      case 'provider':
        options.providerSpec = value;
        break;
      case 'threshold':
        options.threshold = Number(value);
        break;
      case 'repeat':
        options.repeat = Math.max(1, Number(value));
        break;
      case 'concurrency':
        options.concurrency = Math.max(1, Number(value));
        break;
      case 'limit':
        options.limit = Number(value);
        break;
      case 'filter':
        options.filter = value;
        break;
      case 'require':
        options.require = value;
        break;
      case 'no-report':
        options.writeReport = false;
        break;
      case 'help':
        options.help = true;
        break;
      default:
        console.warn(`Ignoring unknown option --${rawKey}`);
    }
  }

  return options;
}

/** Expands `--provider` into a concrete list of ids. */
function resolveProviderList(spec) {
  const configured = config.ai.configuredProviders.filter((id) => id !== 'sample');

  if (spec === 'mock' || spec === 'sample') return ['sample'];
  if (spec === 'all') return configured.length > 0 ? [...configured, 'sample'] : ['sample'];
  if (spec === 'configured') return configured.length > 0 ? configured : ['sample'];

  return spec
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
}

/* ------------------------------------------------------------------ running */

/** Runs `worker` over `items` with a bounded number of in-flight promises. */
async function mapWithConcurrency(items, concurrency, worker) {
  const results = new Array(items.length);
  let cursor = 0;

  const runners = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await worker(items[index], index);
    }
  });

  await Promise.all(runners);
  return results;
}

async function runCase({ testCase, providerId, runIndex }) {
  const base = { caseId: testCase.id, providerId, runIndex, intent: testCase.intent };
  const property = getRawPropertyById(testCase.propertyId);

  if (!property) {
    return {
      ...base,
      error: `Unknown propertyId "${testCase.propertyId}" in golden set.`,
      passed: false,
      score: 0,
      checks: [],
      failedChecks: [],
    };
  }

  const facts = buildAnalysisFacts(property, testCase.investorProfile || {});
  const startedAt = Date.now();

  let provider;
  let generated;
  try {
    provider = registry.resolveProvider(providerId);
    generated = await provider.generateAnalysis(facts);
  } catch (error) {
    return {
      ...base,
      error: `${error.code || error.name}: ${error.message}`,
      passed: false,
      score: 0,
      latencyMs: Date.now() - startedAt,
      checks: [],
      failedChecks: [],
    };
  }

  const evaluation = evaluateAnalysis({
    analysis: generated.analysis,
    facts,
    parseError: generated.parseError,
  });

  return {
    ...base,
    model: generated.providerMeta?.model,
    jsonMode: generated.providerMeta?.jsonMode,
    degradations: generated.providerMeta?.degradations,
    passed: evaluation.passed,
    score: evaluation.score,
    latencyMs: generated.providerMeta?.latencyMs ?? Date.now() - startedAt,
    usage: generated.providerMeta?.usage,
    verdict: generated.analysis?.suitability?.verdict,
    checks: evaluation.checks.map(({ id, severity, passed, detail }) => ({
      id,
      severity,
      passed,
      detail,
    })),
    failedChecks: evaluation.checks.filter((check) => !check.passed).map((check) => check.id),
  };
}

/* ---------------------------------------------------------------- reporting */

function aggregate(results) {
  const perCheck = new Map(
    CHECKS.map((check) => [
      check.id,
      { id: check.id, label: check.label, severity: check.severity, passed: 0, ran: 0, failures: [] },
    ])
  );

  for (const result of results) {
    for (const check of result.checks) {
      const bucket = perCheck.get(check.id);
      if (!bucket) continue;
      bucket.ran += 1;
      if (check.passed) bucket.passed += 1;
      else if (bucket.failures.length < 5) bucket.failures.push(`${result.caseId}: ${check.detail}`);
    }
  }

  const runs = results.length;
  const passedRuns = results.filter((result) => result.passed).length;
  const errored = results.filter((result) => result.error).length;

  const checkList = [...perCheck.values()].map((bucket) => ({
    ...bucket,
    passRate: bucket.ran === 0 ? null : Number((bucket.passed / bucket.ran).toFixed(4)),
  }));

  const criticalChecks = checkList.filter(
    (check) => check.severity === Severity.CRITICAL && check.ran > 0
  );

  return {
    runs,
    passedRuns,
    failedRuns: runs - passedRuns,
    erroredRuns: errored,
    passRate: runs === 0 ? 0 : Number((passedRuns / runs).toFixed(4)),
    meanScore:
      runs === 0 ? 0 : Number((results.reduce((sum, r) => sum + r.score, 0) / runs).toFixed(4)),
    meanLatencyMs:
      runs === 0 ? 0 : Math.round(results.reduce((sum, r) => sum + (r.latencyMs || 0), 0) / runs),
    criticalPassRate:
      criticalChecks.length === 0
        ? 1
        : Number(
            (criticalChecks.reduce((sum, c) => sum + c.passRate, 0) / criticalChecks.length).toFixed(4)
          ),
    perCheck: checkList,
  };
}

const COLOURS = {
  green: '\u001b[32m',
  red: '\u001b[31m',
  yellow: '\u001b[33m',
  bold: '\u001b[1m',
  dim: '\u001b[2m',
  reset: '\u001b[0m',
};
const useColour = process.stdout.isTTY && !process.env.NO_COLOR;
const colour = (name, text) => (useColour ? `${COLOURS[name]}${text}${COLOURS.reset}` : text);
const RULE = '-'.repeat(84);

function printCheckTable(summary, indent = '  ') {
  console.log(`${indent}${'CHECK'.padEnd(24)} ${'SEVERITY'.padEnd(10)} ${'PASS'.padEnd(9)}  RATE`);
  for (const check of summary.perCheck) {
    if (check.ran === 0) continue;
    const ok = check.passRate === 1;
    const marker = ok
      ? colour('green', 'PASS')
      : colour(check.severity === Severity.CRITICAL ? 'red' : 'yellow', 'FAIL');
    console.log(
      `${indent}${check.id.padEnd(24)} ${check.severity.padEnd(10)} ` +
        `${`${check.passed}/${check.ran}`.padEnd(9)} ${`${(check.passRate * 100).toFixed(1)}%`.padStart(6)}  ${marker}`
    );
    if (!ok) {
      check.failures.slice(0, 2).forEach((failure) => console.log(colour('dim', `${indent}    ${failure}`)));
    }
  }
}

function printReport(perProvider, overall, options) {
  console.log(`\n${RULE}`);
  console.log(colour('bold', 'AI analysis evaluation'));
  console.log(
    `providers: ${perProvider.map((entry) => entry.providerId).join(', ')}   ` +
      `cases: ${options.caseCount}   repeat: ${options.repeat}   threshold: ${options.threshold}`
  );
  console.log(RULE);

  if (perProvider.length > 1) {
    console.log(`\n${colour('bold', 'Leaderboard')} (ranked by critical-check pass rate, then score)`);
    console.log(
      `  ${'#'.padEnd(3)}${'PROVIDER'.padEnd(13)}${'MODEL'.padEnd(26)}` +
        `${'CRITICAL'.padEnd(10)}${'SCORE'.padEnd(8)}${'PASSED'.padEnd(9)}${'ERR'.padEnd(5)}LATENCY`
    );
    perProvider.forEach((entry, index) => {
      const { summary } = entry;
      const critical = `${(summary.criticalPassRate * 100).toFixed(1)}%`;
      const tint =
        summary.criticalPassRate >= options.threshold
          ? 'green'
          : summary.criticalPassRate >= 0.8
            ? 'yellow'
            : 'red';
      console.log(
        `  ${String(index + 1).padEnd(3)}${entry.providerId.padEnd(13)}` +
          `${String(entry.model || '-').slice(0, 25).padEnd(26)}` +
          `${colour(tint, critical.padEnd(10))}` +
          `${summary.meanScore.toFixed(3).padEnd(8)}` +
          `${`${summary.passedRuns}/${summary.runs}`.padEnd(9)}` +
          `${String(summary.erroredRuns).padEnd(5)}${summary.meanLatencyMs}ms`
      );
    });
  }

  for (const entry of perProvider) {
    console.log(`\n${colour('bold', `Provider: ${entry.providerId}`)} (${entry.model || 'unknown model'})`);
    printCheckTable(entry.summary);

    console.log('  Per-case:');
    for (const result of entry.results) {
      const status = result.passed ? colour('green', 'PASS') : colour('red', 'FAIL');
      const suffix = result.error
        ? ` ${colour('red', result.error)}`
        : result.failedChecks.length > 0
          ? colour('dim', ` (${result.failedChecks.join(', ')})`)
          : '';
      const label = options.repeat > 1 ? `${result.caseId}#${result.runIndex + 1}` : result.caseId;
      console.log(
        `    ${status}  ${label.padEnd(28)} score=${result.score.toFixed(2)}  ` +
          `${String(result.latencyMs || 0).padStart(6)}ms${suffix}`
      );
    }
  }

  console.log(`\n${RULE}`);
  console.log(
    `Total runs: ${overall.runs}   Passed: ${overall.passedRuns}   Failed: ${overall.failedRuns}   ` +
      `Errored: ${overall.erroredRuns}   Mean score: ${overall.meanScore.toFixed(3)}`
  );
  console.log(`${RULE}\n`);
}

function writeReport(reportDir, payload) {
  fs.mkdirSync(reportDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const target = path.join(reportDir, `eval-${payload.providers.join('+')}-${stamp}.json`);
  fs.writeFileSync(target, JSON.stringify(payload, null, 2));
  return target;
}

/* --------------------------------------------------------------------- main */

async function main() {
  const options = parseArgs(process.argv.slice(2));

  if (options.help) {
    console.log(HELP);
    return 0;
  }

  let cases = GOLDEN_CASES;
  if (options.filter) cases = cases.filter((testCase) => testCase.id.includes(options.filter));
  if (Number.isFinite(options.limit)) cases = cases.slice(0, options.limit);

  if (cases.length === 0) {
    console.error('No golden cases matched the given options.');
    return 1;
  }
  options.caseCount = cases.length;

  const providerIds = resolveProviderList(options.providerSpec);

  const unknown = providerIds.filter((id) => !registry.isKnownProvider(id));
  if (unknown.length > 0) {
    console.error(`Unknown provider(s): ${unknown.join(', ')}.`);
    console.error(`Known providers: ${config.ai.providerIds.join(', ')}`);
    return 1;
  }

  const unconfigured = providerIds.filter((id) => !registry.isConfigured(id));
  if (unconfigured.length > 0) {
    console.error(
      `Not configured: ${unconfigured.join(', ')}. Set the matching API keys ` +
        '(see docs/AI_PROVIDERS.md) or run with --provider=mock.'
    );
    return 1;
  }

  const runs = [];
  for (const providerId of providerIds) {
    for (let repeat = 0; repeat < options.repeat; repeat += 1) {
      cases.forEach((testCase) => runs.push({ testCase, providerId, runIndex: repeat }));
    }
  }

  console.log(
    `Running ${runs.length} evaluation run(s): ${cases.length} case(s) x ${options.repeat} repeat(s) ` +
      `x ${providerIds.length} provider(s) [${providerIds.join(', ')}]...`
  );

  const startedAt = Date.now();
  const allResults = await mapWithConcurrency(runs, options.concurrency, (run) => runCase(run));

  const perProvider = providerIds
    .map((providerId) => {
      const results = allResults.filter((result) => result.providerId === providerId);
      return {
        providerId,
        model: results.find((result) => result.model)?.model || registry.getDefinition(providerId)?.model,
        results,
        summary: aggregate(results),
      };
    })
    .sort(
      (a, b) =>
        b.summary.criticalPassRate - a.summary.criticalPassRate ||
        b.summary.meanScore - a.summary.meanScore ||
        a.summary.meanLatencyMs - b.summary.meanLatencyMs
    );

  const overall = aggregate(allResults);
  printReport(perProvider, overall, options);

  const payload = {
    providers: providerIds,
    startedAt: new Date(startedAt).toISOString(),
    durationMs: Date.now() - startedAt,
    options: {
      repeat: options.repeat,
      threshold: options.threshold,
      require: options.require,
      cases: cases.length,
    },
    overall,
    perProvider: perProvider.map(({ providerId, model, summary, results }) => ({
      providerId,
      model,
      summary,
      results,
    })),
  };

  if (options.writeReport) {
    const target = writeReport(options.reportDir, payload);
    console.log(`Report written to ${path.relative(process.cwd(), target)}\n`);
  }

  /* --------------------------------------------------------- pass / fail gate */

  const meeting = perProvider.filter((entry) => entry.summary.criticalPassRate >= options.threshold);
  const describe = (entry) =>
    `${entry.providerId} ${(entry.summary.criticalPassRate * 100).toFixed(1)}%`;

  let ok;
  let explanation;

  if (options.require === 'any') {
    ok = meeting.length > 0;
    explanation = ok
      ? `at least one provider met the threshold (${meeting.map(describe).join(', ')})`
      : 'no provider met the threshold';
  } else if (options.require === 'primary') {
    const primary = perProvider.find((entry) => entry.providerId === config.ai.provider) || perProvider[0];
    ok = primary.summary.criticalPassRate >= options.threshold;
    explanation = `primary provider ${describe(primary)}`;
  } else {
    const failing = perProvider.filter((entry) => entry.summary.criticalPassRate < options.threshold);
    ok = failing.length === 0;
    explanation = ok
      ? `every provider met the threshold (${perProvider.map(describe).join(', ')})`
      : `below threshold: ${failing.map(describe).join(', ')}`;
  }

  const verdict = `${(options.threshold * 100).toFixed(1)}% critical-check threshold - ${explanation}.`;
  if (!ok) {
    console.error(colour('red', `FAILED: ${verdict}`));
    return 1;
  }

  console.log(colour('green', `PASSED: ${verdict}`));
  return 0;
}

main()
  .then((exitCode) => {
    process.exitCode = exitCode;
  })
  .catch((error) => {
    console.error('Evaluation run crashed:', error);
    process.exitCode = 1;
  });
