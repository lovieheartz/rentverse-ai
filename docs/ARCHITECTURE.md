# RentVerse architecture and main user flow

Written for engineers and the reviewing tech lead. It covers what the application does, which
components carry which responsibility, what was wrong with the main flow, and what changed.

---

## 1. What the product is

RentVerse sells **fractional ownership of individual rental properties**. A property is valued,
split into $10 tokens, and investors buy tokens to receive a pro-rata share of net rental income
plus exposure to the property's appreciation. The platform is a React single-page application in
front of an Express API.

## 2. The main user flow

The primary journey is **investment discovery and evaluation**:

```
  Home  ──▶  Listings  ──▶  Property detail  ──▶  Invest
   /        /properties     /properties/:id        (wallet)
   │             │                 │                  │
   │             │                 │                  └─ "Connect wallet to invest"
   │             │                 │                     (UI stub - no wallet integration)
   │             │                 │
   │             │                 ├─ figures, token terms, financial breakdown
   │             │                 ├─ AI investment analysis      ◀── added in this change
   │             │                 └─ /property-3d  (Three.js viewer)
   │             │
   │             └─ filter · sort · paginate
   │
   └─ featured listings, how-it-works, FAQ, blog previews
```

Everything else - About, FAQ, Privacy, Blog, BlogPost, NotFound - is static supporting content
around this flow.

### Where the decision actually happens

The **property detail page** is the decision point. It is the last screen before a user commits
capital, and the only screen with enough information to decide on. That is why the AI analysis
was added there rather than anywhere else: it answers the question the user already has at that
exact moment, using the numbers already on the page.

## 3. Components and their roles

### Frontend (`src/`)

| Component | Role |
| --- | --- |
| `index.js` | React root. Mounts `<App/>` in `StrictMode`. |
| `App.jsx` | Router. Wraps every route in the persistent `Navbar` / `Footer` shell. |
| `components/layout/Navbar.jsx` | Primary navigation and the wallet "Connect" affordance. Collapses to a menu on mobile. |
| `components/layout/Footer.jsx` | Secondary navigation and legal links. |
| `pages/Home.jsx` | Landing page: value proposition, **featured listings**, how-it-works, advantages, FAQ preview, blog previews. Entry point into the flow. |
| `pages/Properties.jsx` | The listings grid. Owns filter state, renders results and pagination. |
| `pages/PropertyDetail.jsx` | The full listing: gallery, description, features, token terms, financial breakdown, funding progress, advisor, and the AI analysis panel. |
| `pages/Property3D.jsx` | Wrapper that loads the 3D viewer. |
| `components/property/Scene.jsx` | React Three Fiber `<Canvas>`: camera, lighting, controls. |
| `components/property/Experience.jsx` | The scene contents - loads `public/models/house1.glb` and drives the walkthrough. |
| `components/property/Overlay.jsx` | 2D HUD layered over the 3D canvas (captions, progress). |
| `pages/About.jsx`, `FAQ.jsx`, `Privacy.jsx`, `Blog.jsx`, `BlogPost.jsx`, `NotFound.jsx` | Static supporting content. |

Added in this change:

| Component | Role |
| --- | --- |
| `services/apiClient.js` | The only place that calls `fetch`. Unwraps the response envelope, converts failures into a single `ApiRequestError` type, and makes every request abortable and time-bounded. |
| `services/propertyApi.js`, `services/aiApi.js` | Typed call sites for each endpoint. |
| `hooks/useApiResource.js` | Generic loader: loading/error state, abort on unmount and on argument change, `refetch()`. Also `useDebouncedValue`. |
| `hooks/useProperties.js` | Filter state, debouncing, pagination; plus `useProperty` and `useFeaturedProperties`. |
| `hooks/useInvestmentAnalysis.js` | On-demand AI analysis, model comparison, and the provider list. |
| `components/property/PropertyCard.jsx` | One listing card, shared by the home page and the listings grid. |
| `components/property/InvestmentAnalysisPanel.jsx` | The AI feature: profile form, model selector, result, provenance, scorecard. |
| `components/property/AnalysisScorecard.jsx` | Shows which quality checks the analysis passed. |
| `components/property/ModelComparison.jsx` | Runs several providers on the same listing and ranks them. |
| `components/common/StateViews.jsx` | Shared loading, error, empty and skeleton states. |
| `utils/format.js` | Currency, percentage, number and duration formatting. |

### Backend (`server/`)

The repository inherited a complete **e-commerce** backend - Mongo models for products, orders,
carts and payments, plus Cloudinary and SendGrid integrations. None of it models real estate, and
`connectDatabase()` was commented out, so none of it ran.

