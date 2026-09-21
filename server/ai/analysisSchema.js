'use strict';

/**
 * Output contract for the investment analysis.
 *
 * `ANALYSIS_JSON_SCHEMA` is sent to the Messages API as a structured-output format, so
 * the model is constrained to this shape rather than asked politely for JSON. Only
 * broadly-supported JSON Schema keywords are used here (type/properties/required/
 * additionalProperties/items/enum/minItems/maxItems); string length and content rules
 * are enforced by the quality gate in `evaluation/`, which has to re-validate the shape
 * anyway - a constrained decoder is not a substitute for checking what came back.
 */

const SUITABILITY_VERDICTS = ['aligned', 'partially_aligned', 'not_aligned', 'not_assessed'];
const RISK_SEVERITIES = ['low', 'medium', 'high'];

const ANALYSIS_JSON_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: [
    'headline',
    'summary',
    'suitability',
    'strengths',
    'risks',
    'keyMetrics',
    'questionsToAsk',
    'disclaimer',
  ],
  properties: {
    headline: {
      type: 'string',
      description: 'One short line (max ~90 characters) capturing the investment case.',
    },
    summary: {
      type: 'string',
      description:
        'Two to four sentences describing what this listing is and how it earns a return. ' +
        'Reference the property by name and location.',
    },
    suitability: {
      type: 'object',
      additionalProperties: false,
      required: ['verdict', 'rationale'],
      properties: {
        verdict: {
          type: 'string',
          enum: SUITABILITY_VERDICTS,
          description:
            'Fit against the supplied investor profile. Use "not_assessed" only when no ' +
            'investor profile was provided.',
        },
        rationale: {
          type: 'string',
          description:
            'Why that verdict. When a profile was supplied, reference at least one of its ' +
            'dimensions (budget, horizon, risk tolerance, goal) explicitly.',
        },
      },
    },
    strengths: {
      type: 'array',
      minItems: 2,
      maxItems: 5,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['point', 'evidence'],
        properties: {
          point: { type: 'string', description: 'The strength, stated in one clause.' },
          evidence: {
            type: 'string',
            description: 'The specific figure or fact from the fact sheet that supports it.',
          },
        },
      },
    },
    risks: {
      type: 'array',
      minItems: 2,
      maxItems: 5,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['risk', 'severity', 'mitigation'],
        properties: {
          risk: { type: 'string', description: 'A concrete downside specific to this listing.' },
          severity: { type: 'string', enum: RISK_SEVERITIES },
          mitigation: {
            type: 'string',
            description: 'What would reduce this risk, or how an investor could check it.',
          },
        },
      },
    },
    keyMetrics: {
      type: 'array',
      minItems: 3,
      maxItems: 6,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['label', 'value', 'interpretation'],
        properties: {
          label: { type: 'string', description: 'Metric name, e.g. "Net rental yield".' },
          value: {
            type: 'string',
            description: 'The value exactly as it appears in the fact sheet, with its unit.',
          },
          interpretation: { type: 'string', description: 'What it means for the investor.' },
        },
      },
    },
    questionsToAsk: {
      type: 'array',
      minItems: 2,
      maxItems: 5,
      items: { type: 'string' },
      description: 'Diligence questions the fact sheet does not answer.',
    },
    disclaimer: {
      type: 'string',
      description:
        'A short statement that this is an automated analysis and not financial advice.',
    },
  },
};

/**
 * Strict-mode variant of the schema.
 *
 * OpenAI-style structured outputs (`response_format.json_schema` with `strict: true`) accept
 * only a subset of JSON Schema and reject `minItems` / `maxItems` outright. Those bounds are
 * re-checked by the quality gate regardless, so dropping them here costs nothing and is the
 * difference between a working request and a 400 on several providers.
 */
function toStrictJsonSchema(node) {
  if (Array.isArray(node)) return node.map(toStrictJsonSchema);
  if (!node || typeof node !== 'object') return node;

  const result = {};
  for (const [key, value] of Object.entries(node)) {
    if (key === 'minItems' || key === 'maxItems') continue;
    result[key] = toStrictJsonSchema(value);
  }
  return result;
}

const ANALYSIS_STRICT_JSON_SCHEMA = toStrictJsonSchema(ANALYSIS_JSON_SCHEMA);

/** Human-readable contract, appended to the prompt for providers with no schema support. */
const ANALYSIS_SCHEMA_INSTRUCTION = `Respond with a single JSON object and nothing else - no prose, no markdown fences. It must match this shape exactly:

{
  "headline": string,
  "summary": string,
  "suitability": { "verdict": "aligned" | "partially_aligned" | "not_aligned" | "not_assessed", "rationale": string },
  "strengths": [ { "point": string, "evidence": string } ],            // 2 to 5 entries
  "risks":     [ { "risk": string, "severity": "low" | "medium" | "high", "mitigation": string } ],  // 2 to 5 entries
  "keyMetrics":[ { "label": string, "value": string, "interpretation": string } ],                   // 3 to 6 entries
  "questionsToAsk": [ string ],                                         // 2 to 5 entries
  "disclaimer": string
}

Include every key. Do not add keys that are not listed.`;

module.exports = {
  ANALYSIS_JSON_SCHEMA,
  ANALYSIS_STRICT_JSON_SCHEMA,
  ANALYSIS_SCHEMA_INSTRUCTION,
  SUITABILITY_VERDICTS,
  RISK_SEVERITIES,
  toStrictJsonSchema,
};
