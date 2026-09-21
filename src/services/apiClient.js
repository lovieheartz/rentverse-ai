/**
 * Single entry point for every call to the RentVerse API.
 *
 * Centralising it means the response envelope is unwrapped in one place, errors arrive as
 * one predictable type with a machine-readable code, and every request is abortable and
 * time-bounded. Components deal with `data` and `ApiRequestError`, never with raw
 * `fetch` semantics.
 *
 * Base URL: empty by default, so requests are same-origin and the CRA dev server's proxy
 * forwards `/api` to the API process. Set `REACT_APP_API_BASE_URL` when the UI is served
 * from a different origin than the API.
 */

const API_BASE_URL = (process.env.REACT_APP_API_BASE_URL || '').replace(/\/+$/, '');

const DEFAULT_TIMEOUT_MS = 20000;

/**
 * Error thrown for every failed request - transport, HTTP or application level.
 *
 * `code` mirrors the server's stable error code (`VALIDATION_FAILED`, `NOT_FOUND`,
 * `AI_OUTPUT_REJECTED`, ...) so the UI can branch on it instead of matching on message
 * text. `requestId` is shown to the user so a report can be traced to a log line.
 */
export class ApiRequestError extends Error {
  constructor(message, { status, code, details, requestId, cause } = {}) {
    super(message);
    this.name = 'ApiRequestError';
    this.status = status ?? 0;
    this.code = code || 'REQUEST_FAILED';
    this.details = details;
    this.requestId = requestId;
    this.cause = cause;
  }

  /** True when retrying the same request could plausibly succeed. */
  get isRetryable() {
    return (
      this.status === 0 ||
      this.status === 408 ||
      this.status === 429 ||
      this.status >= 500 ||
      this.code === 'NETWORK_ERROR' ||
      this.code === 'TIMEOUT'
    );
  }

  /** Field-level validation failures, keyed by field path, for form display. */
  get fieldErrors() {
    if (!Array.isArray(this.details)) return {};
    return this.details.reduce((accumulator, detail) => {
      if (detail && detail.field) accumulator[detail.field] = detail.message;
      return accumulator;
    }, {});
  }
}

/** Aborts `internal` when `external` aborts, without depending on `AbortSignal.any`. */
function linkAbortSignals(internal, external) {
  if (!external) return () => {};

  if (external.aborted) {
    internal.abort(external.reason);
    return () => {};
  }

  const forward = () => internal.abort(external.reason);
  external.addEventListener('abort', forward);
  return () => external.removeEventListener('abort', forward);
}

/**
 * Performs one API request.
 *
 * @param {string} path Path beginning with `/api/`.
 * @param {object} [options]
 * @param {string} [options.method='GET']
 * @param {object} [options.body] JSON request body.
 * @param {AbortSignal} [options.signal] Caller's abort signal (e.g. effect cleanup).
 * @param {number} [options.timeoutMs]
 * @returns {Promise<{ data: *, meta: object }>}
 */
export async function apiRequest(path, { method = 'GET', body, signal, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  const controller = new AbortController();
  const unlink = linkAbortSignals(controller, signal);
  const timeoutHandle = setTimeout(() => controller.abort(new Error('timeout')), timeoutMs);

  let response;
  try {
    response = await fetch(`${API_BASE_URL}${path}`, {
      method,
      headers: {
        Accept: 'application/json',
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });
  } catch (error) {
    // A caller-initiated abort is not an error - re-throw so effects can ignore it.
    if (signal?.aborted) throw error;

    if (controller.signal.aborted) {
      throw new ApiRequestError(
        `The request to ${path} took longer than ${Math.round(timeoutMs / 1000)}s.`,
        { code: 'TIMEOUT', cause: error }
      );
    }
    throw new ApiRequestError(
      'Could not reach the RentVerse API. Check that the API process is running.',
      { code: 'NETWORK_ERROR', cause: error }
    );
  } finally {
    clearTimeout(timeoutHandle);
    unlink();
  }

  const requestId = response.headers.get('X-Request-Id') || undefined;

  // A non-JSON body means something other than the API answered (proxy, SPA shell, gateway).
  let payload;
  try {
    payload = await response.json();
  } catch (error) {
    throw new ApiRequestError(
      `The server returned a non-JSON response (HTTP ${response.status}).`,
      { status: response.status, code: 'INVALID_RESPONSE', requestId, cause: error }
    );
  }

  if (!response.ok || payload?.success === false) {
    const apiError = payload?.error || {};
    throw new ApiRequestError(apiError.message || `Request failed with status ${response.status}.`, {
      status: response.status,
      code: apiError.code,
      details: apiError.details,
      requestId: payload?.meta?.requestId || requestId,
    });
  }

  return { data: payload.data, meta: payload.meta || {} };
}

/** Serialises a filter object into a query string, dropping empty values. */
export function toQueryString(params = {}) {
  const search = new URLSearchParams();

  Object.entries(params).forEach(([key, value]) => {
    if (value === undefined || value === null || value === '') return;
    search.append(key, String(value));
  });

  const query = search.toString();
  return query ? `?${query}` : '';
}
