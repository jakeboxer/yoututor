# Ink integration — follow-up ideas

Follow-ups deferred from the minimal integration ([ink-minimal-integration.md](ink-minimal-integration.md), completed 2026-07-18), roughly in suggested order. Each stands alone; none is urgent — the current `InkApp` works end-to-end.

- [x] **1. `<Static>` for scrollback — the one real correctness gap** *(done 2026-07-18)*

  Everything rendered in Ink's dynamic region, which is capped at terminal height. When a frame overflows, Ink 7.1.1 falls back to a full clearTerminal + whole-frame rewrite on every render — `\x1b[3J` destroys the terminal's real scrollback (including pre-launch shell history) each frame, and every streaming delta rewrites the entire session. Fixed by moving completed entries (`lines`) into Ink's `<Static>` component — items render once, permanently, above the dynamic region — while only the in-progress `current` text and the input field stay dynamic; the dynamic region now stays small enough that the fallback never fires. Touched `AppView` plus one requirement on `InkApp`: `<Static>` memoizes on the `items` array *reference*, so appends must create a fresh array (private `appendLine`), not `push` in place. Full walkthrough + findings: [ink-static-scrollback.md](ink-static-scrollback.md).

- [x] **2. Ctrl+D → `null` (EOF parity with `consoleHost`)** *(done 2026-07-18; grew to cover Ctrl+C)*

  `consoleHost.requestInput()` returns `null` on Ctrl+D; `InkApp` only ended via `/exit`. Fixed with one always-active `useInput` hook in `AppView`: Ctrl+D at the prompt calls an `onEof` prop → `InkApp.submitEof()` resolves the stashed resolver with `null`, and the loop winds down normally. Ctrl+C came along for the ride: Ink's default `exitOnCtrlC` only unmounted the UI while the process stayed parked on the pending `requestInput` promise (hence the old press-twice exit), so it's disabled and Ctrl+C now always routes to `InkApp.interrupt()` — unmount, then `process.exit(130)` — whether or not input is awaited. Semantics chosen deliberately: EOF is an answer to a prompt (prompt-only, gated on `awaitingInput`); interrupt must work precisely when the app is busy (unconditional, honest exit code). The component's `awaitingInput` gate expresses intent, but the `inputResolver !== null` guard in `InkApp` is the authoritative check — props can be one frame stale. Deferred: graceful mid-turn abort (Ctrl+C cancels the in-flight model/tool call and reprompts instead of exiting) needs cancellation plumbed through the agent loop — an `AgentEvent`/loop design question, see the someday list.

- [x] **3. Spinner / activity indicator during tool runs** *(done 2026-07-19)*

  Between `toolRunStarted` and `toolRunFinished` (and while the model is thinking before first delta), the UI was just still. Fixed in two halves along the existing seam: `InkApp` tracks *what* is happening — an `activity` label set to `Running <name>` on `toolRunStarted` and back to a thinking label on `toolRunFinished`, passed to `AppView` as a prop — while the *animation* lives entirely in a hand-rolled `Spinner` component (`src/console/spinner.tsx`, no new dependency): `useState` frame index + mount-once `useEffect` interval cycling braille frames at 80ms. That split is the point: the imperative `InkApp` driver only rerenders on agent events, but a component that `setState`s on a timer repaints itself through Ink's reconciler. Visibility is derived, not tracked: the line shows when `!awaitingInput && current === ""` — busy, and nothing visibly streaming — and the effect cleanup stops the timer whenever the spinner unmounts. Two details that matter: the interval callback uses the functional setter (no stale capture, deps stay `[]` — omitting the deps array churned a fresh interval every render), and `FRAMES[i]`'s `noUncheckedIndexedAccess` `undefined` is absorbed by JSX (undefined child renders nothing).

- [ ] **4. `--console` flag for the renderer swap**

  `index.ts` keeps the bare console host/renderer as a commented-out block, but swapping requires a three-spot hand edit (duplicate `const`s, missing imports, no `unmount()` on `consoleHost`). If demoing the swap becomes a habit, replace the comment block with a real CLI flag choosing between the two `Host`+`Renderer` pairs. Consider giving `Renderer` (or a shared lifecycle) an optional `close()`/`unmount()` so `index.ts` doesn't special-case Ink.

- [ ] **5. Visual polish**

  All cosmetic, all confined to `AppView`:
  - Color/dim the `⚙`/`✓` tool lines and the `> ` echoes so replies stand out.
  - Split multi-paragraph replies on newlines at push time (each `lines` entry is currently a whole reply block — works, since `<Text>` renders embedded `\n`s, but per-line entries compose better with `<Static>` and styling).
  - Markdown rendering of replies (e.g. `ink-markdown`) — only after the basics feel right.

- [ ] **6. Empty-submit noise**

  Submitting an empty input echoes a bare `> ` line into the log before the agent re-prompts. Either skip the echo for empty text in `submitInput`, or don't resolve at all on empty submit (keep waiting). Tiny; bundle with other polish.

- [ ] **7. Tests for the Ink layer**

  The console layer has no tests; the Ink layer could get them via `ink-testing-library` (new dev dependency): mount `AppView` / drive `InkApp.handle()` with synthetic `AgentEvent`s and assert on the rendered frames, plus the `requestInput()` promise-bridge behavior. Worth doing before the UI grows much — the imperative `rerender()` driver makes `InkApp` easy to drive synthetically.

  Do this refactor as part of the test work: `InkApp`'s constructor currently calls `render()`, i.e. constructing the object paints the terminal (claims stdout, patches `console`). The lifecycle itself is fine — the object *is* the live UI session, and two-phase `new` + `mount()` would be worse (nullable `ink` field, "constructed but not mounted" state everywhere). But name the side effect and create a test seam: make the constructor private and trivial, expose a static factory (`InkApp.mount()`) so the call site in `index.ts` announces the paint, and let the factory/constructor accept the render function (or Ink `Instance`) as a parameter so tests can inject `ink-testing-library`'s fake instead of real stdout.

## Someday / open questions

- **Hooks-driven state**: `InkApp`'s imperative mutate-then-`rerender()` driver was chosen as the minimal proof surface. If the UI grows real interactivity (scrolling, focus, multiple panes), consider inverting: state lives in the component (`useState`/`useReducer`), and `InkApp` shrinks to an event-forwarding shell. Don't do this preemptively — the imperative driver is simpler while the component stays a pure projection.
- **Richer event vocabulary**: a fancier UI may want events the loop doesn't emit yet (e.g. turn boundaries, tool progress). That's an `AgentEvent` design question, not an Ink one — extend the union deliberately, not per-widget.
