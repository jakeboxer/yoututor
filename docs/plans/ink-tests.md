# Ink follow-up #7: Tests for the Ink layer — guided walkthrough

## Context

Item 7 of [ink-followups.md](ink-followups.md): the console layer has no tests. The Ink layer gets them via **ink-testing-library** (new dev dependency), plus the seam refactor the bullet prescribes: `InkApp`'s constructor currently calls Ink's `render()` — constructing the object paints the terminal. The fix is a static `InkApp.mount()` factory whose parameter is the render function, so `index.ts` announces the paint and tests inject ink-testing-library's fake instead of real stdout.

**Ground rule (established walkthrough convention):** Jake types every line of code; Claude explains what to write and why, reviews, and runs read-only checks (`bun run typecheck`, `bun run lint`, `bun test`). The only files Claude edits are this doc (creation + progress checkboxes) and docs-only wrap-up edits.

### Research findings that shape the design (verified up front)

- **ink-testing-library@4.0.0 is compatible with Ink 7 by construction**: it has no peer dep on `ink` — it imports `render` from the host project's `ink` (7.1.1 here) and passes fake `Stdout`/`Stdin` streams with `debug: true, exitOnCtrlC: false, patchConsole: false`. All options it passes exist in Ink 7. Smoke-test early anyway (step 4's first test) since its own dev deps pin Ink 5.
- **`debug: true` is why frame assertions work**: in debug mode Ink writes the *entire* output (Static region included) on every frame — `lastFrame()` shows everything, no ANSI cursor gymnastics. But **color/dim ANSI codes are still in the frames** → assert with `toContain` on plain substrings, not exact equality.
- **Its instance has no `clear()`**: it returns `{ rerender, unmount, cleanup, stdout, stdin, frames, lastFrame }`. `InkApp.unmount()` calls `this.ink.clear()` — so the seam type must be minimal (`rerender`/`clear`/`unmount`), and the test helper wraps the library instance with a no-op `clear`.
- **Existing test conventions** (`src/tools/*.test.ts`): co-located `<name>.test.ts`, `import { expect, test } from "bun:test"`, plain `test()` (no `describe`), hand-rolled fakes via local factory functions, no mocking library.

## Steps

### 1. Claude saves this plan to the repo (Claude — the only execution step)

- [x] Write this document to `docs/plans/ink-tests.md`.

### 2. Add the dev dependency (Jake)

- [x] `bun add -d ink-testing-library` (expect 4.0.0).

### 3. Seam refactor in `src/console/ink-app.tsx` (Jake, guided)

- [x] Define a minimal seam type — what `InkApp` actually uses of Ink's `Instance`:
  ```ts
  type InkInstance = Pick<Instance, "rerender" | "clear" | "unmount">;
  type InkRender = (tree: ReactElement) => InkInstance;
  ```
- [x] Make the constructor `private`, taking the render function: `private constructor(renderFn: InkRender) { this.ink = renderFn(this.buildView()); }`. (The render must stay in the constructor — `buildView()` needs `this`, and a two-phase `new` + assign would make `ink` nullable everywhere. The point isn't moving the side effect, it's *naming* it and making the renderer injectable.)
- [x] Add the factory: `static mount(renderFn: InkRender = defaultRender): InkApp`. *(The default landed as a named module-level const `defaultRender` above the class rather than an inline arrow in the signature — gives the migrated `exitOnCtrlC` rationale comment a home next to the code it explains. camelCase, not `DEFAULT_RENDER`: SCREAMING_SNAKE marks constant data like `THINKING_LABEL`; callables stay camelCase even as `const`s.)*
- [x] Update the one call site in `src/index.ts`: `new InkApp()` → `InkApp.mount()`.
- [x] Verify: `bun run typecheck`, `bun run lint`, quick manual run (`bun src/index.ts`, `/exit`).

### 4. Test helper + first tests — `src/console/ink-app.test.ts` (Jake, guided)

- [x] Co-located, follows the tools-tests style. No JSX in the test file (InkApp builds its own tree), so `.ts` not `.tsx`; import `ink-app.tsx` with its extension.
- [x] Hand-rolled helper in the local-factory style:
  ```ts
  function mountForTest() {
    let instance!: ReturnType<typeof render>;   // ink-testing-library's render
    const app = InkApp.mount((tree) => {
      instance = render(tree);
      return { rerender: instance.rerender, unmount: instance.unmount, clear: () => {} };
    });
    return { app, instance };
  }
  ```
