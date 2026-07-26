# API error handling (SDK-backed retries)

Implementation plan for the first Tier 1 item in `agent-feature-ideas.md`. Planned 2026-07-25; implementation picked up in a later session — this doc is self-contained, work from it directly.

## Context

Today `respond()` in `src/agent/agent.ts` calls `client.messages.stream()` with zero error handling: any API failure throws out of the generator, propagates through `index.ts`'s bare `for await`, kills the process with a raw stack trace, skips `renderer.unmount?.()` (leaving Ink's raw-mode stdin claimed), and loses the conversation.

**Approach — no hand-rolled retry loop.** The Anthropic SDK already retries retryable failures (429/5xx/408/409/connection errors) with exponential backoff via `maxRetries` (default 2) on the initial request. Any error that escapes the SDK — including a mid-stream drop, which the SDK does *not* retry — is treated as fatal: wrapped in a typed `AgentError` with a human-readable message, caught in `index.ts`, renderer unmounted properly, one line to stderr, exit non-zero. An earlier draft with an app-level retry-with-backoff loop around the stream was rejected: it duplicates machinery the SDK already provides (sleep injection, backoff math, attempt caps) for marginal benefit.

**Deliberately deferred:** no new `AgentEvent` variants in this pass. An `error` event so failures surface *in-session* (instead of a clean exit) is the follow-up — see the checkbox in `agent-feature-ideas.md`.

**Naming:** the injected function type is `OpenModelStream` — a verb phrase like the existing `RenderThumbnailArt` — returning a `ModelStream`. (A `StreamModel`/`ModelStream` mirror pair was rejected as confusing.)

**History safety:** the user message is pushed *before* `respond()` runs, and the assistant message only *after* `finalMessage()` resolves — so a failure leaves `messages` in a valid state on the way out.

## SDK facts relied on (@anthropic-ai/sdk ^0.106, verified against installed typings)

- `maxRetries` (default 2) auto-retries 408/409/429/5xx + connection errors with backoff **for the initial request only**; mid-stream drops surface as throws from stream iteration / `finalMessage()`.
- `Anthropic.APIError` is the base class with `.status`; `Anthropic.APIConnectionError` is a **subclass** of `APIError` in the TS SDK — so `instanceof Anthropic.APIError` catches both HTTP and connection failures.
- `Anthropic.APIError.generate(status, errorBody, message, headers)` is public and returns the correct subclass — used by the fault injector and tests so `instanceof` classification is exercised for real.
- `MessageStream implements AsyncIterable<MessageStreamEvent>` with `finalMessage(): Promise<Message>`; params type is `Anthropic.MessageStreamParams`.

## Steps

### 1. `src/agent/open-model-stream.ts` (new) — port + production factory + fault injector

```ts
// What respond() consumes: the event stream plus the assembled final message.
// The SDK's MessageStream satisfies this structurally.
export type ModelStream = AsyncIterable<Anthropic.MessageStreamEvent> & {
	finalMessage(): Promise<Anthropic.Message>;
};
// The model-call port. Injectable for tests; real callers use createAnthropicOpenModelStream().
export type OpenModelStream = (params: Anthropic.MessageStreamParams) => ModelStream;
```

