'use strict';

const { SUITABILITY_VERDICTS, RISK_SEVERITIES } = require('../analysisSchema');
const { collectNumericFacts } = require('../analysisFacts');

/**
 * The quality checks applied to every generated analysis.
 *
 * Each check is deterministic, cheap (single-digit milliseconds) and independent, which is
 * what lets the same suite run in two places:
 *   - inline, as a gate on the live request (see `evaluate.js` / `analysisService.js`);
 *   - offline, as a regression suite over a golden set (`npm run eval:ai`).
 *
 * There is deliberately no LLM-as-judge here. Judging a judge costs another model call,
 * adds latency to the request path and introduces its own variance; the failure modes that
 * actually matter for generated financial copy - invented figures, guarantee language, a
 * missing risk section, a missing disclaimer - are all mechanically detectable. A model
 * judge would be the right tool for tone or usefulness, which is not what gates the
 * response.
 *
 * Severity drives behaviour, not just reporting:
 *   `critical` - a failure blocks the response (one regeneration is attempted first).
 *   `warning`  - recorded in the scorecard and returned to the client, does not block.
 */

const Severity = { CRITICAL: 'critical', WARNING: 'warning' };
const SEVERITY_WEIGHT = { [Severity.CRITICAL]: 2, [Severity.WARNING]: 1 };

// Small integers are counts, months and ordinals ("two of the four tenants", "12 months"),
// and 100 is the percentage base. Treating them as always-grounded avoids a large class of
// false rejections without weakening the check against invented financial figures.
const ALWAYS_GROUNDED_MAX_INTEGER = 12;
const PERCENT_BASE = 100;

// Relative tolerance for a figure the model rounded rather than copied (0.5%).
const GROUNDING_RELATIVE_TOLERANCE = 0.005;

const MAX_REPORTED_ITEMS = 5;

