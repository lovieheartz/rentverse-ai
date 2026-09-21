'use strict';

/**
 * A small declarative request validator.
 *
 * Why not a library: the project already ships `validator` for string assertions but
 * has no schema layer, and the one thing this API needs - coercing query strings into
 * numbers/booleans/enums and reporting *all* offending fields at once - fits in a file
 * this size. Keeping it dependency-free also keeps the server startable in environments
 * where installing extra packages is not an option.
 *
 * A schema is a plain object of `field -> rule`:
 *
 *   {
 *     page:  { type: 'integer', min: 1, default: 1 },
 *     type:  { type: 'enum', values: ['house', 'villa'], default: 'house' },
 *     search:{ type: 'string', maxLength: 120, trim: true },
 *     profile: { type: 'object', fields: { budgetUsd: { type: 'number', min: 1 } } },
 *   }
 *
 * `validate()` returns `{ value, errors }`; it never throws on bad input. Every error is
 * `{ field, code, message, received? }` so a client can map failures back to form fields.
 */

const ErrorCode = {
  REQUIRED: 'required',
  UNKNOWN_FIELD: 'unknown_field',
  INVALID_TYPE: 'invalid_type',
  OUT_OF_RANGE: 'out_of_range',
  TOO_SHORT: 'too_short',
  TOO_LONG: 'too_long',
  PATTERN_MISMATCH: 'pattern_mismatch',
  NOT_ALLOWED: 'not_allowed',
  TOO_MANY_ITEMS: 'too_many_items',
};

const MAX_RECEIVED_PREVIEW = 80;

/** Truncates echoed input so error payloads cannot be used to reflect large bodies back. */
function preview(value) {
  if (value === null || value === undefined) return value;
  if (typeof value === 'object') return Array.isArray(value) ? '[array]' : '[object]';

  const asString = String(value);
  return asString.length > MAX_RECEIVED_PREVIEW
    ? `${asString.slice(0, MAX_RECEIVED_PREVIEW)}...`
    : asString;
}

function isAbsent(value) {
  return value === undefined || value === null || value === '';
}

