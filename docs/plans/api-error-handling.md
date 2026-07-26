# API error handling (SDK-backed retries)

Implementation plan for the first Tier 1 item in `agent-feature-ideas.md`. Planned 2026-07-25, restaged the same day into four slices after the single-pass version felt too big for one unit of work — this doc is self-contained, work from it directly.

**Staging.** Slices 1 and 2 are the initial unit: clean exit, readable message, restored terminal. Slice 3 is pure test infrastructure — the injection port, scripted fakes, and fault injector — split out so the first PRs don't touch the `Agent` constructor. Slice 4 is the final stage: an `error` AgentEvent so failures surface *in-session* and the conversation survives, instead of a clean exit. Land in order; each slice stands alone, though slice 4 is best landed after slice 3 (its unit tests need the injectable stream, and `FAULT=midstream` is the only way to manually exercise its partial-text case).

## Context

Today `respond()` in `src/agent/agent.ts` calls `client.messages.stream()` with zero error handling: any API failure throws out of the generator, propagates through `index.ts`'s bare `for await`, kills the process with a raw stack trace, skips `renderer.unmount?.()` (leaving Ink's raw-mode stdin claimed), and loses the conversation.

**Approach — no hand-rolled retry loop.** The Anthropic SDK already retries retryable failures (429/5xx/408/409/connection errors) with exponential backoff via `maxRetries` (default 2) on the initial request. Any error that escapes the SDK — including a mid-stream drop, which the SDK does *not* retry — is treated as fatal: wrapped in a typed `AgentError` with a human-readable message, caught in `index.ts`, renderer unmounted properly, one line to stderr, exit non-zero. An earlier draft with an app-level retry-with-backoff loop around the stream was rejected: it duplicates machinery the SDK already provides (sleep injection, backoff math, attempt caps) for marginal benefit.

**Slices 1–2 deliberately add no new `AgentEvent` variants** — failures exit cleanly. The `error` event that surfaces failures *in-session* is slice 4, the final stage of this plan (it matches the open checkbox in `agent-feature-ideas.md`).

**History safety** (matters from slice 2 on): the user message is pushed *before* `respond()` runs, and the assistant message only *after* `finalMessage()` resolves — so a failure leaves `messages` in a valid state on the way out.

## SDK facts relied on (@anthropic-ai/sdk ^0.106, verified against installed typings)

- `maxRetries` (default 2) auto-retries 408/409/429/5xx + connection errors with backoff **for the initial request only**; mid-stream drops surface as throws from stream iteration / `finalMessage()`.
- `Anthropic.APIError` is the base class with `.status`; `Anthropic.APIConnectionError` is a **subclass** of `APIError` in the TS SDK — so `instanceof Anthropic.APIError` catches both HTTP and connection failures.
- `Anthropic.APIError.generate(status, errorBody, message, headers)` is public and returns the correct subclass — used by the `describeApiError` tests (slice 2) and the fault injector (slice 3) so `instanceof` classification is exercised for real.
- `MessageStream implements AsyncIterable<MessageStreamEvent>` with `finalMessage(): Promise<Message>`; params type is `Anthropic.MessageStreamParams`.

## Slice 1 — crash cleanly (`src/index.ts` only, ~10 lines) — ✅ done 2026-07-25

Fixes the worst symptom on its own: a failure today leaves Ink holding raw-mode stdin and the terminal broken. No new files, no agent changes.

Replace the bare `for await` + `unmount` with capture + guaranteed unmount + rethrow:

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
if (failure !== undefined) throw failure; // full stack for now; slice 2 adds the AgentError branch
```

Unmount-before-print means Ink's final repaint can't clobber the error output. The rethrow keeps the full stack (every error is "unexpected" until slice 2 introduces `AgentError`) and exits non-zero on its own.

**Verify** (both Ink and `--console`) — no injector needed, use a real failure: `ANTHROPIC_BASE_URL=http://127.0.0.1:9 bun src/index.ts` → SDK retries the connection error twice with backoff, then the escaped error prints *after* unmount; `echo $?` → non-zero; terminal echoes normally (raw mode released).

## Slice 2 — typed error + readable message — ✅ done 2026-07-25

