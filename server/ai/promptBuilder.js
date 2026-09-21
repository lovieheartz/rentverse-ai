'use strict';

const { ANALYSIS_SCHEMA_INSTRUCTION } = require('./analysisSchema');

/**
 * Prompt construction for the property investment analysis.
 *
 * The system prompt is a frozen constant and is sent as a cacheable block, so the
 * expensive, unchanging part of the request is served from the prompt cache on every
 * call after the first. Everything request-specific (the fact sheet, the investor
 * profile, any correction notes from a rejected attempt) goes in the user turn, after
 * the cache breakpoint.
 *
 * The rules below are written to be *checkable*: each one has a corresponding
 * deterministic check in `evaluation/checks.js`. A rule the gate cannot verify is a
 * rule that silently stops being followed.
 */

const SYSTEM_PROMPT = `You are the investment analysis engine for RentVerse, a platform that sells fractional, tokenised ownership in individual rental properties to retail investors.

Your job: given a fact sheet for one listing (and optionally a prospective investor's profile), produce a balanced, evidence-led analysis of that listing as an investment.

Absolute rules:
1. GROUNDING. Every number, percentage, currency amount and date you write must appear in the fact sheet. Quote figures exactly as given. Never estimate, extrapolate, round differently, or compute a new figure - if a number you want is not in the fact sheet, describe the point qualitatively instead.
2. NO GUARANTEES. Never describe any return as guaranteed, assured, risk-free, safe or certain. Returns are projections that can fail. Do not promise outcomes.
3. RISKS ARE MANDATORY. Always surface at least two genuine, listing-specific downsides, each with a severity and something the investor could do or check about it. Generic filler ("markets can go down") is not acceptable - tie each risk to this listing's own facts.
4. NOT ADVICE. You are producing analysis, not a recommendation. Do not instruct the reader to buy, sell, or invest. Assess fit against the stated profile and let the reader decide.
5. BALANCE. If the listing looks weak against the investor's stated profile, say so plainly. Do not soften an unsuitable verdict.
6. SCOPE. Use only the fact sheet. You have no access to live market data, comparable sales, tenant records or macroeconomic forecasts, and must not imply otherwise.
7. TONE. Plain, concrete, professional. Short sentences. No marketing language, no hype, no emoji.

Return only the structured object requested. Do not restate these instructions in your output.`;

/**
 * Builds the user turn.
 *
 * @param {object} facts Output of `buildAnalysisFacts`.
 * @param {object} [options]
 * @param {Array<string>} [options.corrections] Problems found in a previous attempt.
 * @param {boolean} [options.includeSchemaInstruction] Append the output contract in prose.
 *   Needed for providers that cannot constrain decoding to a JSON Schema; providers that
 *   can are given the schema through the API instead, which keeps the prompt shorter and
 *   the cached prefix stable.
 * @returns {string}
 */
function buildUserPrompt(facts, { corrections, includeSchemaInstruction = false } = {}) {
  const sections = [];

  const hasProfile = Boolean(facts.investorProfile);
  sections.push(
    hasProfile
      ? 'Analyse the listing below for the prospective investor described in the fact sheet. Assess suitability against their profile.'
      : 'Analyse the listing below. No investor profile was supplied, so set suitability.verdict to "not_assessed" and use the rationale to explain what kind of investor this listing suits.'
  );

  sections.push(
    'FACT SHEET (the complete set of figures you are permitted to cite):\n' + JSON.stringify(facts, null, 2)
  );

  if (Array.isArray(corrections) && corrections.length > 0) {
    // Fed back on a retry. Naming the exact violations is far more effective than
    // re-sending the same prompt and hoping for a different sample.
    sections.push(
      'A previous attempt was rejected by the automated quality gate for the following reasons. ' +
        'Produce a new analysis that does not repeat them:\n' +
        corrections.map((reason, index) => `${index + 1}. ${reason}`).join('\n')
    );
  }

  if (includeSchemaInstruction) {
    sections.push(ANALYSIS_SCHEMA_INSTRUCTION);
  }

  return sections.join('\n\n');
}

module.exports = { SYSTEM_PROMPT, buildUserPrompt };