`createAnthropicOpenModelStream()`: builds `new Anthropic()` (comment noting the SDK's built-in `maxRetries: 2` backoff is the *only* retry layer, by design), returns `(params) => client.messages.stream(params)` — zero adapter code. Factory-in-default-param (not a module-level client) so tests that inject a fake never construct the real client or need `ANTHROPIC_API_KEY`. Mirrors the `createVideoStore(fetchVideo = fetchVideoWithYtDlp)` convention.

**Fault injector (dev-only, same file, ~20 lines):** when `process.env.FAULT` is set, wrap the real `OpenModelStream` so the *first* request fails (simulating an error that escaped the SDK's retries), then delegate normally. `FAULT=<kind>`:

- numeric (`400`, `429`, `529`, `500`…) → throw `Anthropic.APIError.generate(status, ...)` before iteration
- `conn` → throw `new Anthropic.APIConnectionError({ message: ... })`
- `midstream` → forward the first ~3 real stream events, then throw a connection error from the iterator

(No `:count` syntax — with no app-level retries, one injected failure ends the session, so a count buys nothing.)

### 2. `src/agent/agent-error.ts` (new)

```ts
export class AgentError extends Error { ... } // name = "AgentError"; cause carries the original
```

Plus `describeApiError(err: Anthropic.APIError): string` in the same file — one human sentence (status + API error message, e.g. "the model API rejected the request (status 529: overloaded_error)"; connection errors → "couldn't reach the model API"), no stack dump. It exists to format `AgentError` messages, so it lives with the class.

### 3. `src/agent/agent.ts` (modify)

- Delete `private client = new Anthropic()`; keep the `Anthropic` import for types.
- Constructor gains one default-injected param **after** `videoUrl` (existing call sites untouched): `openModelStream: OpenModelStream = createAnthropicOpenModelStream()`.
- In `respond()`, wrap the stream-create → iterate → `finalMessage()` region:

```ts
try {
	const stream = this.openModelStream({ model: MODEL, max_tokens: 64000, system: SYSTEM_PROMPT,
		tools: this.toolRegistry.schemas, messages: this.messages });
	for await (const event of stream) { /* existing textDelta yield */ }
	response = await stream.finalMessage();
} catch (err) {
	// The SDK already retried retryable failures (maxRetries). Anything that gets here —
	// including mid-stream drops, which the SDK doesn't retry — is fatal for the session.
	if (err instanceof Anthropic.APIError)
		throw new AgentError(`${describeApiError(err)} The session can't continue.`, { cause: err });
	throw err; // unexpected bug: propagate raw with stack
}
```

Rest of `respond()` (history push, `modelResponded`, tool loop) unchanged.

### 4. `src/index.ts` (modify)

Replace the bare `for await` + `unmount` with capture + guaranteed unmount:

```ts
let failure: unknown;
try {
	for await (const event of new Agent(host, createToolRegistry(), videoUrl).run()) {
		renderer.handle(event);
	}
} catch (err) {
	failure = err;
} finally {
	renderer.unmount?.(); // always release Ink's raw-mode stdin before printing anything
}
if (failure !== undefined) {
	process.exitCode = 1;
	if (failure instanceof AgentError) console.error(failure.message);
	else throw failure; // unexpected: full stack
}
```

Unmount-before-print means Ink's final repaint can't clobber the stderr line. `process.exitCode` over `process.exit()` so cleanup flushes; fall back to `process.exit(1)` only if manual testing shows the process lingering on stdin.

### 5. Tests

**`src/agent/agent-error.test.ts`** — `describeApiError` on real SDK errors built with `APIError.generate` (429, 529, 400) and `new APIConnectionError(...)`: asserts the status/type appears and the string is one readable sentence.

**`src/agent/agent.test.ts`** — spy-factory fakes in the `load-video.test.ts` style: `hostOf(...inputs)` (scripted `requestInput`, then `null`), stub `ToolRegistry` (`schemas: []`), `assistantMessage(text)` minimal `Anthropic.Message` literal (`stop_reason: "end_turn"`), `scriptedModelStreams(...script)` with entries `{ events, final }` / `{ failWith }` / `{ events, thenFailWith }`, returning `{ openModelStream, calls }` (recorded params). Cases:

1. **Happy path** (baseline now that the client is injectable): one turn streams deltas → events contain `textDelta`s + `modelResponded`; `calls[0].messages` ends with the user turn.
2. **API error before stream** (429 via `generate`) → `run()` rejects with `AgentError`, message contains the status, `cause` is the original, `calls.length === 1` (no app-level retry).
3. **Mid-stream connection drop** (`{ events: 2 deltas, thenFailWith: APIConnectionError }`) → the yielded deltas arrive, then `AgentError`.
4. **Non-API `TypeError`** → the same instance propagates raw, not wrapped in `AgentError`.

No `index.ts` test (composition root, no repo precedent) — covered by the manual FAULT runs below.

### 6. `docs/plans/agent-feature-ideas.md` (modify)

Don't tick the top-level "API error handling & retries" box. Follow the doc's nested-checkbox precedent (context-window entry): two children — `[x]` rely on SDK `maxRetries` for retryable errors; escaped errors (incl. mid-stream drops) → `AgentError` → clean unmount/stderr/exit, `FAULT` env for manual testing; `[ ]` `error` AgentEvent so failures surface in-session instead of exiting. Reword the entry body to record the decision *against* an app-level retry loop (SDK backoff is the only retry layer). Update *Lands in:*.

## Verification

1. `bun run typecheck` — watch `exactOptionalPropertyTypes` (AgentError options) and `noUncheckedIndexedAccess` (if FAULT parsing indexes anything).
2. `bun run lint` — catches missing `.ts` import extensions (editor LSP won't).
3. `bun test`, then `bun test src/agent`.
4. Manual (both Ink and `--console`):
   - `FAULT=529 bun src/index.ts` → one clean stderr line, `echo $?` → 1, terminal echoes normally (raw mode released).
   - `FAULT=400 bun src/index.ts` → same, message names status 400.
   - `FAULT=conn bun src/index.ts` → "couldn't reach the model API" variant.
   - `FAULT=midstream bun src/index.ts <url>` → partial text renders, then clean exit.
   - (SDK retry layer itself, no code involved: `ANTHROPIC_BASE_URL=http://127.0.0.1:9 bun src/index.ts` → SDK retries connection errors twice with backoff, then our clean exit.)
