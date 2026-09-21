# RentVerse API

Base URL in development: `http://localhost:3099`. The CRA dev server proxies `/api` there, so the
browser calls same-origin paths.

## Response envelope

Every endpoint added or changed in this branch answers with one of two shapes.

**Success**

```json
{
  "success": true,
  "data": { },
  "meta": { "requestId": "…", "timestamp": "…", "durationMs": 3 }
}
```

**Failure**

```json
{
  "success": false,
  "error": {
    "code": "VALIDATION_FAILED",
    "message": "Invalid request query: 1 problem found.",
    "details": [
      { "field": "limit", "code": "out_of_range", "message": "limit must be less than or equal to 48.", "received": "999" }
    ]
  },
  "meta": { "requestId": "…", "timestamp": "…", "durationMs": 1 }
}
```

`error.code` is stable and is what clients should branch on. `meta.requestId` is also returned in
the `X-Request-Id` header and appears in the server log line for the same request; an inbound
`X-Request-Id` is honoured when it is at most 64 characters of `[A-Za-z0-9._-]`.

The original `/api/product`, `/api/order`, `/api/payment` and `/api/user` routes keep their
original bare shapes; only their error responses are normalised.

### Error codes

| Code | Status | Meaning |
| --- | --- | --- |
| `VALIDATION_FAILED` | 400 | One or more parameters are invalid. `details` lists every one. |
| `BAD_REQUEST` | 400 | Malformed body, or a request that cannot be served as asked. |
| `NOT_FOUND` | 404 | No such resource, or no such API route. |
| `PAYLOAD_TOO_LARGE` | 413 | Body exceeds `JSON_BODY_LIMIT`. |
| `RATE_LIMIT_EXCEEDED` | 429 | Client exceeded the per-window budget. See `Retry-After`. |
| `INTERNAL_ERROR` | 500 | Unexpected failure. Message is withheld in production. |
| `AI_NOT_CONFIGURED` | 503 | The selected provider has no credentials. |
| `AI_PROVIDER_UNAVAILABLE` | 503 | Provider unreachable. |
| `AI_PROVIDER_UNAUTHORIZED` | 503 | Provider rejected the server's credentials. |
| `AI_PROVIDER_RATE_LIMITED` | 429 | Provider is throttling this server. |
| `AI_PROVIDER_TIMEOUT` | 502 | Provider did not respond in time. |
| `AI_MODEL_NOT_FOUND` | 502 | Provider does not recognise the configured model id. |
| `AI_RESPONSE_TRUNCATED` | 502 | Output hit the token ceiling. |
| `AI_REQUEST_REFUSED` | 502 | Provider declined the request. |
| `AI_OUTPUT_REJECTED` | 502 | Output failed the quality checks and was withheld. |
| `AI_ALL_PROVIDERS_FAILED` | 502 | Every provider in the chain failed. |
| `DATABASE_UNAVAILABLE` | 503 | A legacy Mongo-backed route was called with no database. |

---

## `GET /api/health`

What is actually wired up. Useful as a deployment probe and for confirming configuration without
making a paid call.

```json
{
  "success": true,
  "data": {
    "status": "ok",
    "environment": "development",
    "uptimeSeconds": 17,
    "catalogue": { "source": "in-memory", "propertyCount": 6 },
    "database": { "configured": false, "state": "disconnected" },
    "ai": {
      "primary": "sample",
      "primaryModel": "deterministic-sample",
      "selection": "auto",
      "failover": true,
      "configured": [],
      "configuredCount": 0,
      "available": ["anthropic", "openai", "google", "…"],
      "usingSampleFallback": true
    },
    "configWarnings": []
  }
}
```

---

## `GET /api/properties`

Filtered, sorted, paginated catalogue. Unknown query parameters are **rejected**, so a typo like
`?minROI=5` returns 400 instead of silently returning unfiltered results.

