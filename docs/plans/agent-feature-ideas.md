# Standard agent features — candidates for YouTutor

A survey of features that are common across mature agent harnesses (Claude Code, aider, Codex CLI, etc.), filtered for what makes sense in a single-purpose video tutor and grouped by how important they are. The checkboxes track what's been picked up. Each entry notes what the feature is, why it matters here, and where it would land in this codebase.

## Tier 1 — robustness gaps most agents close early

These are less "features" than hardening. Users only notice them when they're missing.

- [x] **API error handling & retries**
  The SDK's built-in `maxRetries` backoff (429/5xx/408/409/connection errors, on the initial request) is the *only* retry layer, by design — an app-level retry-with-backoff loop around the stream was considered and rejected: it duplicates machinery the SDK already provides (sleep injection, backoff math, attempt caps) for marginal benefit. Anything that escapes the SDK — including a mid-stream drop, which it does not retry — is wrapped in a typed `AgentError` whose message is one human-readable sentence (`describeApiError`). Plan with full rationale: `api-error-handling.md`.
  - [x] Rely on SDK `maxRetries` for retryable errors; escaped errors (incl. mid-stream drops) → `AgentError` → clean unmount, one line to stderr, exit non-zero.
  - [x] `error` AgentEvent so failures surface in-session with the conversation intact, instead of exiting.

  *Lands in:* `agent-error.ts` (new), the try/catch in `agent.ts` `respond()` + the `respondSafely()` wrapper in `run()`, the `error` variant in `agent-event.ts`, the error cases in all three renderers (`console-renderer.ts`, `ink-app.tsx`, `log-line-view.tsx`), and the `AgentError` backstop in `index.ts`.

- [ ] **Mid-turn abort (Esc to cancel)**
  Already recorded in `someday.md` with the design direction: AbortController plumbed through the loop, triggered by Esc, cancelling the in-flight model call or tool run and reprompting. Listed here because among mature agents this is table stakes — a long tool call (yt-dlp on a slow connection) with no way out is the most frustrating single interaction.
  *Lands in:* the loop (cancellation) + Ink host (Esc handling). See `someday.md` for the reasoning already captured.

