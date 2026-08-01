# Prompt caching + /stats

Implementation plan for the "Prompt caching" Tier 1 item in `agent-feature-ideas.md`, planned 2026-07-31. This doc is self-contained — work from it directly. Walkthrough effort: Jake types the code; Claude guides and verifies.

**Why /stats is part of this plan.** A cache hit isn't feelable during tests — latency differences on a dev-sized conversation are noise. The API reports cache activity in `usage` on every response, so the observability half of this plan surfaces those numbers behind a `/stats` slash command (session totals). That's the proof the caching works, and it doubles as the seed of two Tier 2 ideas: slash commands beyond `/exit`, and the token/cost status line.

## Context

Every model round-trip resends the full system prompt, tool schemas, and conversation history at full input price. Frame-heavy histories get long fast — images are big — so the resend cost grows every turn. Prompt caching lets the API reuse the already-processed prefix: cached reads bill at ~0.1× input price and skip reprocessing latency.

**How caching works (the one invariant):** it's a *prefix match*. The request renders as `tools → system → messages`, and a `cache_control` breakpoint marks "cache everything up to here". Any byte change before a breakpoint invalidates it. Our prefix is naturally stable — the tool schemas are built once (`createToolRegistry()` in `src/tools/registry.ts` maps them at construction), the system prompt is a frozen string, and history only ever appends — so we get near-ideal cache behavior for two markers:

1. **System prompt breakpoint** — covers tools + system (tools render first, so one marker on the last system block caches both).
2. **Last-message breakpoint** — moved to the new tail each request, so every request reuses the previous request's entire history as a cached prefix. This is where the real money is: the frames live in history.

Max 4 breakpoints per request; we use 2.

**The load-bearing subtlety: don't mutate history.** `respond()` passes the live `this.messages` array to the SDK. If we attached `cache_control` by mutating the last block, every turn would add another marker — past 4 the API rejects the request, and history would be polluted with stale markers that no longer sit at the tail. So the last-message marker is attached *at request construction time* on a copy; `this.messages` never carries one.

**Known caveat (document, don't fight):** each model has a minimum cacheable prefix; for Haiku 4.5 (the dev model) it's **4096 tokens**. Below the minimum a marker silently does nothing — `cache_creation_input_tokens` stays 0, no error. Our system prompt (~1.2 KB) plus three tool schemas is well under that, so the first requests of a session show zero cache activity. Once a transcript slice or frames enter history the prefix blows past 4096 and caching kicks in. This is expected behavior, not a bug — and exactly why `/stats` matters for verification.

## SDK/API facts relied on (@anthropic-ai/sdk ^0.106)

- `cache_control: { type: "ephemeral" }` on a content block marks a breakpoint; default TTL 5 minutes (fine within a session). Valid on `text`, `image`, `tool_use`, `tool_result` blocks — but **not on a plain-string `content`**, so string messages need converting to a one-element text-block array at request time.
- `MessageStreamParams["system"]` accepts `string | TextBlockParam[]` — the array form is what lets the system prompt carry a marker.
- `response.usage` (from `stream.finalMessage()`) carries `input_tokens`, `output_tokens`, `cache_read_input_tokens: number | null`, `cache_creation_input_tokens: number | null`. Treat null as 0.
- `input_tokens` is the *uncached remainder only* — total prompt size = `input_tokens + cache_read + cache_creation`. A tiny `input_tokens` alongside a large `cache_read` is caching working, not a reporting bug.
- Cache writes bill at ~1.25×, reads at ~0.1× — two requests over the same prefix already break even.

## Steps

### 1. This doc — ✅ done 2026-07-31

### 2. System prompt breakpoint — `src/agent/agent.ts`

In `respond()`'s request construction, change `system: SYSTEM_PROMPT` to the array form:

```ts
system: [{ type: "text", text: SYSTEM_PROMPT, cache_control: { type: "ephemeral" } }],
```

One line; caches tools + system together (once over the model's minimum).

### 3. Last-message breakpoint — `src/agent/agent.ts`

A module-level helper (below the `MODEL` constant is a natural spot) that returns a copy of the messages with a marker on the very last content block — no mutation of the input:

- Empty array → return as-is (the `noTools`/no-seed edge).
- Last message's `content` is a string (user prompts are pushed as `content: prompt`) → replace with `[{ type: "text", text: content, cache_control: ... }]`.
- Block array → copy the array; spread the marker onto a copy of its last block.

Call it in the request: `messages: withCacheBreakpoint(this.messages)` (name is Jake's call). The non-mutation property is the thing the tests pin down.

### 4. Usage totals + `stats` event — `src/agent/agent-event.ts`, `src/agent/agent.ts`

- New `AgentEvent` variant (doc comment in the file's style):
  `{ type: "stats"; usage: { input: number; output: number; cacheRead: number; cacheWrite: number } }`
- `Agent` gains a private totals object with the same four counters. After `stream.finalMessage()` resolves, add `response.usage`'s four fields into it (`?? 0` for the nullable cache fields). This sits inside the tool-loop `while`, so multi-trip turns count every request.
- In `run()`, after the `/exit` check: `/stats` yields the `stats` event with the current totals and `continue`s — no message push, no model call. Plain string handling, per the feature doc's slash-command note (no command table yet at two commands).

### 5. Render it — `src/console/console-renderer.ts`, `src/console/ink-app.tsx`, `src/console/log-line-view.tsx`

Renderers silently ignore unknown events (no `default` in the switches), so both need a case:

- Console: one `console.log` line, e.g. `tokens: in 12345 · out 4321 · cache read 118k · cache write 9k` (format Jake's call).
- Ink: new case in `handle()` appending a log line via `appendLine` (the `<Static>` fresh-array rule); new `"stats"` kind in `LogLine`, rendered `<Text dimColor>` in `LogLineView`.

### 6. Tests — `src/agent/agent.test.ts`, `src/console/ink-app.test.ts`

`scriptedModelSession` already records every request's params, so breakpoint placement is directly assertable:

1. **Placement** — after one turn, `calls[0]?.system` is the array form with `cache_control`; the last message's last block carries the marker.
2. **No stale markers** — drive two requests (a tool round-trip, or two user turns); assert the second call's messages carry a marker *only* on the final block, and that the block that was the tail during call 1 is clean. This is the regression test for the non-mutation rule.
3. **Totals + `/stats`** — script responses whose `finishedMessage` usage carries non-zero values (and one with null cache fields), drive turns then `/stats` via `hostWithInputs`, assert the `stats` event's summed totals. The existing four `toEqual` event assertions shouldn't change (`modelResponded` keeps its shape) — verify they still pass.
4. **Ink** — `app.handle({ type: "stats", ... })` renders the dim line; assert per-line with `toContain`, run with and without `FORCE_COLOR=3`.

### 7. Verify live

1. `bun run typecheck`, `bun run lint`, `bun test`.
2. Real run (both Ink and `--console`): `bun src/index.ts <url>`, ask 2–3 questions — at least one that pulls frames — then `/stats`. Expect: first turns show zero cache activity (Haiku's 4096-token minimum), then cache write > 0 once history grows, then cache read climbing turn over turn. Ask another question and `/stats` again to watch read grow.

### 8. Docs — `docs/plans/agent-feature-ideas.md`

Tick the **Prompt caching** box with a *Landed in:* line (`agent.ts` request construction + `agent-event.ts` + renderers). Under the Tier 2 slash-commands entry, note `/stats` shipped as the second command (ahead of that entry's schedule), which also partially seeds the status-line item.