function coerceNumber(value) {
  // Number('') === 0 and Number([]) === 0, so guard explicitly before converting.
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;
  if (typeof value !== 'string') return undefined;

  const trimmed = value.trim();
  if (trimmed === '') return undefined;

  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function coerceBoolean(value) {
  if (typeof value === 'boolean') return value;
  if (typeof value !== 'string') return undefined;

  const normalised = value.trim().toLowerCase();
  if (['true', '1', 'yes', 'on'].includes(normalised)) return true;
  if (['false', '0', 'no', 'off'].includes(normalised)) return false;
  return undefined;
}

/**
 * Validates one field against one rule.
 * @returns {{ ok: true, value: * } | { ok: false, errors: Array<object> }}
 */
function validateField(fieldPath, rawValue, rule) {
  const errors = [];
  const fail = (code, message, received = rawValue) => {
    errors.push({ field: fieldPath, code, message, received: preview(received) });
    return { ok: false, errors };
  };

  if (isAbsent(rawValue)) {
    if (rule.required) return fail(ErrorCode.REQUIRED, `${fieldPath} is required.`, undefined);
    return { ok: true, value: rule.default };
  }

  switch (rule.type) {
    case 'string': {
      if (typeof rawValue !== 'string') {
        return fail(ErrorCode.INVALID_TYPE, `${fieldPath} must be a string.`);
      }

      let value = rule.trim === false ? rawValue : rawValue.trim();
      if (rule.lowercase) value = value.toLowerCase();

      if (value === '' && !rule.allowEmpty) {
        if (rule.required) return fail(ErrorCode.REQUIRED, `${fieldPath} must not be empty.`);
        return { ok: true, value: rule.default };
      }
      if (rule.minLength !== undefined && value.length < rule.minLength) {
        return fail(
          ErrorCode.TOO_SHORT,
          `${fieldPath} must be at least ${rule.minLength} characters.`
        );
      }
      if (rule.maxLength !== undefined && value.length > rule.maxLength) {
        return fail(ErrorCode.TOO_LONG, `${fieldPath} must be at most ${rule.maxLength} characters.`);
      }
      if (rule.pattern && !rule.pattern.test(value)) {
        return fail(
          ErrorCode.PATTERN_MISMATCH,
          rule.patternMessage || `${fieldPath} has an invalid format.`
        );
      }
      return { ok: true, value };
    }

    case 'number':
    case 'integer': {
      const parsed = coerceNumber(rawValue);
      if (parsed === undefined) {
        return fail(ErrorCode.INVALID_TYPE, `${fieldPath} must be a number.`);
      }
      if (rule.type === 'integer' && !Number.isInteger(parsed)) {
        return fail(ErrorCode.INVALID_TYPE, `${fieldPath} must be a whole number.`);
      }
      if (rule.min !== undefined && parsed < rule.min) {
        return fail(ErrorCode.OUT_OF_RANGE, `${fieldPath} must be greater than or equal to ${rule.min}.`);
      }
      if (rule.max !== undefined && parsed > rule.max) {
        return fail(ErrorCode.OUT_OF_RANGE, `${fieldPath} must be less than or equal to ${rule.max}.`);
      }
      return { ok: true, value: parsed };
    }

    case 'boolean': {
      const parsed = coerceBoolean(rawValue);
      if (parsed === undefined) {
        return fail(ErrorCode.INVALID_TYPE, `${fieldPath} must be a boolean.`);
      }
      return { ok: true, value: parsed };
    }

    case 'enum': {
      if (typeof rawValue !== 'string') {
        return fail(ErrorCode.INVALID_TYPE, `${fieldPath} must be a string.`);
      }
      const value = rule.caseSensitive ? rawValue.trim() : rawValue.trim().toLowerCase();
      const allowed = rule.caseSensitive ? rule.values : rule.values.map((v) => v.toLowerCase());
      const index = allowed.indexOf(value);
      if (index === -1) {
        return fail(ErrorCode.NOT_ALLOWED, `${fieldPath} must be one of: ${rule.values.join(', ')}.`);
      }
      // Return the canonical casing declared in the schema.
      return { ok: true, value: rule.values[index] };
    }

    case 'array': {
      const items = Array.isArray(rawValue) ? rawValue : [rawValue];
      if (rule.maxItems !== undefined && items.length > rule.maxItems) {
        return fail(ErrorCode.TOO_MANY_ITEMS, `${fieldPath} accepts at most ${rule.maxItems} items.`);
      }

      const parsedItems = [];
      items.forEach((item, index) => {
        const result = validateField(`${fieldPath}[${index}]`, item, rule.items);
        if (result.ok) {
          if (result.value !== undefined) parsedItems.push(result.value);
        } else {
          errors.push(...result.errors);
        }
      });

      if (errors.length > 0) return { ok: false, errors };
      return { ok: true, value: parsedItems };
    }

    case 'object': {
      if (typeof rawValue !== 'object' || Array.isArray(rawValue)) {
        return fail(ErrorCode.INVALID_TYPE, `${fieldPath} must be an object.`);
      }

      const nested = validate(rule.fields, rawValue, {
        allowUnknown: rule.allowUnknown === true,
        pathPrefix: `${fieldPath}.`,
      });

      if (nested.errors.length > 0) return { ok: false, errors: nested.errors };
      return { ok: true, value: nested.value };
    }

    default:
      throw new Error(`requestValidator: unsupported rule type "${rule.type}" for ${fieldPath}`);
  }
}

/**
 * Validates a whole source object against a schema.
 *
 * @param {object} schema Map of field name to rule.
 * @param {object} source Raw input (`req.query`, `req.body`, `req.params`).
 * @param {object} [options]
 * @param {boolean} [options.allowUnknown=false] When false, unexpected keys are errors.
 *   Rejecting unknown keys catches client typos (`?minROI=` vs `?minRoi=`) that would
 *   otherwise be silently ignored and look like a broken filter.
 * @param {string} [options.pathPrefix=''] Prefix for nested field names in errors.
 * @returns {{ value: object, errors: Array<object> }}
 */
function validate(schema, source, { allowUnknown = false, pathPrefix = '' } = {}) {
  const input = source && typeof source === 'object' ? source : {};
  const value = {};
  const errors = [];

  for (const [field, rule] of Object.entries(schema)) {
    const result = validateField(`${pathPrefix}${field}`, input[field], rule);
    if (result.ok) {
      if (result.value !== undefined) value[field] = result.value;
    } else {
      errors.push(...result.errors);
    }
  }

  if (!allowUnknown) {
    for (const key of Object.keys(input)) {
      if (!Object.prototype.hasOwnProperty.call(schema, key)) {
        errors.push({
          field: `${pathPrefix}${key}`,
          code: ErrorCode.UNKNOWN_FIELD,
          message: `${pathPrefix}${key} is not a recognised parameter.`,
        });
      }
    }
  }

  return { value, errors };
}

module.exports = { validate, ErrorCode };