No injection: keep `private client = new Anthropic()` in `Agent` as-is.

### 2a. `src/agent/agent-error.ts` (new) — ✅ done 2026-07-25

```ts
export class AgentError extends Error { ... } // name = "AgentError"; cause carries the original
```

Plus `describeApiError(err: Anthropic.APIError): string` in the same file — one human sentence (status + API error message, e.g. "the model API rejected the request (status 529: overloaded_error)"; connection errors → "couldn't reach the model API"), no stack dump. It exists to format `AgentError` messages, so it lives with the class.

### 2b. `src/agent/agent.ts` (modify) — ✅ done 2026-07-25

In `respond()`, wrap the stream-create → iterate → `finalMessage()` region:

```ts
try {
	const stream = this.client.messages.stream({ model: MODEL, max_tokens: 64000, system: SYSTEM_PROMPT,
		tools: this.toolRegistry.schemas, messages: this.messages });
	for await (const event of stream) { /* existing textDelta yield */ }
	response = await stream.finalMessage();
} catch (err) {
	// The SDK already retried retryable failures (maxRetries). Anything that gets here —
	// including mid-stream drops, which the SDK doesn't retry — is fatal for the session.
	if (err instanceof Anthropic.APIError)
		// Message is just the description — no "session over" phrasing, since slice 4 makes these
		// survivable; the consumer (index.ts now, the renderer after slice 4) owns the framing.
		throw new AgentError(describeApiError(err), { cause: err });
	throw err; // unexpected bug: propagate raw with stack
}
```

Rest of `respond()` (history push, `modelResponded`, tool loop) unchanged.

### 2c. `src/index.ts` (modify) — ✅ done 2026-07-25

Extend slice 1's tail so known failures print one line instead of a stack:

```ts
if (failure !== undefined) {
	process.exitCode = 1;
	if (failure instanceof AgentError) console.error(failure.message);
	else throw failure; // unexpected: full stack
}
```

`process.exitCode` over `process.exit()` so cleanup flushes; fall back to `process.exit(1)` only if manual testing shows the process lingering on stdin.

### 2d. Test: `src/agent/agent-error.test.ts` (new) — ✅ done 2026-07-25

`describeApiError` on real SDK errors built with `APIError.generate` (429, 529, 400) and `new APIConnectionError(...)`: asserts the status/type appears and the string is one readable sentence. Needs no client and no `ANTHROPIC_API_KEY`.

### 2e. `docs/plans/agent-feature-ideas.md` (modify — after this slice lands) — ✅ done 2026-07-25

Slices 1+2 complete the user-visible outcome, so update the entry now (not after slice 3). Don't tick the top-level "API error handling & retries" box. Follow the doc's nested-checkbox precedent (context-window entry): two children — `[x]` rely on SDK `maxRetries` for retryable errors; escaped errors (incl. mid-stream drops) → `AgentError` → clean unmount/stderr/exit; `[ ]` `error` AgentEvent so failures surface in-session instead of exiting. Reword the entry body to record the decision *against* an app-level retry loop (SDK backoff is the only retry layer). Update *Lands in:*.

### Verify — ✅ done 2026-07-25