- [x] `afterEach(cleanup)` (from ink-testing-library) so the Spinner's interval never outlives a test.
- [x] First tests (also the Ink-7 compat smoke test):
  - mount → `lastFrame()` shows the spinner line with `Thinking...` (busy, nothing streaming). *(Passed on first run — ink-testing-library@4 confirmed working against Ink 7.)*
  - two `textDelta` events → frame contains the concatenated text.
  - `modelResponded` → reply lands in the Static region (still in `lastFrame()` thanks to debug mode), streaming line gone; whitespace-only current appends nothing. *(Jake's improvement over the sketch: assert the trim via `lastFrame.split("\n")` + array-`toContain` — exact line equality, which distinguishes `"answer"` from `"  answer  "` where a substring match can't. Works because the reply branch is unstyled `<Text>` — no ANSI on that line. The whitespace-only case asserts `lastFrame()` is byte-identical (`toBe`) to the pre-event frame — valid because `handle()` is fully synchronous, so not even the spinner's frame char has ticked. Typecheck note: Ink 7's `Instance.rerender` takes `ReactNode`, the library's takes `ReactElement`; the `Pick`-based seam absorbs this because method-declared types get bivariant parameter checking.)*

### 5. Tool-event tests (Jake, guided)

- [x] `toolRunStarted` → frame contains `⚙ <name> <json input>` and activity flips to `Running <name>`.
- [x] `toolRunFinished` → frame contains `✓ <name>`, activity back to `Thinking...`. *(Lesson that came up: the first draft fired `toolRunFinished` without a preceding `toolRunStarted`, so the `Thinking...` assertion passed trivially — the label had never left. A restore-assertion only bites if the state actually flipped first; fixed by firing the start event, plus `not.toContain("Running get_frames")` to pin the transition from both sides.)*
- [x] Remember: substring assertions (`toContain`) — the lines carry color codes.

### 6. Promise-bridge tests (Jake, guided)

The interesting half: `requestInput()` is driven end-to-end through the fake stdin, exercising `AppView` + TextInput + the resolver stash together.

- [x] A tiny `tick()` helper (`await new Promise(r => setTimeout(r, 0))`, bump the delay only if flaky) — stdin writes go through Ink's input parser → React state → rerender, which isn't synchronous. *(0ms sufficed throughout; no flakiness.)*
- [x] `requestInput()` → frame shows the prompt. Assert *pending* with a flag: `let resolved = false; p.then(() => { resolved = true; })`, tick, expect false — never await the promise itself.
- [x] `instance.stdin.write("hi")` then `stdin.write("\r")` (Enter triggers TextInput's onSubmit) → promise resolves `"hi"`, echo line `> hi` in the frame, prompt gone.
- [x] Empty submit: `stdin.write("\r")` alone → still pending, no echo line (asserted by counting lines containing the prompt — exactly 1 — since a substring check can't tell the live prompt from an echo).
- [x] Ctrl+D: `stdin.write("\x04")` (Ink parses it as ctrl+`d`) while awaiting → resolves `null`. When *not* awaiting → nothing happens (byte-identical-frame assertion, same trick as the whitespace-reply test).

**Gotcha found here — frames are environment-dependent, and CI is the environment that counts.** Chalk decides color support by sniffing the real `process.stdout` at load time, not the injected fake stream. In an interactive terminal, tests see styled frames: TextInput's cursor is an ANSI-inverse space after `"> "`, so `toContain("> ")` passed. Through a pipe (CI, hooks, agent runs), chalk degrades to plain text, the cursor becomes a bare trailing space, Ink strips it, and the prompt line is just `">"` — two tests green for Jake, red for Claude. Fix: assert on `">"` (true in both worlds) rather than forcing `FORCE_COLOR=0` in the test script (heavier, touches all tests). Corollary: **no ANSI codes exist in non-TTY test frames at all** — the "styled lines need substring assertions" caveat from the research notes only applies to interactive runs; plan-stage warnings about ANSI in frames were half-right. Verify both ways: `bun test <file>` and `bun test <file> | cat`.

### 7. Full verification pass (Jake runs, Claude checks output)

- [x] `bun test` (whole suite: 66 pass across 7 files), `bun run typecheck`, `bun run lint` all green. *(The manual session was covered by step 3's verify — no production code changed after it, only the test file and docs, so a re-run would have exercised nothing new.)*

### 8. Wrap-up (Claude, docs-only)

- [x] Check off item 7 in `ink-followups.md` with a `*(done DATE)*` summary paragraph; record findings/gotchas here as inline parentheticals per convention; update the walkthrough memory.

## Out of scope (deliberately)

- **Ctrl+C / `interrupt()`**: calls `process.exit(130)` — testing it means injecting an exit function, more seam than it's worth right now. Noted as a future seam if ever needed.
- **`Spinner` unit tests**: timer-driven animation; its correctness is visual. It's mounted (and cleaned up) in the InkApp tests, which is enough.
- **`AppView`-only tests**: driving through `InkApp` covers the component; separate component tests would duplicate.
- **Console (`consoleHost`/`ConsoleRenderer`) tests**: item 7 is scoped to the Ink layer.
