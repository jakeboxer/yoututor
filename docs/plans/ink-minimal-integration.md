# Minimal Ink renderer + input — guided walkthrough

> **Working mode:** This is a guided walkthrough — Jake writes every line of code; Claude explains what to write and why, reviews the result, and runs read-only checks (`bun run typecheck`, `bun run lint`) at each checkpoint. (This plan file itself is the one sanctioned exception.)
>
> **Status:** in progress, started 2026-07-17. Check off steps as they complete.

## Context

YouTutor's build order deliberately deferred Ink until the agent loop was solid behind a plain console interface. That milestone is done: the loop yields semantic `AgentEvent`s, `ConsoleRenderer.handle(event)` consumes them, and input comes through the `Host` port. This is the first Ink step — a deliberately small integration whose goal is to **prove Ink works in this Bun project as both renderer and host**: deps install, JSX compiles, `render()` paints, a class implementing the existing `handle(event)` contract drives an Ink component from the agent's event stream, and `requestInput()` resolves from an Ink text field. Richer UI and `<Static>` scrollback come later.

## Known ground (no rediscovery needed)

- `tsconfig.json` already has `"jsx": "react-jsx"` (automatic runtime — no `import React` needed). Bun transpiles `.tsx` natively. **No config changes required.**
- The renderer contract is implicit today: `ConsoleRenderer.handle(event: AgentEvent): void`, with a comment anticipating a shared `Renderer` interface. Step 3 makes that interface real.
- `AgentEvent` has exactly 4 members (`src/agent/agent-event.ts`): `textDelta { text }`, `modelResponded`, `toolRunStarted { name, input }`, `toolRunFinished { name, result }`. There is no `turnComplete`.
- The `Host` port (`src/agent/host.ts`) is one method: `requestInput(): Promise<string | null>`. Because the agent loop `await`s this promise, an Ink host needs no loop changes — the component just resolves the promise on submit.

## Steps

### [x] Step 1 — Install dependencies (done 2026-07-17: ink 7.1.1, ink-text-input 6.0.0, react 19.2.7, @types/react 19.2.17)
Run `bun add ink react ink-text-input` and `bun add -d @types/react`.
React is a real dependency (Ink is a React *renderer*); `@types/react` is dev-only (types, no runtime); `ink-text-input` is the smallest path to Ink-owned input.
**Checkpoint:** `bun run typecheck` still passes.

### [x] Step 2 — Standalone smoke test (throwaway file) (done 2026-07-17)
Create `src/console/ink-smoke.tsx`: the smallest possible Ink program — `render()` + one `<Text>` — run with `bun src/console/ink-smoke.tsx`.
**Checkpoint:** styled text appears and the process exits cleanly. Isolates toolchain problems (Bun + Ink + JSX) from integration problems.

### [x] Step 3 — Make the `Renderer` port explicit (done 2026-07-17)
Create `src/console/renderer.ts` with `type Renderer = { handle(event: AgentEvent): void }`; update `ConsoleRenderer` to `implements Renderer`.
Conventions: `type` over `interface`, one port per file, `.ts` import extensions, `import type` for the event type.
**Checkpoint:** typecheck + lint pass.

### [x] Step 4 — The Ink app, output side first (done 2026-07-17)
Create `src/console/ink-app.tsx`:
- A small presentational component taking completed `lines: string[]` plus in-progress `current: string`, rendering a `<Box flexDirection="column">` of `<Text>` lines.
- An `InkApp` class `implements Renderer` holding plain mutable state (`lines`, `current`); `render()` once in the constructor, `rerender()` with fresh props in `handle(event)`. Event mapping mirrors `ConsoleRenderer`: `textDelta` appends to `current`; `modelResponded` promotes `current` to a completed line; `toolRunStarted`/`toolRunFinished` append `⚙ name` / `✓ name` lines.
- An `unmount()` method delegating to Ink's, for clean process exit.
**Checkpoint:** typecheck + lint pass.

### [ ] Step 5 — Input side: `InkApp` implements `Host`
Extend the same file so `InkApp implements Renderer, Host`:
- **Promise bridge:** `requestInput()` creates a `Promise<string | null>`, stashes its `resolve` on the instance, flips an `awaitingInput` flag, rerenders. On submit, the class records `> text` as a log line, clears the flag, rerenders, resolves. The awaiting agent loop wakes with the input — no loop changes.
- **Component:** when `awaitingInput`, render `ink-text-input`'s `<TextInput>` behind a `> ` prompt. The input value is the component's only `useState`; `onSubmit` calls a callback prop and clears the field. (React preserves this state across `rerender()` since component identity is stable.)
- **Exit paths:** `/exit` ends the loop agent-side; Ink's default Ctrl+C covers hard exit. Ctrl+D → `null` (EOF parity with `consoleHost`) via `useInput` is optional — decide in the moment.
**Checkpoint:** typecheck + lint pass.

### [ ] Step 6 — Wire it in
Edit `src/index.ts`: construct one `InkApp`, pass it as **both** the `Host` (to `new Agent(...)`) and the renderer in the `for await` loop, replacing `consoleHost` and `ConsoleRenderer` (both files stay as the fallback). Call `app.unmount()` after the loop.

### [ ] Step 7 — Prove it end-to-end
Run `bun src/index.ts <some-youtube-url>`: seeded `load_video` tool lines → greeting streams in → text field appears → a question round-trips (tool lines, streamed answer) → submitted input echoed into the log → `/exit` ends with a clean terminal. Ink owns stdout and stdin, so no prompt-glitch caveat.

### [ ] Step 8 — Cleanup
Delete `src/console/ink-smoke.tsx`. Final `bun run typecheck` / `bun run lint` / `bun test`.

## Files touched

- `package.json` / `bun.lock` — add `ink`, `react`, `ink-text-input`, `@types/react` (Step 1)
- `src/console/ink-smoke.tsx` — created Step 2, deleted Step 8
- `src/console/renderer.ts` — new `Renderer` port (Step 3)
- `src/console/console-renderer.ts` — add `implements Renderer` (Step 3)
- `src/console/ink-app.tsx` — new: `InkApp implements Renderer, Host` (Steps 4–5)
- `src/index.ts` — swap in `InkApp` as host + renderer, add unmount call (Step 6)

Untouched: everything in `src/agent/` and `src/tools/` — the ports design means the loop doesn't change at all.

## Verification

- After each step: `bun run typecheck` and `bun run lint`.
- Step 2: smoke file runs and exits cleanly.
- Step 7: full session against a real YouTube video — streaming deltas, tool lines, text-field round-trip, `/exit` exits without a hung or garbled terminal.
- `bun test` at the end to confirm nothing regressed.

## Deliberately out of scope (future milestones)

- `<Static>` for scrollback: dynamic-region-only output clips at terminal height on long sessions; completed lines should eventually move to `<Static>`.
- Hooks/state-driven rendering throughout, styling, spinners, markdown rendering, `ink-testing-library` tests.
