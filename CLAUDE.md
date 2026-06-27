# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

YouTutor is a command-line tutor for YouTube videos: load a video, then ask questions about specific moments. It answers using both the transcript around a timestamp and the actual video frames from that point.

**Current state:** early scaffold. `index.ts` is still a hello-world; the architecture below is the intended design (from `README.md`), not yet built. The build order in the README's roadmap is deliberate — get the agent loop solid behind a plain console interface *before* layering on the Ink UI.

## Runtime & commands

This is a **Bun** project (not Node). Always prefer Bun tooling — see `.cursor/rules/use-bun-instead-of-node-vite-npm-pnpm.mdc` for the full list. Highlights:

- Run: `bun index.ts` (or `bun run <file>`); `bun --hot <file>` for hot reload
- Install: `bun install` (never npm/pnpm/yarn)
- Test: `bun test`; single file `bun test <path>`; single case `bun test -t "<name>"`
- Lint/format: `bunx biome check` (lint), `bunx biome format --write .` (format), `bunx biome check --write .` (fix). Biome 2.5 is installed but **not yet configured** — add a `biome.json` if defaults need changing.
- Bun auto-loads `.env` (no dotenv). The Anthropic SDK will expect `ANTHROPIC_API_KEY` there.
- Prefer Bun built-ins over npm equivalents: `Bun.file` over `node:fs`, `Bun.$\`...\`` over execa/child_process, `Bun.serve()` over express.

No build/lint/test scripts exist in `package.json` yet — invoke the tools directly as above.

## TypeScript conventions (enforced by tsconfig.json)

These flags change how code must be written:

- `verbatimModuleSyntax` → use `import type { ... }` for type-only imports.
- `allowImportingTsExtensions` + `noEmit` → import local modules **with** the `.ts` extension (e.g. `import { agent } from "./agent.ts"`).
- `noUncheckedIndexedAccess` → indexed/array access is `T | undefined`; narrow before use.
- `exactOptionalPropertyTypes` → don't assign `undefined` to an optional prop; omit it instead.
- Strict mode plus `noImplicitReturns` and `noFallthroughCasesInSwitch` are on.

## Intended architecture

The whole point of the design is a hard separation between the **agent loop** (talk to the model, run tools) and the **interface** (how the human sees output and gives input). The loop must stay UI-agnostic — it should import neither `readline` nor `ink`.

**Agent loop.** The model can only read and emit text, so the harness runs a back-and-forth: send conversation + tool list → model replies with either a tool request or a final answer → run the tool, append result, repeat → stop when the model just answers. One question may take several trips (transcript → frames → answer); the model chooses what it needs at each step. It's not a fixed pipeline.

**Two ports keep the loop decoupled:**

- **Output** — the loop is an async generator that `yield`s semantic events (`textDelta`, `modelResponded`, `toolRunStarted`, `toolRunFinished`, `turnComplete`). The interface consumes them with `for await` and renders however it likes (console → stdout; Ink → React state).
- **Input** — when the loop needs the next user turn or permission to run a tool, it `await`s a method on an injected `Host` port. The host owns both displaying the prompt and returning the answer.

**Tools** live behind a separate `ToolRegistry` port (kept distinct from `Host` — human interaction vs. tool execution are different concerns):

- `load_video(url)` — fetch the timestamped transcript; auto-called on the initial URL.
- `get_transcript_window(timestamp, ±seconds)` — return a slice of transcript around a point, not the whole thing.
- `get_frames(timestamp, count)` — extract frames near a timestamp via ffmpeg, return as images for the model to view.

**Transcripts are captions-first with ASR fallback:** `load_video` tries the video's existing captions (via yt-dlp) first since they're instant; falls back to transcribing audio with a Whisper-class model when captions are missing or low quality.

## External tool dependencies (planned)

The harness shells out to external binaries — these must be installed on the system:

- **yt-dlp** — caption/transcript download
- **ffmpeg** — frame extraction
- **whisper.cpp** (or a hosted ASR endpoint) — transcript fallback

## Key libraries

- `@anthropic-ai/sdk` — the model behind the loop
- `zod` — schema validation (e.g. tool input schemas)
- `ink` — terminal UI, added last on top of the solid loop