| Parameter | Type | Default | Notes |
| --- | --- | --- | --- |
| `search` | string ≤120 | – | Matches title, city, state, type and features. |
| `type` | enum | `all` | `all`, `house`, `apartment`, `villa`, `commercial` |
| `fundingStage` | enum | `all` | `all`, `new` (<30% funded), `active` (30–89%), `almost_funded` (≥90%) |
| `minPriceUsd` / `maxPriceUsd` | number ≥0 | – | Inclusive. `min > max` is a 400. |
| `minRoiPct` / `maxRoiPct` | number 0–100 | – | Filters on **total annual return**. `min > max` is a 400. |
| `sortBy` | enum | `newest` | `newest`, `priceAsc`, `priceDesc`, `roiDesc`, `fundingDesc` |
| `page` | integer ≥1 | `1` | Clamped to the last page rather than 404ing. |
| `limit` | integer 1–48 | `12` | |
| `featured` | boolean | – | |

`data` is an array of listing summaries. `meta.pagination`:

```json
{
  "page": 1, "requestedPage": 1, "limit": 2, "pageCount": 3,
  "totalItems": 6, "catalogueSize": 6,
  "hasNextPage": true, "hasPreviousPage": false
}
```

`meta.appliedFilters` echoes what the server actually applied.

## `GET /api/properties/featured`

`limit` (1–12, default 3). Returns featured listings, newest first.

## `GET /api/properties/:id`

Full listing. `id` must match `^[A-Za-z0-9_-]+$` (400 otherwise); unknown ids return 404 with the
id in `error.details`.

Response includes `location`, `price` (`usd`, `eth`, `ethUsdRate`), `metrics` (`grossYieldPct`,
`netYieldPct`, `appreciationPct`, `totalAnnualReturnPct`, `monthlyIncomePer1000Usd`,
`minInvestmentUsd`, `totalInvestors`, `fundedPct`), `financials` (gross/net rent monthly and
annual, `totalExpenseRatioPct`, `expenseRatios`), `tokenDetails`, `details`, `features`, `images`,
`advisor`, `status` and `listedAt`.

---

## `GET /api/ai/providers`

Which LLM providers are integrated, which are usable, and which model each will call. Reports the
environment variable that configures each provider, **never a credential value**.

```json
{
  "success": true,
  "data": [
    {
      "id": "anthropic", "label": "Anthropic Claude", "kind": "anthropic",
      "model": "claude-opus-5", "configured": false, "requiresApiKey": true,
      "apiKeyEnvVar": "ANTHROPIC_API_KEY", "modelEnvVar": "ANTHROPIC_MODEL",
      "structuredOutput": "json_schema", "isPrimary": false
    }
  ],
  "meta": {
    "primary": "sample", "selection": "auto",
    "priorityOrder": ["anthropic", "openai", "…"],
    "configured": [], "failover": true,
    "integratedCount": 11, "configuredCount": 0
  }
}
```

## `GET /api/ai/status`

Compact version of the same information.

---

## `POST /api/ai/property-analysis`

Generates an evidence-led investment analysis for one listing.

Rate limited: `AI_RATE_LIMIT_MAX` requests per `AI_RATE_LIMIT_WINDOW_MS` per client (default
20/minute). Responses carry `X-RateLimit-Limit`, `X-RateLimit-Remaining` and `X-RateLimit-Reset`;
a 429 also carries `Retry-After`.

**Request**

```json
{
  "propertyId": "1",
  "provider": "anthropic",
  "failover": true,
  "refresh": false,
  "investorProfile": {
    "budgetUsd": 2500,
    "horizonYears": 5,
    "riskTolerance": "moderate",
    "goal": "income"
  }
}
```

| Field | Required | Notes |
| --- | --- | --- |
| `propertyId` | yes | `^[A-Za-z0-9_-]+$`, ≤40 chars |
| `provider` | no | A provider id. Omit to use the server's primary. |
| `failover` | no (default `true`) | `false` pins the request to `provider`. |
| `refresh` | no (default `false`) | Bypass the server-side cache. |
| `investorProfile.budgetUsd` | no | 10 – 10,000,000 |
| `investorProfile.horizonYears` | no | integer 1 – 40 |
| `investorProfile.riskTolerance` | no | `conservative`, `moderate`, `aggressive` |
| `investorProfile.goal` | no | `income`, `appreciation`, `balanced` |

