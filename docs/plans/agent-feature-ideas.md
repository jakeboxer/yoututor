# Standard agent features — candidates for YouTutor

A survey of features that are common across mature agent harnesses (Claude Code, aider, Codex CLI, etc.), filtered for what makes sense in a single-purpose video tutor. Nothing here is planned work; it's a menu. Each entry notes what the feature is, why it matters here, and where it would land in this codebase.

Grouped by how strongly I'd recommend them, not by theme.

## Tier 1 — robustness gaps most agents close early

These are less "features" than hardening. Users only notice them when they're missing.

### API error handling & retries
The loop calls `client.messages.stream()` with no handling for rate limits (429), overloaded errors (529), or network failures — any of these currently kills the session and the whole conversation with it. Standard practice is retry with exponential backoff for retryable errors (the SDK has `maxRetries` built in, but a mid-stream drop still needs a catch), and a clean in-session error message for the rest.
*Lands in:* `agent.ts` `respond()`, plus maybe a new `AgentEvent` (`error` or `retrying`) so the UI can show it.

### Mid-turn abort (Esc to cancel)
Already recorded in `someday.md` with the design direction: AbortController plumbed through the loop, triggered by Esc, cancelling the in-flight model call or tool run and reprompting. Listed here because among mature agents this is table stakes — a long tool call (yt-dlp on a slow connection) with no way out is the most frustrating single interaction.
*Lands in:* the loop (cancellation) + Ink host (Esc handling). See `someday.md` for the reasoning already captured.

### Context window management
The conversation grows without bound — frames are images and they're *big*, so a long session on a frame-heavy video will eventually blow the context limit and the request will just fail. Common strategies, roughly in order of effort:
1. **Token usage tracking** — the API returns `usage` on every response; surface it (see status line, Tier 2) and warn as the limit nears.
2. **Tool-result pruning** — drop or stub old `tool_result` blocks (especially frame images) from history after N turns; the model rarely needs to re-see old frames, and can re-fetch if it does. Cheap and very effective here since frames dominate.
3. **Compaction** — summarize the oldest turns into a single message when near the limit (what Claude Code's auto-compact does). The heavyweight option; probably only needed if pruning proves insufficient.
*Lands in:* `agent.ts` owns the history, so pruning/compaction live there; usage flows out as an event.

### Prompt caching
Every round-trip resends the full system prompt, tool schemas, and history. Adding `cache_control` breakpoints (system prompt + last message) is a few lines and cuts cost/latency meaningfully once conversations get long — and frame-heavy histories get long fast. Near-zero effort, pure win.
*Lands in:* `agent.ts` `respond()` request construction.

## Tier 2 — UX features users will actually reach for

### Slash commands beyond `/exit`
The `/exit` check in `run()` is the seed of a command system. The usual set:
- `/help` — list commands
- `/clear` or `/new` — reset the conversation (keep the loaded video)
- `/video` — reshow the current video's title/description/span (re-orientation without burning a model turn)
- `/model` — show or switch the model mid-session
Worth keeping deliberately small — a tutor doesn't need Claude Code's command surface. Per CLAUDE.md, this stays plain string handling, no zod.
*Lands in:* the input check in `agent.ts` `run()`; if it grows past a few commands, a small command table.

### Input history & line editing
Up-arrow to recall previous prompts, basic multiline input. Bare `readline` gives history almost for free on the console host; the Ink host would keep its own history array behind `ink-text-input`. Small effort, large day-to-day comfort.
*Lands in:* hosts only — the loop never knows.

### Status line: tokens, cost, model
A persistent footer showing model name, tokens used this session, and estimated cost. Standard in Claude Code and aider; especially relevant here because frames are expensive and users have no intuition for image token costs. Depends on usage tracking (Tier 1).
*Lands in:* new `AgentEvent` carrying usage → Ink footer component.

### Markdown rendering
Model answers are markdown but render as raw text. Terminal markdown (bold, lists, code spans) makes tutor-style explanations much more readable. Ink makes this tractable (e.g. parse + style per-block); the bare console host can stay plain.
*Lands in:* renderer/Ink layer only. Interacts with block streaming — check `docs/plans/` before touching.

## Tier 3 — session & persistence features

### Session persistence / resume
Save `messages` (and the loaded video URL) to disk; `--resume` or `--continue` picks the conversation back up. Very standard, and a natural fit here — "continue working through this lecture" is a real tutoring pattern. Frame images make naive JSON dumps large; storing frames by reference (timestamp, re-fetchable) instead of by value would keep session files small and doubles as context pruning.
*Lands in:* `agent.ts` owns `messages`; persistence could be a small store injected like `VideoStore`, triggered on exit + on turn boundaries.

### Conversation export
`/export` writing a markdown transcript (questions, answers, which timestamps were examined). For a tutor this is genuinely useful — the session *is* study notes. Cheap once history is inspectable.

### Config file
`~/.yoututor.json` or similar for defaults: model, maybe a frames-quality setting. Currently `ANTHROPIC_MODEL` in `.env` covers the only real knob, so this earns its keep only when a second or third setting shows up. Skip until then.

## Tier 4 — power features (probably overkill, recorded for completeness)

- **Tool permission prompts** — `Host` gaining a `requestPermission()` method is the classic second port method (CLAUDE.md's architecture section even anticipates it). But all three tools are read-only and cheap; permissions guard against side effects this agent doesn't have. Skip unless a mutating tool appears.
- **Extended thinking** — enable thinking blocks for harder questions ("explain the proof at 12:40"). Real quality win on reasoning-heavy material, but adds stream-handling and history rules; Haiku-as-dev-model also limits payoff. Revisit if answer quality on hard content disappoints.
- **Sub-agents** — spinning off a side loop (e.g. "summarize the whole video" without polluting the main conversation). Heavy machinery; a tutor session rarely needs isolation.
- **MCP / plugin tools** — letting outside tools register into `ToolRegistry`. The registry port makes it architecturally easy, but the product doesn't call for it.
- **Multi-video sessions** — comparing two videos. Real feature, real complexity (VideoStore keyed by URL is already halfway there); wait for the need.

## Suggested first picks

If choosing three: **API error handling**, **prompt caching**, and **slash commands + input history** — the first two harden the loop invisibly, the third is the most-felt daily UX gain. Mid-turn abort is the best fourth once cancellation design is settled.