- [ ] **Context window management**
  The conversation grows without bound — frames are images and they're *big*, so a long session on a frame-heavy video will eventually blow the context limit and the request will just fail. Common strategies, roughly in order of effort:
  - [ ] **Token usage tracking** — the API returns `usage` on every response; surface it (see status line, Tier 2) and warn as the limit nears. (`Agent` now accumulates session totals and `/stats` shows them on demand, via prompt caching below; the nearing-limit warning is still open.)
  - [ ] **Tool-result pruning** — drop or stub old `tool_result` blocks (especially frame images) from history after N turns; the model rarely needs to re-see old frames, and can re-fetch if it does. Cheap and very effective here since frames dominate.
  - [ ] **Compaction** — summarize the oldest turns into a single message when near the limit (what Claude Code's auto-compact does). The heavyweight option; probably only needed if pruning proves insufficient.

  *Lands in:* `agent.ts` owns the history, so pruning/compaction live there; usage flows out as an event.

- [x] **Prompt caching**
  Every round-trip resends the full system prompt, tool schemas, and history. Two `cache_control` breakpoints (system prompt + last message, the latter attached non-mutatingly at request construction so history never carries stale markers) cut cost/latency meaningfully once conversations get long — and frame-heavy histories get long fast. Verified live on Sonnet 5: steady state is ~2 uncached input tokens per request, with the entire frame-laden history read back at ~0.1× price. Session totals are visible via `/stats` (the observability half of the same effort). Plan with full rationale: `prompt-caching.md`.
  *Landed in:* `agent.ts` (`withCacheBreakpoint` + `respond()` request construction, usage totals, `/stats` in `run()`), the `stats` variant in `agent-event.ts`, and the stats cases in the renderers (`console-renderer.ts`, `ink-app.tsx`, `log-line-view.tsx`).

## Tier 2 — UX features users will actually reach for

- [ ] **Slash commands beyond `/exit`**
  The `/exit` check in `run()` is the seed of a command system. The usual set:
  - [ ] `/help` — list commands
  - [ ] `/clear` or `/new` — reset the conversation (keep the loaded video)
  - [ ] `/video` — reshow the current video's title/description/span (re-orientation without burning a model turn)
  - [ ] `/model` — show or switch the model mid-session

  Worth keeping deliberately small — a tutor doesn't need Claude Code's command surface. Per CLAUDE.md, this stays plain string handling, no zod.
  `/stats` (session token totals) shipped ahead of this entry as part of prompt caching (Tier 1) — the second command after `/exit`, still plain string checks. It also produces the data the status line below would show.
  *Lands in:* the input check in `agent.ts` `run()`; if it grows past a few commands, a small command table.

- [ ] **Input history & line editing**
  Up-arrow to recall previous prompts, basic multiline input. Bare `readline` gives history almost for free on the console host; the Ink host would keep its own history array behind `ink-text-input`. Small effort, large day-to-day comfort.
  *Lands in:* hosts only — the loop never knows.

- [ ] **Status line: tokens, cost, model**
  A persistent footer showing model name, tokens used this session, and estimated cost. Standard in Claude Code and aider; especially relevant here because frames are expensive and users have no intuition for image token costs. Depends on usage tracking (Tier 1).
  *Lands in:* new `AgentEvent` carrying usage → Ink footer component.

- [x] **Markdown rendering** — done
  Terminal markdown (bold, lists, code spans) makes tutor-style explanations much more readable. Shipped in the Ink layer: `LogLineView` renders `reply` lines through `markdansi`, block by block via `BlockBuffer` so it composes with block streaming. The bare console host stays plain.
  *Landed in:* `src/console/log-line-view.tsx` (`renderReply`).

## Tier 3 — session & persistence features

- [ ] **Session persistence / resume**
  Save `messages` (and the loaded video URL) to disk; `--resume` or `--continue` picks the conversation back up. Very standard, and a natural fit here — "continue working through this lecture" is a real tutoring pattern. Frame images make naive JSON dumps large; storing frames by reference (timestamp, re-fetchable) instead of by value would keep session files small and doubles as context pruning.
  *Lands in:* `agent.ts` owns `messages`; persistence could be a small store injected like `VideoStore`, triggered on exit + on turn boundaries.

- [ ] **Conversation export**
  `/export` writing a markdown transcript (questions, answers, which timestamps were examined). For a tutor this is genuinely useful — the session *is* study notes. Cheap once history is inspectable.

- [ ] **Config file**
  `~/.yoututor.json` or similar for defaults: model, maybe a frames-quality setting. Currently `ANTHROPIC_MODEL` in `.env` covers the only real knob, so this earns its keep only when a second or third setting shows up. Skip until then.

## Tier 4 — power features (probably overkill, recorded for completeness)

- [ ] **Tool permission prompts** — `Host` gaining a `requestPermission()` method is the classic second port method (CLAUDE.md's architecture section even anticipates it). But all three tools are read-only and cheap; permissions guard against side effects this agent doesn't have. Skip unless a mutating tool appears.
- [ ] **Extended thinking** — enable thinking blocks for harder questions ("explain the proof at 12:40"). Real quality win on reasoning-heavy material, but adds stream-handling and history rules; Haiku-as-dev-model also limits payoff. Revisit if answer quality on hard content disappoints.
- [ ] **Sub-agents** — spinning off a side loop (e.g. "summarize the whole video" without polluting the main conversation). Heavy machinery; a tutor session rarely needs isolation.
- [ ] **MCP / plugin tools** — letting outside tools register into `ToolRegistry`. The registry port makes it architecturally easy, but the product doesn't call for it.
- [ ] **Multi-video sessions** — comparing two videos. Real feature, real complexity (VideoStore keyed by URL is already halfway there); wait for the need.

## Suggested first picks

If choosing three: **API error handling**, **prompt caching**, and **slash commands + input history** — the first two harden the loop invisibly, the third is the most-felt daily UX gain. Mid-turn abort is the best fourth once cancellation design is settled.