Omitting `investorProfile` entirely is valid and produces an analysis whose suitability verdict is
`not_assessed` - the model declines to judge fit rather than inventing one.

**Response**

```json
{
  "success": true,
  "data": {
    "propertyId": "5",
    "propertyTitle": "Tech District Live-Work Complex",
    "generatedAt": "2026-09-21T08:05:00.000Z",
    "provider": "anthropic",
    "providerLabel": "Anthropic Claude",
    "model": "claude-opus-5",
    "analysis": {
      "headline": "…",
      "summary": "…",
      "suitability": { "verdict": "partially_aligned", "rationale": "…" },
      "strengths": [{ "point": "…", "evidence": "…" }],
      "risks": [{ "risk": "…", "severity": "high", "mitigation": "…" }],
      "keyMetrics": [{ "label": "Net rental yield", "value": "6.58%", "interpretation": "…" }],
      "questionsToAsk": ["…"],
      "disclaimer": "…"
    }
  },
  "meta": {
    "requestedProvider": "anthropic",
    "failedOver": false,
    "structuredOutputMode": "json_schema",
    "providerLatencyMs": 4210,
    "attempts": 1,
    "regenerated": false,
    "cached": false,
    "usage": { "inputTokens": 2143, "outputTokens": 812, "cacheReadInputTokens": 1900 },
    "evaluation": {
      "passed": true,
      "score": 1,
      "summary": { "total": 12, "passed": 12, "failed": 0, "criticalFailed": 0, "warningFailed": 0 },
      "checks": [{ "id": "numeric_grounding", "label": "…", "severity": "critical", "passed": true, "detail": "…" }]
    }
  }
}
```

`meta.evaluation` is the quality scorecard that was applied **before** the response was released.
`verdict` is one of `aligned`, `partially_aligned`, `not_aligned`, `not_assessed`; `severity` is
`low`, `medium` or `high`.

When failover substitutes a provider, `meta.failedOver` is `true` and `meta.failoverTrail` lists
what was tried and why it was rejected. `data.provider` always names the provider that actually
answered.

**Rejection**

When no provider produces an analysis that passes the critical checks:

```json
{
  "success": false,
  "error": {
    "code": "AI_OUTPUT_REJECTED",
    "message": "The analysis could not be produced: Output failed the quality gate on every attempt.",
    "details": {
      "providersTried": ["anthropic"],
      "failures": [{
        "provider": "anthropic", "attempts": 2,
        "failedChecks": [{ "id": "numeric_grounding", "label": "…", "detail": "1 figure(s) do not appear in the source data." }]
      }]
    }
  }
}
```

---

## `POST /api/ai/property-analysis/compare`

Runs the same listing and profile through several providers and scores each with the same rubric.
Failover is disabled per provider - substituting one vendor for another would invalidate the
comparison.

Rate limited separately at `AI_COMPARE_RATE_LIMIT_MAX` (default 5/minute).

**Request**

```json
{
  "propertyId": "1",
  "providers": ["anthropic", "openai", "google"],
  "investorProfile": { "budgetUsd": 5000, "goal": "income" }
}
```

`providers` is optional; omitting it compares everything currently configured. At least two
providers must resolve, or the request is a 400.

**Response**

`data.results` is one entry per provider, each with `ok`, `score`, `passed`, `latencyMs`,
`jsonMode`, `usage`, `verdict`, and either the full `analysis` + `evaluation` or an `error`.
`meta.ranking` orders them by score (ties broken by latency) and `meta.summary` reports
`succeeded`, `failed`, `bestProvider` and `meanScore`.

---

## Legacy routes

`/api/product`, `/api/order`, `/api/payment` and `/api/user` are the original e-commerce endpoints.
They require MongoDB and answer `503 DATABASE_UNAVAILABLE` while `MONGO_URI` is unset. They are
unrelated to the property investment flow - see [ARCHITECTURE.md](./ARCHITECTURE.md) §3.
