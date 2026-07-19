# Ink integration — follow-up ideas

Follow-ups deferred from the minimal integration ([ink-minimal-integration.md](ink-minimal-integration.md), completed 2026-07-18), roughly in suggested order. Each stands alone; none is urgent — the current `InkApp` works end-to-end.

## 1. `<Static>` for scrollback — the one real correctness gap ✅ DONE (2026-07-18)

Everything rendered in Ink's dynamic region, which is capped at terminal height. When a frame overflows, Ink 7.1.1 falls back to a full clearTerminal + whole-frame rewrite on every render — `\x1b[3J` destroys the terminal's real scrollback (including pre-launch shell history) each frame, and every streaming delta rewrites the entire session. Fixed by moving completed entries (`lines`) into Ink's `<Static>` component — items render once, permanently, above the dynamic region — while only the in-progress `current` text and the input field stay dynamic; the dynamic region now stays small enough that the fallback never fires. Touched `AppView` plus one requirement on `InkApp`: `<Static>` memoizes on the `items` array *reference*, so appends must create a fresh array (private `appendLine`), not `push` in place. Full walkthrough + findings: [ink-static-scrollback.md](ink-static-scrollback.md).

## 2. Ctrl+D → `null` (EOF parity with `consoleHost`)

`consoleHost.requestInput()` returns `null` on Ctrl+D; `InkApp` currently only ends via `/exit` (or Ink's default Ctrl+C hard exit). A `useInput` hook in `AppView` that watches for Ctrl+D and calls an `onEof` callback prop — which resolves the stashed resolver with `null` — restores parity. A few lines; also a nice first exposure to `useInput`.

## 3. Spinner / activity indicator during tool runs

Between `toolRunStarted` and `toolRunFinished` (and while the model is thinking before first delta), the UI is just still. A spinner line in the dynamic region — driven by a "tool in flight" / "awaiting model" flag in `InkApp` state — makes waiting legible. Can be hand-rolled with `useEffect` + interval or taken from `@inkjs/ui`. First step toward richer status display.

## 4. `--console` flag for the renderer swap

`index.ts` keeps the bare console host/renderer as a commented-out block, but swapping requires a three-spot hand edit (duplicate `const`s, missing imports, no `unmount()` on `consoleHost`). If demoing the swap becomes a habit, replace the comment block with a real CLI flag choosing between the two `Host`+`Renderer` pairs. Consider giving `Renderer` (or a shared lifecycle) an optional `close()`/`unmount()` so `index.ts` doesn't special-case Ink.

## 5. Visual polish

All cosmetic, all confined to `AppView`:
- Color/dim the `⚙`/`✓` tool lines and the `> ` echoes so replies stand out.
- Split multi-paragraph replies on newlines at push time (each `lines` entry is currently a whole reply block — works, since `<Text>` renders embedded `\n`s, but per-line entries compose better with `<Static>` and styling).
- Markdown rendering of replies (e.g. `ink-markdown`) — only after the basics feel right.

## 6. Empty-submit noise

Submitting an empty input echoes a bare `> ` line into the log before the agent re-prompts. Either skip the echo for empty text in `submitInput`, or don't resolve at all on empty submit (keep waiting). Tiny; bundle with other polish.

## 7. Tests for the Ink layer

The console layer has no tests; the Ink layer could get them via `ink-testing-library` (new dev dependency): mount `AppView` / drive `InkApp.handle()` with synthetic `AgentEvent`s and assert on the rendered frames, plus the `requestInput()` promise-bridge behavior. Worth doing before the UI grows much — the imperative `rerender()` driver makes `InkApp` easy to drive synthetically.

Do this refactor as part of the test work: `InkApp`'s constructor currently calls `render()`, i.e. constructing the object paints the terminal (claims stdout, patches `console`). The lifecycle itself is fine — the object *is* the live UI session, and two-phase `new` + `mount()` would be worse (nullable `ink` field, "constructed but not mounted" state everywhere). But name the side effect and create a test seam: make the constructor private and trivial, expose a static factory (`InkApp.mount()`) so the call site in `index.ts` announces the paint, and let the factory/constructor accept the render function (or Ink `Instance`) as a parameter so tests can inject `ink-testing-library`'s fake instead of real stdout.

## Someday / open questions

- **Hooks-driven state**: `InkApp`'s imperative mutate-then-`rerender()` driver was chosen as the minimal proof surface. If the UI grows real interactivity (scrolling, focus, multiple panes), consider inverting: state lives in the component (`useState`/`useReducer`), and `InkApp` shrinks to an event-forwarding shell. Don't do this preemptively — the imperative driver is simpler while the component stays a pure projection.
- **Richer event vocabulary**: a fancier UI may want events the loop doesn't emit yet (e.g. turn boundaries, tool progress). That's an `AgentEvent` design question, not an Ink one — extend the union deliberately, not per-widget.
