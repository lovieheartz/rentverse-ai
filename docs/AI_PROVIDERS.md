# LLM provider integration

Ten LLM vendors plus a deterministic offline provider, all behind one contract.

## Quick start

The app runs with **no** keys. With none configured it serves a clearly-labelled deterministic
sample so the whole flow is demoable and testable.

To use a real model, set any one key in `server/config/.config.env`:

```bash
cp server/config/config.env.example server/config/.config.env
# then add, for example:
#   ANTHROPIC_API_KEY=sk-ant-...
#   OPENAI_API_KEY=sk-...
npm start
```

Confirm what the server picked up:

```bash
curl http://localhost:3099/api/ai/providers | jq '.data[] | select(.configured)'
```

## The providers

| id | Vendor | Adapter | API key | Model variable | Default model | Structured output |
| --- | --- | --- | --- | --- | --- | --- |
| `anthropic` | Anthropic Claude | native SDK | `ANTHROPIC_API_KEY` | `ANTHROPIC_MODEL` | `claude-opus-5` | JSON Schema |
| `openai` | OpenAI GPT | OpenAI protocol | `OPENAI_API_KEY` | `OPENAI_MODEL` | `gpt-5` | JSON Schema (strict) |
| `google` | Google Gemini | OpenAI protocol | `GEMINI_API_KEY` | `GEMINI_MODEL` | `gemini-2.5-pro` | JSON Schema |
| `mistral` | Mistral AI | OpenAI protocol | `MISTRAL_API_KEY` | `MISTRAL_MODEL` | `mistral-large-latest` | JSON Schema |
| `groq` | Groq | OpenAI protocol | `GROQ_API_KEY` | `GROQ_MODEL` | `llama-3.3-70b-versatile` | JSON Schema |
| `deepseek` | DeepSeek | OpenAI protocol | `DEEPSEEK_API_KEY` | `DEEPSEEK_MODEL` | `deepseek-chat` | JSON object |
| `xai` | xAI Grok | OpenAI protocol | `XAI_API_KEY` | `XAI_MODEL` | `grok-4` | JSON Schema |
| `openrouter` | OpenRouter | OpenAI protocol | `OPENROUTER_API_KEY` | `OPENROUTER_MODEL` | `openai/gpt-5` | JSON Schema |
| `cohere` | Cohere | native REST | `COHERE_API_KEY` | `COHERE_MODEL` | `command-a-03-2025` | JSON Schema |
| `ollama` | Ollama (local) | OpenAI protocol | none | `OLLAMA_MODEL` | `llama3.1` | JSON object |
| `sample` | Deterministic sample | built in | none | – | – | n/a |

> **Model ids age.** Vendors rename and retire models on their own schedule. Every default above is
> overridable through the listed variable, and `GET /api/ai/providers` reports exactly which model
> each provider will call. A `AI_MODEL_NOT_FOUND` error means "set the variable", not "the
> integration is broken".

Ollama has no credential to detect, so it is only considered available when explicitly pointed at
— set `OLLAMA_BASE_URL`. Otherwise auto-selection would pick a server that is not running.

## Why one adapter for eight vendors

OpenAI, Gemini, Mistral, Groq, DeepSeek, Grok, OpenRouter and Ollama all speak the OpenAI Chat
Completions protocol and differ only in base URL, credentials, model id and which optional
parameters they honour. Eight SDKs would mean eight dependencies and eight code paths to keep
working; `providers/openAiCompatibleProvider.js` is one of each, parameterised by the catalogue
entry in `config/env.js`.

Anthropic and Cohere have their own adapters because their APIs genuinely differ. Anthropic's also
buys two things worth having: the system prompt is sent as a cacheable block (byte-identical every
call, so after the first request only the fact sheet is charged at full rate), and adaptive
thinking lets the model choose its own reasoning depth, bounded by `AI_EFFORT`.

Cohere is reached with the platform `fetch` rather than another SDK - its REST surface is small
and stable enough not to justify the dependency.

## Handling what is genuinely not uniform

Three differences are real and are handled explicitly rather than assumed away.

**Structured output** ranges from strict JSON Schema, through a loose "return JSON" mode, to
nothing at all. Each request walks down that ladder:

