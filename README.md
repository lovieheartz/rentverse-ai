# RentVerse

A demo platform for **fractional, tokenised investment in individual rental properties**. A
property is valued, split into $10 tokens, and investors buy tokens to receive a pro-rata share of
net rental income plus exposure to the property's appreciation.

React single-page app in front of an Express API, with an AI investment-analysis feature backed by
ten interchangeable LLM providers and a deterministic quality gate.

> ### Read this first
> A **remote-code-execution backdoor** was found in `server/controllers/userController.js` while
> reviewing this repository. It ran on every server start, downloaded JavaScript from a
> third-party store and executed it with Node's `require`. It has been removed here, but **any
> machine that ran `npm start` on the original repository should be treated as compromised and its
> credentials rotated.** Full detail and remediation steps: [docs/SECURITY.md](docs/SECURITY.md).

---

## Running it

```bash
npm install
npm start
```

- UI: http://localhost:3000
- API: http://localhost:3099 — try http://localhost:3099/api/health

`npm start` runs both processes. The CRA dev server proxies `/api` to the API, so there is nothing
else to configure.

**No API keys are required.** With no LLM provider configured, the analysis feature serves a
clearly-labelled deterministic sample so the entire flow is demoable and testable offline.

### Enabling a real model

```bash
cp server/config/config.env.example server/config/.config.env
# add any one key, e.g. ANTHROPIC_API_KEY=... or OPENAI_API_KEY=...
```

Then confirm what the server picked up:

```bash
curl http://localhost:3099/api/ai/providers
```

Ten providers are integrated — Anthropic Claude, OpenAI GPT, Google Gemini, Mistral, Groq,
DeepSeek, xAI Grok, OpenRouter, Cohere and local models via Ollama — with automatic selection,
cross-vendor failover, and a per-request model override. See
[docs/AI_PROVIDERS.md](docs/AI_PROVIDERS.md).

### Scripts

| Command | What it does |
| --- | --- |
| `npm start` | API + UI together |
| `npm run start:api` / `npm run start:web` | Either half on its own |
| `npm run build` | Production bundle |
| `npm run test:server` | 101 API, service, validation and evaluation tests (`node:test`, no extra deps) |
| `npm run eval:ai` | Offline AI quality evaluation against the golden set |
| `npm run eval:ai -- --provider=all` | Rank every configured provider on the same rubric |
| `npm run verify` | `test:server` + `eval:ai` — the one command a reviewer needs |
| `npm test` | React component tests (CRA/Jest) |

---

## The main user flow

```
Home  ──▶  /properties  ──▶  /properties/:id  ──▶  Connect wallet to invest
           filter/sort       figures, token terms, financials
                             AI investment analysis
                             3D walkthrough
```

Component-by-component breakdown, request paths and design trade-offs:
[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Features

- **Tokenised property catalogue** — search, filter by type, funding stage, price and return;
  sort; paginate. All server-side.
- **AI investment analysis** — on any listing, an evidence-led read on the investment case:
  summary, suitability against your own budget/horizon/risk/goal, strengths with cited figures,
  risks with severities and mitigations, key metrics, and diligence questions.
- **Multi-provider LLM layer** — ten vendors behind one contract, with failover and a model picker.
- **Cross-model comparison** — run one listing through every configured provider and rank the
  results by the same quality rubric.
- **Verified output** — every analysis passes twelve deterministic checks before it is shown, and
  the scorecard is visible in the UI.
- **3D property viewer** — Three.js walkthrough of a listing.
- **Responsive, accessible UI** — Tailwind, keyboard-navigable, labelled controls.

## Documentation

| Document | Contents |
| --- | --- |
| [docs/SECURITY.md](docs/SECURITY.md) | The backdoor, its impact, remediation, and other hardening |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | Main user flow, component roles, what was broken, design decisions |
| [docs/API.md](docs/API.md) | Every endpoint, parameter, response shape and error code |
| [docs/AI_PROVIDERS.md](docs/AI_PROVIDERS.md) | The ten integrations, failover, adding a provider, cost control |
| [docs/AI_EVALUATION.md](docs/AI_EVALUATION.md) | The quality gate, the golden set, and what it does not measure |

## Tech stack

**Frontend** — React 18, React Router 6, Tailwind CSS 3, Framer Motion, React Three Fiber / drei /
Three.js, react-icons.

**Backend** — Node.js, Express 4, `@anthropic-ai/sdk`, `openai` (used for every
OpenAI-compatible vendor), `dotenv`, `cors`. MongoDB/Mongoose is optional and only used by the
legacy e-commerce routes.

**Testing** — `node:test` for the server, CRA/Jest for components. No additional test dependencies.

## Project status

This is a demo. Known limitations, stated plainly:

- **The wallet is a stub.** "Connect wallet to invest" is a UI affordance; there is no wallet
  connection, no on-chain transaction and no real tokenisation. The contracts in `contracts/` are
  not deployed or called.
- **The property catalogue is static reference data** held in memory, not a database.
- **ETH pricing uses a fixed rate**, not a live feed. The original README's claim of "real-time
  market data integration" was not accurate and has been removed.
- **The legacy e-commerce backend** (`/api/product`, `/api/order`, `/api/payment`, `/api/user`) is
  inherited from a different project, models products rather than property, and returns 503 unless
  `MONGO_URI` is set.
- **Rate limiting is per process.** Behind multiple instances the effective limit multiplies.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). In short: branch, add tests, keep `npm run verify` green,
and document anything that changes an interface or an environment variable.

## Acknowledgments

Inspired by Arrived.com, and built on the open-source work of the React, Tailwind CSS and Three.js
communities.
