'use strict';

/**
 * Tolerant JSON extraction for model output.
 *
 * Providers differ in how strictly they can be held to a schema. Anthropic and OpenAI
 * constrain decoding to a JSON Schema; several others only support a loose "JSON mode";
 * a few support neither and can only be asked politely in the prompt. Even within JSON
 * mode, models wrap output in ```json fences or add a sentence before the object often
 * enough that a bare `JSON.parse` fails on output that is otherwise perfectly good.
 *
 * This normalises those cases without ever *repairing* content: it only strips wrappers
 * and locates the object. Anything that survives still has to pass the quality gate, so a
 * lenient parser here does not weaken the guarantees downstream.
 */

/** Strips markdown code fences, keeping the fenced body. */
function stripCodeFences(text) {
  const fenced = text.match(/```(?:json|JSON)?\s*([\s\S]*?)```/);
  return fenced ? fenced[1] : text;
}

/**
 * Finds the first complete top-level JSON object, respecting strings and escapes so a
 * `}` inside a string value does not terminate the scan early.
 */
function findFirstJsonObject(text) {
  const start = text.indexOf('{');
  if (start === -1) return null;

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let index = start; index < text.length; index += 1) {
    const character = text[index];

    if (escaped) {
      escaped = false;
      continue;
    }
    if (character === '\\') {
      if (inString) escaped = true;
      continue;
    }
    if (character === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;

    if (character === '{') depth += 1;
    else if (character === '}') {
      depth -= 1;
      if (depth === 0) return text.slice(start, index + 1);
    }
  }

  return null;
}

/**
 * @param {string} raw Raw text from the provider.
 * @returns {{ analysis: object|null, parseError?: string }}
 */
function parseAnalysisJson(raw) {
  if (typeof raw !== 'string' || raw.trim() === '') {
    return { analysis: null, parseError: 'Provider returned an empty response.' };
  }

  const candidates = [];
  const trimmed = raw.trim();
  candidates.push(trimmed);

  const unfenced = stripCodeFences(trimmed).trim();
  if (unfenced !== trimmed) candidates.push(unfenced);

  const extracted = findFirstJsonObject(unfenced);
  if (extracted && extracted !== unfenced) candidates.push(extracted);

  let lastError = 'No JSON object found in the response.';
  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return { analysis: parsed };
      }
      lastError = 'Parsed JSON was not an object.';
    } catch (error) {
      lastError = error.message;
    }
  }

  return { analysis: null, parseError: lastError };
}

module.exports = { parseAnalysisJson, stripCodeFences, findFirstJsonObject };