1. `bun run typecheck` — watch `exactOptionalPropertyTypes` (AgentError options).
2. `bun run lint` — catches missing `.ts` import extensions (editor LSP won't).
3. `bun test`.
4. Manual, with real failures (both Ink and `--console`):
   - `ANTHROPIC_BASE_URL=http://127.0.0.1:9 bun src/index.ts` → one clean "couldn't reach the model API" line, `echo $?` → 1.
   - Temporarily set `MODEL` to a bogus name → real 400, message names the status.
   - A `TypeError` planted anywhere in the loop → full stack (not wrapped), terminal still restored.

## Slice 3 — testability

Everything below is infrastructure for exercising the slice-2 try/catch under simulated faults. The only failure mode that *can't* be triggered for real is a mid-stream drop — that's the one thing this slice uniquely buys. On its own it could be skipped if the try/catch is trusted from the slice-2 manual runs; but slice 4 wants it in place first — the error-event tests need the injectable stream, so land 3 before 4.

### 3a. `src/agent/model-stream.ts` (new) — port + production factory + fault injector — ✅ done 2026-07-26

```ts
// What Agent.respond() consumes: the event stream plus the assembled final message.
// The SDK's MessageStream satisfies this structurally.
export type ModelStream = AsyncIterable<Anthropic.MessageStreamEvent> & {
	finalMessage(): Promise<Anthropic.Message>;
};
// The model-call port. Injectable for tests; real callers use createAnthropicStreamStarter().
export type ModelStreamStarter = (params: Anthropic.MessageStreamParams) => ModelStream;
```

`createAnthropicStreamStarter()`: builds `new Anthropic()` (comment noting the SDK's built-in `maxRetries: 2` backoff is the *only* retry layer, by design), returns `(params) => client.messages.stream(params)` — zero adapter code. Factory-in-default-param (not a module-level client) so tests that inject a fake never construct the real client or need `ANTHROPIC_API_KEY`. Mirrors the `createVideoStore(fetchVideo = fetchVideoWithYtDlp)` convention.

**Fault injector (dev-only, same file, ~20 lines):** when `process.env.FAULT` is set, wrap the real `ModelStreamStarter` so the *first* request fails (simulating an error that escaped the SDK's retries), then delegate normally. `FAULT=<kind>`:

- numeric (`400`, `429`, `529`, `500`…) → throw `Anthropic.APIError.generate(status, ...)` before iteration
- `conn` → throw `new Anthropic.APIConnectionError({ message: ... })`
- `midstream` → forward the first ~3 real stream events, then throw a connection error from the iterator

(No `:count` syntax — one injected failure is all we need: through slice 3 it ends the session; after slice 4 the first-fail-then-delegate shape is exactly right for watching the session *recover*.)

### 3b. `src/agent/agent.ts` (modify) — ✅ done 2026-07-26

- Delete `private client = new Anthropic()`; keep the `Anthropic` import for types.
- Constructor gains one default-injected param **after** `videoUrl` (existing call sites untouched): `modelStreamStarter: ModelStreamStarter = createAnthropicStreamStarter()`.
- Slice 2's try/catch body swaps `this.client.messages.stream(...)` for `this.startModelStream(...)`; nothing else changes.

### 3c. Test: `src/agent/agent.test.ts` (new)

Spy-factory fakes in the `load-video.test.ts` style: `hostOf(...inputs)` (scripted `requestInput`, then `null`), stub `ToolRegistry` (`schemas: []`), `assistantMessage(text)` minimal `Anthropic.Message` literal (`stop_reason: "end_turn"`), `scriptedModelStreams(...script)` with entries `{ events, final }` / `{ failWith }` / `{ events, thenFailWith }`, returning `{ modelStreamStarter, calls }` (recorded params). Cases:

1. **Happy path** (baseline now that the client is injectable): one turn streams deltas → events contain `textDelta`s + `modelResponded`; `calls[0].messages` ends with the user turn.
2. **API error before stream** (429 via `generate`) → `run()` rejects with `AgentError`, message contains the status, `cause` is the original, `calls.length === 1` (no app-level retry).
3. **Mid-stream connection drop** (`{ events: 2 deltas, thenFailWith: APIConnectionError }`) → the yielded deltas arrive, then `AgentError`.
4. **Non-API `TypeError`** → the same instance propagates raw, not wrapped in `AgentError`.

No `index.ts` test (composition root, no repo precedent) — covered by the manual FAULT runs below.

### Verify

1. `bun run typecheck` — watch `noUncheckedIndexedAccess` (if FAULT parsing indexes anything).
2. `bun run lint`, then `bun test src/agent`.
3. Manual FAULT runs (both Ink and `--console`):
   - `FAULT=529 bun src/index.ts` → one clean stderr line naming 529, `echo $?` → 1, terminal echoes normally.
   - `FAULT=400 bun src/index.ts` → same, message names status 400.
   - `FAULT=conn bun src/index.ts` → "couldn't reach the model API" variant.
   - `FAULT=midstream bun src/index.ts <url>` → partial text renders, then clean exit.

## Slice 4 — surface errors in-session (`error` AgentEvent)

Final stage: an API failure prints an error line and returns to the prompt with the conversation intact, instead of exiting. Depends on slice 2; land after slice 3 (tests below use `scriptedModelStreams`, and `FAULT` runs are the manual verification).

**Why the session can survive:** the throw region in `respond()` sits *before* the assistant push and *after* the tool-results push, so a failed turn always leaves `messages` ending in a user turn. The next prompt appends a second consecutive user message; the Messages API combines consecutive same-role turns into one, so no history repair is needed. (This is the load-bearing fact — re-verify against current API docs at implementation time.)

**Not in scope:** no retry-ability classification. A permanent failure (bad key → 401) surfaces the same as a transient 529 and will just fail again on retry; the message names the status, and the user can `/exit`. Distinguishing "worth retrying" from "give up" isn't worth the machinery for a tutor CLI.

### 4a. `src/agent/agent-event.ts` (modify)

```ts
// The model call failed after the SDK's retries. The turn is abandoned; the loop returns to the
// prompt with the conversation intact — the renderer should show the message and carry on.
| { type: "error"; message: string }
```

### 4b. `src/agent/agent.ts` (modify)

Both `respond()` call sites in `run()` (post-seed and per-turn) go through a small wrapper; `respond()` itself is untouched:

```ts
// AgentError is survivable — announce it and return to the prompt. Anything else is a bug:
// propagate so index.ts's backstop prints the full stack after unmount.
private async *respondSafely(): AsyncGenerator<AgentEvent> {
	try {
		yield* this.respond();
	} catch (err) {
		if (!(err instanceof AgentError)) throw err;
		yield { type: "error", message: err.message };
	}
}
```

### 4c. Renderers (modify all three files)

- `src/console/console-renderer.ts` — new case: close the streamed line first if `midLine` (a mid-stream drop leaves partial text unterminated), then print `✗ ${event.message}`.
- `src/console/ink-app.tsx` — new case in `handle()`: flush the block buffer exactly like `modelResponded` (partial text that arrived before a mid-stream drop still gets shown), reset the buffer, reset `activity` to `THINKING_LABEL`, append `{ kind: "error", text: `✗ ${event.message}` }`.
- `src/console/log-line-view.tsx` — add `"error"` to the `LogLine` kind union, rendered `<Text color="red">` (the switch is exhaustive under `noFallthroughCasesInSwitch`, so the compiler flags the missing case).

### 4d. `src/index.ts` — no change

The `instanceof AgentError` branch stays as a backstop. Nothing should reach it once `run()` consumes AgentErrors, but it's two lines and keeps any future escape path clean.

### 4e. Tests

Extend `src/agent/agent.test.ts` (slice 3's fakes):

1. **Recovery** — script `{ failWith: 429 }` then `{ events, final }`, host scripted with a second input → events contain an `error` event (message names the status) and no `modelResponded` for the failed turn, then the second turn streams normally; `calls.length === 2` and `calls[1].messages` contains both user turns back-to-back.
2. **Mid-stream drop recovers** — `{ events: 2 deltas, thenFailWith: APIConnectionError }` then a good turn → the deltas arrive, then `error`, then the session continues.
3. **Non-API error still fatal** — a `TypeError` still rejects `run()` (slice 3's case 4 keeps passing — `respondSafely` must not swallow it).

Extend the ink-app tests: an `error` event after partial `textDelta`s flushes the partial block and appends the red `✗` line. Per repo convention, verify with and without `FORCE_COLOR=3`, asserting per-line.

### 4f. `docs/plans/agent-feature-ideas.md` (modify)

Tick the remaining `[ ]` child (`error` AgentEvent) *and* the top-level "API error handling & retries" box — this slice completes the entry. Update *Lands in:* to name `agent-event.ts` + the renderers.

### Verify

1. `bun run typecheck`, `bun run lint`, `bun test`.
2. Manual (both Ink and `--console`) — the injector faults only the *first* request, so recovery is directly observable:
   - `FAULT=529 bun src/index.ts` → red/`✗` error line in-session, prompt returns, the next question streams a normal answer.
   - `FAULT=midstream bun src/index.ts <url>` → partial text renders, error line, session continues and the follow-up question still has the video context.
   - `/exit` and Ctrl+C still work after an error.