```
json_schema  →  json_object  →  prompt-only
```

Degradation is driven by the provider's own 400 response, not by a hardcoded assumption, so a
vendor that adds schema support starts being used without a code change. When the bottom rung is
reached, the output contract is written into the prompt instead. Every response then goes through
a tolerant parser (markdown fences, leading prose and array wrappers are all recovered) and the
same quality gate as everything else - so a weaker provider is held to an identical standard
rather than trusted more.

**Token parameter.** Newer OpenAI models require `max_completion_tokens` and reject `max_tokens`;
most other vendors accept only `max_tokens`. The catalogue declares a preference and the adapter
swaps once on rejection.

**Sampling.** Some reasoning models reject any `temperature` but the default, so
`supportsTemperature` is per provider.

`meta.degradations` in the response records anything that was downgraded, so a provider quietly
running in a weaker mode is visible rather than invisible.

## Selection and failover

```
AI_PROVIDER=auto                first configured provider in AI_PROVIDER_ORDER, else `sample`
AI_PROVIDER=openai              pinned
AI_PROVIDER_ORDER=anthropic,openai,google,mistral,groq,xai,deepseek,openrouter,cohere,ollama
AI_FAILOVER=true                try the next configured provider on failure
AI_MAX_FAILOVER_PROVIDERS=3
```

A provider is failed over when it errors, is unreachable, or cannot produce output that passes the
quality checks. The chain ends at the sample provider, so the feature degrades instead of breaking
when every vendor is down.

Failover is never silent. `data.provider` names who actually answered, `meta.failedOver` is `true`,
and `meta.failoverTrail` lists each provider that was tried and why it was rejected. A single
request can pin itself with `"failover": false`, and comparison requests always do.

## Adding a provider

For an OpenAI-compatible vendor, add one entry to `PROVIDER_CATALOGUE` in `server/config/env.js`:

```js
{
  id: 'together',
  label: 'Together AI',
  kind: 'openai-compatible',
  apiKeyEnvVar: 'TOGETHER_API_KEY',
  modelEnvVar: 'TOGETHER_MODEL',
  defaultModel: 'meta-llama/Llama-3.3-70B-Instruct-Turbo',
  defaultBaseUrl: 'https://api.together.xyz/v1',
  baseUrlEnvVar: 'TOGETHER_BASE_URL',
  jsonMode: 'json_schema',
  tokenParam: 'max_tokens',
  supportsTemperature: true,
  requiresApiKey: true,
}
```

No other code changes. It appears in `/api/ai/providers`, becomes selectable in the UI's model
picker and in the request schema, joins the failover chain, and is picked up by the evaluation
runner's `--provider=all`.

For a vendor with its own protocol, write an adapter exposing
`generateAnalysis(facts, { corrections }) → { analysis, parseError?, providerMeta }`, register it
in `ADAPTER_FACTORIES` in `server/ai/providers/index.js`, and give its catalogue entry a matching
`kind`. `registerProvider(id, provider)` does the same at runtime and is what the gate tests use to
inject a provider that deliberately misbehaves.

## Cost control

- **Caching.** Identical property + profile + provider + model is served from an in-process TTL
  cache (`AI_CACHE_TTL_MS`, default 10 minutes). `meta.cached` reports a hit.
- **Rate limiting.** Per client, per window. Comparison has its own tighter budget because it fans
  out. In-process only - move the counter to Redis before running more than one instance.
- **Prompt caching.** On Anthropic, the system prompt is a cacheable block. `usage.cacheReadInputTokens`
  shows how much was served from cache.
- **Effort.** `AI_EFFORT` (Anthropic) trades reasoning depth against spend; `medium` is the default
  for this task.
- **Nothing is generated unprompted.** The panel makes no call until the user asks for one.

## Testing without spending

`server/test/providers.test.js` sets fake credentials for every vendor and asserts that each
resolves to a working adapter, routes to the right base URL, exposes a model id and an override
variable, and never leaks a credential - all offline, with no network calls.

The offline evaluation suite (`npm run eval:ai`) runs entirely against the sample provider by
default. See [AI_EVALUATION.md](./AI_EVALUATION.md).