const GUARANTEE_PATTERNS = [
  { pattern: /\bguarantee(?:d|s|ing)?\b/i, label: 'guarantee' },
  { pattern: /\brisk[-\s]?free\b/i, label: 'risk-free' },
  { pattern: /\b(?:no|zero)\s+risk\b/i, label: 'no risk' },
  { pattern: /\bassured\b/i, label: 'assured' },
  { pattern: /\bcan(?:no|')?t\s+lose\b/i, label: "can't lose" },
  { pattern: /\bsafe\s+(?:investment|bet|return)/i, label: 'safe investment' },
  { pattern: /\bsecure\s+returns?\b/i, label: 'secure returns' },
  { pattern: /\bwill\s+definitely\b/i, label: 'will definitely' },
  { pattern: /\bcertain\s+to\s+(?:rise|grow|return|appreciate)\b/i, label: 'certain to rise' },
];

const ADVICE_PATTERNS = [
  { pattern: /\byou\s+should\s+(?:buy|invest|purchase|sell|acquire)\b/i, label: 'you should buy' },
  { pattern: /\bwe\s+recommend\b/i, label: 'we recommend' },
  { pattern: /\b(?:buy|invest)\s+now\b/i, label: 'invest now' },
  { pattern: /\brecommend(?:ed|s)?\s+(?:buying|investing|purchasing)\b/i, label: 'recommend investing' },
  { pattern: /\bthis\s+is\s+a\s+must[-\s]buy\b/i, label: 'must-buy' },
];

const INSTRUCTION_LEAK_PATTERNS = [
  { pattern: /\bas\s+an?\s+(?:ai|language\s+model)\b/i, label: 'as an AI' },
  { pattern: /\blanguage\s+model\b/i, label: 'language model' },
  { pattern: /\bsystem\s+prompt\b/i, label: 'system prompt' },
  { pattern: /\babsolute\s+rules\b/i, label: 'absolute rules' },
  { pattern: /\bthese\s+instructions\b/i, label: 'these instructions' },
  { pattern: /\bjson\s+schema\b/i, label: 'json schema' },
];

const PROFILE_KEYWORDS = [
  'budget',
  'horizon',
  'risk',
  'tolerance',
  'goal',
  'income',
  'appreciation',
  'conservative',
  'moderate',
  'aggressive',
  'balanced',
  'year',
];

/* ------------------------------------------------------------------ helpers */

/** Collects every string value in the analysis, with a dotted path for reporting. */
function collectStrings(node, path = '', collected = []) {
  if (typeof node === 'string') {
    collected.push({ path: path || 'root', text: node });
    return collected;
  }
  if (Array.isArray(node)) {
    node.forEach((item, index) => collectStrings(item, `${path}[${index}]`, collected));
    return collected;
  }
  if (node && typeof node === 'object') {
    Object.entries(node).forEach(([key, value]) =>
      collectStrings(value, path ? `${path}.${key}` : key, collected)
    );
  }
  return collected;
}

function allText(analysis) {
  return collectStrings(analysis)
    .map((entry) => entry.text)
    .join('\n');
}

/** Extracts numeric literals, tolerating `$`, thousands separators and `%`. */
function extractNumbers(text) {
  const matches = text.match(/\d[\d,]*(?:\.\d+)?/g) || [];
  return matches
    .map((raw) => Number(raw.replace(/,/g, '')))
    .filter((value) => Number.isFinite(value));
}

function roundTo(value, decimals) {
  const factor = 10 ** decimals;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}

function isGrounded(value, factValues) {
  if (Number.isInteger(value) && value >= 0 && value <= ALWAYS_GROUNDED_MAX_INTEGER) return true;
  if (value === PERCENT_BASE) return true;

  for (const fact of factValues) {
    if (value === fact) return true;
    // A figure the model rounded rather than copied verbatim.
    if (roundTo(fact, 0) === value || roundTo(fact, 1) === value || roundTo(fact, 2) === value) {
      return true;
    }
    const scale = Math.max(Math.abs(fact), 1);
    if (Math.abs(value - fact) / scale <= GROUNDING_RELATIVE_TOLERANCE) return true;
  }

  return false;
}

function matchPatterns(text, patterns) {
  return patterns.filter(({ pattern }) => pattern.test(text)).map(({ label }) => label);
}

const isNonEmptyString = (value, minLength = 1) =>
  typeof value === 'string' && value.trim().length >= minLength;

const pass = (detail) => ({ passed: true, detail });
const fail = (detail, evidence) => ({ passed: false, detail, evidence });

/* ------------------------------------------------------------------- checks */

const CHECKS = [
  {
    id: 'output_parsed',
    label: 'Response is valid JSON',
    severity: Severity.CRITICAL,
    rationale: 'A constrained decoder still has to be verified; malformed output must never reach the UI.',
    run({ analysis, parseError }) {
      if (parseError) return fail(`Provider output could not be parsed as JSON: ${parseError}`);
      if (!analysis || typeof analysis !== 'object' || Array.isArray(analysis)) {
        return fail('Provider returned no analysis object.');
      }
      return pass('Parsed cleanly into an object.');
    },
  },

  {
    id: 'schema_shape',
    label: 'Matches the analysis contract',
    severity: Severity.CRITICAL,
    rationale: 'Missing or malformed sections would render as blank panels in the UI.',
    run({ analysis }) {
      if (!analysis || typeof analysis !== 'object') return fail('No analysis object to validate.');

      const problems = [];

      if (!isNonEmptyString(analysis.headline)) problems.push('headline is missing or empty');
      if (!isNonEmptyString(analysis.summary, 40)) problems.push('summary is missing or too short');
      if (!isNonEmptyString(analysis.disclaimer, 20)) problems.push('disclaimer is missing or too short');

      const suitability = analysis.suitability;
      if (!suitability || typeof suitability !== 'object') {
        problems.push('suitability is missing');
      } else {
        if (!SUITABILITY_VERDICTS.includes(suitability.verdict)) {
          problems.push(`suitability.verdict "${suitability.verdict}" is not a recognised verdict`);
        }
        if (!isNonEmptyString(suitability.rationale, 20)) {
          problems.push('suitability.rationale is missing or too short');
        }
      }

      const arrayRules = [
        { key: 'strengths', min: 2, max: 5, fields: ['point', 'evidence'] },
        { key: 'risks', min: 2, max: 5, fields: ['risk', 'mitigation'] },
        { key: 'keyMetrics', min: 3, max: 6, fields: ['label', 'value', 'interpretation'] },
      ];

      for (const rule of arrayRules) {
        const value = analysis[rule.key];
        if (!Array.isArray(value)) {
          problems.push(`${rule.key} is not an array`);
          continue;
        }
        if (value.length < rule.min || value.length > rule.max) {
          problems.push(`${rule.key} has ${value.length} items, expected ${rule.min}-${rule.max}`);
        }
        value.forEach((item, index) => {
          if (!item || typeof item !== 'object') {
            problems.push(`${rule.key}[${index}] is not an object`);
            return;
          }
          rule.fields.forEach((field) => {
            if (!isNonEmptyString(item[field], 3)) {
              problems.push(`${rule.key}[${index}].${field} is missing or empty`);
            }
          });
        });
      }

      if (Array.isArray(analysis.risks)) {
        analysis.risks.forEach((risk, index) => {
          if (risk && !RISK_SEVERITIES.includes(risk.severity)) {
            problems.push(`risks[${index}].severity "${risk?.severity}" is not low/medium/high`);
          }
        });
      }

      const questions = analysis.questionsToAsk;
      if (!Array.isArray(questions)) {
        problems.push('questionsToAsk is not an array');
      } else {
        if (questions.length < 2 || questions.length > 5) {
          problems.push(`questionsToAsk has ${questions.length} items, expected 2-5`);
        }
        questions.forEach((question, index) => {
          if (!isNonEmptyString(question, 10)) {
            problems.push(`questionsToAsk[${index}] is missing or too short`);
          }
        });
      }

      return problems.length === 0
        ? pass('All required sections are present and well formed.')
        : fail(`${problems.length} contract violation(s).`, problems.slice(0, MAX_REPORTED_ITEMS));
    },
  },

  {
    id: 'numeric_grounding',
    label: 'Every figure traces back to the source data',
    severity: Severity.CRITICAL,
    rationale:
      'Invented figures are the highest-impact failure mode for generated investment copy: ' +
      'they are plausible, specific, and a reader has no way to tell them apart from real ones.',
    run({ analysis, facts }) {
      if (!analysis) return fail('No analysis object to validate.');

      const factValues = collectNumericFacts(facts);
      const ungrounded = [];

      for (const { path, text } of collectStrings(analysis)) {
        for (const value of extractNumbers(text)) {
          if (!isGrounded(value, factValues)) {
            ungrounded.push({ value, path });
          }
        }
      }

      if (ungrounded.length === 0) {
        return pass(`All figures matched the ${factValues.size} values in the source data.`);
      }

      // De-duplicate so one repeated bad figure is reported once.
      const seen = new Set();
      const unique = ungrounded.filter(({ value }) => {
        if (seen.has(value)) return false;
        seen.add(value);
        return true;
      });

      return fail(
        `${unique.length} figure(s) do not appear in the source data.`,
        unique.slice(0, MAX_REPORTED_ITEMS).map(({ value, path }) => `${value} (in ${path})`)
      );
    },
  },

  {
    id: 'no_guarantee_language',
    label: 'No guaranteed-return language',
    severity: Severity.CRITICAL,
    rationale:
      'Describing a projected property return as guaranteed or risk-free is a compliance ' +
      'problem, not a style problem.',
    run({ analysis }) {
      const hits = matchPatterns(allText(analysis), GUARANTEE_PATTERNS);
      return hits.length === 0
        ? pass('No guarantee or risk-free phrasing found.')
        : fail(`Prohibited phrasing found: ${hits.join(', ')}.`, hits);
    },
  },

  {
    id: 'risk_coverage',
    label: 'Risks are specific and actionable',
    severity: Severity.CRITICAL,
    rationale:
      'A balanced analysis is the product requirement; a risk section of generic filler ' +
      'technically satisfies the schema while defeating the purpose.',
    run({ analysis }) {
      const risks = Array.isArray(analysis?.risks) ? analysis.risks : [];
      if (risks.length < 2) return fail(`Only ${risks.length} risk(s) provided; at least 2 required.`);

      const problems = [];
      risks.forEach((risk, index) => {
        if (!isNonEmptyString(risk?.risk, 25)) {
          problems.push(`risks[${index}].risk is too short to be specific`);
        }
        if (!isNonEmptyString(risk?.mitigation, 25)) {
          problems.push(`risks[${index}].mitigation is too short to be actionable`);
        }
        if (
          isNonEmptyString(risk?.risk) &&
          isNonEmptyString(risk?.mitigation) &&
          risk.risk.trim().toLowerCase() === risk.mitigation.trim().toLowerCase()
        ) {
          problems.push(`risks[${index}].mitigation just restates the risk`);
        }
      });

      return problems.length === 0
        ? pass(`${risks.length} risks, each with a distinct mitigation.`)
        : fail(`${problems.length} risk-quality problem(s).`, problems.slice(0, MAX_REPORTED_ITEMS));
    },
  },

  {
    id: 'disclaimer_present',
    label: 'Carries a not-advice disclaimer',
    severity: Severity.CRITICAL,
    rationale: 'Automated output about an investment must say what it is not.',
    run({ analysis }) {
      const disclaimer = typeof analysis?.disclaimer === 'string' ? analysis.disclaimer : '';
      if (!/not\s+(?:financial|investment|professional)\s+advice/i.test(disclaimer)) {
        return fail('Disclaimer does not state that this is not financial advice.', [
          disclaimer.slice(0, 120) || '(empty)',
        ]);
      }
      return pass('Disclaimer states the output is not financial advice.');
    },
  },

  {
    id: 'no_instruction_leak',
    label: 'No prompt or model artefacts in the output',
    severity: Severity.CRITICAL,
    rationale: 'Leaked scaffolding breaks the product illusion and can expose internal wording.',
    run({ analysis }) {
      const hits = matchPatterns(allText(analysis), INSTRUCTION_LEAK_PATTERNS);
      return hits.length === 0
        ? pass('No prompt scaffolding or model self-reference found.')
        : fail(`Output leaked internal phrasing: ${hits.join(', ')}.`, hits);
    },
  },

  {
    id: 'profile_alignment',
    label: 'Suitability verdict matches the request',
    severity: Severity.CRITICAL,
    rationale:
      'The investor profile is the reason this endpoint is personalised; silently ignoring it ' +
      'produces confident but irrelevant output.',
    run({ analysis, facts }) {
      const suitability = analysis?.suitability;
      if (!suitability || typeof suitability !== 'object') return fail('suitability block is missing.');

      const hasProfile = Boolean(facts && facts.investorProfile);

      if (!hasProfile) {
        return suitability.verdict === 'not_assessed'
          ? pass('No profile supplied and the verdict correctly abstains.')
          : fail(
              `No investor profile was supplied but the verdict is "${suitability.verdict}"; ` +
                'expected "not_assessed".'
            );
      }

      if (suitability.verdict === 'not_assessed') {
        return fail('An investor profile was supplied but suitability was not assessed.');
      }

      const rationale = String(suitability.rationale || '').toLowerCase();
      const referenced = PROFILE_KEYWORDS.filter((keyword) => rationale.includes(keyword));
      if (referenced.length === 0) {
        return fail('Rationale does not reference any dimension of the investor profile.');
      }

      return pass(`Verdict "${suitability.verdict}" justified against: ${referenced.join(', ')}.`);
    },
  },

  {
    id: 'not_advice',
    label: 'Reads as analysis, not a recommendation',
    severity: Severity.WARNING,
    rationale: 'The platform is not licensed to advise; the copy should not instruct the reader.',
    run({ analysis }) {
      const hits = matchPatterns(allText(analysis), ADVICE_PATTERNS);
      return hits.length === 0
        ? pass('No direct buy/sell instruction found.')
        : fail(`Directive phrasing found: ${hits.join(', ')}.`, hits);
    },
  },

  {
    id: 'evidence_coverage',
    label: 'Strengths are backed by figures',
    severity: Severity.WARNING,
    rationale: 'Unevidenced positives are marketing; the product promise is evidence-led analysis.',
    run({ analysis }) {
      const strengths = Array.isArray(analysis?.strengths) ? analysis.strengths : [];
      if (strengths.length === 0) return fail('No strengths provided.');

      const withFigures = strengths.filter(
        (strength) => extractNumbers(String(strength?.evidence || '')).length > 0
      ).length;

      const ratio = withFigures / strengths.length;
      return ratio >= 0.5
        ? pass(`${withFigures} of ${strengths.length} strengths cite a figure.`)
        : fail(`Only ${withFigures} of ${strengths.length} strengths cite a figure.`);
    },
  },

  {
    id: 'property_reference',
    label: 'Analysis is about this listing',
    severity: Severity.WARNING,
    rationale: 'Generic output that never names the asset is a sign the fact sheet was ignored.',
    run({ analysis, facts }) {
      const text = allText(analysis).toLowerCase();
      const title = String(facts?.property?.title || '').toLowerCase();
      const location = String(facts?.property?.location || '').toLowerCase();
      const city = location.split(',')[0].trim();

      const mentionsTitle = title && text.includes(title);
      const mentionsLocation = city && text.includes(city);

      return mentionsTitle || mentionsLocation
        ? pass('Output names the listing or its location.')
        : fail('Output never names this listing or its location.');
    },
  },

  {
    id: 'length_bounds',
    label: 'Sections are within display limits',
    severity: Severity.WARNING,
    rationale: 'The panel has a fixed layout; over-long sections truncate or overflow in the UI.',
    run({ analysis }) {
      const limits = [
        { path: 'headline', value: analysis?.headline, max: 120 },
        { path: 'summary', value: analysis?.summary, max: 1200 },
        { path: 'suitability.rationale', value: analysis?.suitability?.rationale, max: 900 },
        { path: 'disclaimer', value: analysis?.disclaimer, max: 600 },
      ];

      const problems = limits
        .filter(({ value, max }) => typeof value === 'string' && value.length > max)
        .map(({ path, value, max }) => `${path} is ${value.length} chars (max ${max})`);

      return problems.length === 0
        ? pass('All sections are within their display limits.')
        : fail(`${problems.length} section(s) exceed their limit.`, problems);
    },
  },
];

module.exports = {
  CHECKS,
  Severity,
  SEVERITY_WEIGHT,
  // Exported for unit tests and for reuse by the offline evaluation runner.
  extractNumbers,
  isGrounded,
  collectStrings,
  GUARANTEE_PATTERNS,
  ADVICE_PATTERNS,
};