That code is left in place (it is someone's work and may be wanted) but is now **gated**: the
`/api/product`, `/api/order`, `/api/payment` and `/api/user` routes sit behind `requireDatabase`,
which returns `503 DATABASE_UNAVAILABLE` immediately while `MONGO_URI` is unset, instead of
letting Mongoose buffer the query for ten seconds and appear to hang.

Current structure:

```
server/
  server.js                   process entry: config, optional DB, listen, graceful shutdown
  app.js                      middleware order, route mounting, error handling
  config/
    env.js                    all configuration, validated once at boot
    database.js               optional MongoDB connection
  data/properties.js          canonical property catalogue (single source of truth)
  services/propertyService.js filtering, sorting, pagination, projections (pure functions)
  controllers/                thin HTTP adapters
  routes/                     route tables and per-route middleware
  middlewares/
    validator/                schema validator + request schemas
    errors/                   central error handler and API 404
    helpers/                  request id, rate limiter, database guard
  utils/                      ApiError, response envelopes, TTL cache
  ai/
    analysisFacts.js          fact sheet + the numeric allow-set for grounding
    analysisSchema.js         output contract (permissive and strict variants)
    promptBuilder.js          system prompt and user turn
    analysisService.js        quality gate, failover, caching, comparison
    providers/                one adapter per vendor + the registry
    evaluation/               the deterministic check suite
  eval/                       golden set and the offline evaluation runner
  test/                       node:test suites
```

## 4. What was broken in the main flow

Found while tracing it. All four are fixed in this branch.

1. **The detail page ignored the route parameter.** `PropertyDetail.jsx` declared one hardcoded
   property object and rendered it for every id, so all six listings opened the same Beverly
   Hills villa. This is the most visible bug in the product.
2. **The catalogue existed three times and the copies disagreed.** `Home.jsx`, `Properties.jsx`
   and `PropertyDetail.jsx` each held their own array. Id `1` was "Luxury Downtown Apartment,
   Miami FL" on the home page and "Modern Villa with Pool, Beverly Hills CA" on the listings page.
3. **The frontend never called the backend.** Not one `fetch` or `axios` call in `src/`. The API
   process started by `npm start` served nothing the UI used.
4. **The build did not work.** `tailwind.config.js` and `postcss.config.js` used `export default`
   in a CommonJS package, and `tailwindcss`, `postcss` and `autoprefixer` were not in
   `package.json` at all.

A fifth finding is not a bug but a backdoor, and is documented separately in
[SECURITY.md](./SECURITY.md). **Read that first.**

## 5. How the flow works now

### Data

One catalogue, in `server/data/properties.js`. Only independent facts are stored; everything
derivable - ETH price, token supply, tokens remaining, net rent, net yield, total return, funding
stage - is computed from them. Two consequences:

- The UI can no longer show a funding label that contradicts the funding percentage, or a token
  count that contradicts the price. A test asserts each of those invariants across the catalogue.
- The AI prompt and the grounding check are built from the same derived object, so they cannot
  disagree about what is true.

The catalogue is in memory. It is small, read-only reference data, and keeping it out of MongoDB
means the whole flow runs with no external dependency. `propertyService` is written as pure
functions over it, so moving it behind a database later means changing one module.

### Request path

```
  Browser
    │  fetch('/api/properties?...')          CRA dev server proxies /api → :3099
    ▼
  requestContext ─ cors ─ json(limit) ─ cookieParser
    ▼
  validateQuery(schema)      coerce, range-check, reject unknown fields
    ▼
  controller                 cross-field checks, 404s
    ▼
  propertyService            filter → sort → paginate → project
    ▼
  sendSuccess                { success, data, meta }
    ▼
  errorMiddleware            any throw → { success: false, error: {code, message, details}, meta }
```

### The AI analysis

```
  property + investor profile
    ▼
  buildAnalysisFacts()       fact sheet, including pre-computed investor projections
    ▼
  provider.generateAnalysis()   any of ten vendors, one contract
    ▼
  evaluateAnalysis()         12 deterministic checks
    ├─ pass  → cache, return with the scorecard
    ├─ critical fail, attempt 1 → feed the exact violations back into the prompt, retry
    └─ still failing → next provider in the chain, or refuse
```

Detail in [AI_PROVIDERS.md](./AI_PROVIDERS.md) and [AI_EVALUATION.md](./AI_EVALUATION.md).

## 6. Design decisions worth questioning

Stated explicitly because they are the ones a reviewer should push back on:

- **The catalogue is in memory, not MongoDB.** Right for read-only reference data of this size and
  for keeping the project runnable; wrong as soon as listings are created or edited at runtime.
- **The quality gate fails closed.** If no provider produces an analysis that passes the checks,
  the request fails rather than returning something unverified. For generated commentary about
  money this is the defensible default, but it does mean the feature can be unavailable while
  still "working". `AI_MAX_QUALITY_ATTEMPTS` and the failover chain exist to make that rare.
- **Failover across vendors is on by default.** A user asking for one model can get another. The
  response always says so (`meta.failedOver`, `meta.failoverTrail`), and comparison requests pin
  the provider. Set `AI_FAILOVER=false` to disable it globally.
- **No LLM-as-judge in the evaluation.** The failure modes that matter here - invented figures,
  guarantee language, missing risks - are mechanically detectable. A model judge would add a
  second call, latency, and its own variance to the request path.
- **One adapter for eight vendors.** OpenAI, Gemini, Mistral, Groq, DeepSeek, Grok, OpenRouter and
  Ollama all speak the OpenAI Chat Completions protocol, so they share one adapter rather than
  eight SDKs. Anthropic and Cohere have their own because their APIs genuinely differ.
- **The legacy e-commerce backend was kept.** Gated, not deleted. If it is genuinely dead, deleting
  it would remove roughly 60 files and several unused dependencies.
