# Ink follow-up #8: Markdown rendering of replies — guided walkthrough

## Context

Follow-up #8 in [ink-followups.md](ink-followups.md) (deferred from #5): model replies land in the log as plain text; headings, lists, and code fences the model emits render as raw markdown syntax. #5's **semantic store, presentational render** split was designed for exactly this moment — replies are pushed *whole* into `InkApp.lines` with block structure intact, so the entire change is the `reply` branch of `LogLineView` (`src/console/log-line-view.tsx`). The streaming `current` line stays plain text (rendering half-streamed markdown is janky — [ink-followups.md](ink-followups.md) calls this out).

**Library choice: `markdansi` (0.3.2, published 2026-07)** — chosen after research. Rationale:

- The two Ink component packages (`ink-markdown`, `@inkkit/ink-markdown`) are unmaintained since 2023, built on marked 9 / marked-terminal 6, never vetted on Ink 7 + React 19 — real reconciler-breakage risk.
- `markdansi` is a **pure string transform** (markdown in → ANSI string out), so it has zero Ink coupling: the ANSI string goes inside the existing `<Text>`. Built specifically for LLM output in terminals; it's the engine under assistant-ui's own Ink markdown component. Dependency-light (no cli-table3/cli-highlight/node-emoji baggage), tracks current marked (18). Caveat accepted: pre-1.0.
- Runner-up `marked` + `marked-terminal` (7.3.0, Jan 2025) is the conservative fallback if markdansi disappoints — same string-into-`<Text>` shape, so swapping later is cheap.

**Known hazard to resolve during the walkthrough: double wrapping.** markdansi hard-wraps at a width by default; Ink's `<Text>` also wraps (via wrap-ansi, ANSI-safe). Two wrappers fight — expected resolution is disabling markdansi's wrap (`wrap: false`-style option) and letting Ink own layout, but verify against markdansi's actual options type in step 3.

**Ground rule** (per established convention): **Jake types every line of code.** Claude explains what and why, reviews what was typed, and runs only checks (`bun run typecheck`, `bun run lint`, `bun test`). The only files Claude edits: this plan doc (creation + checkbox updates) and docs-only wrap-up edits.

## Steps

### 1. Save this plan to the repo (Claude — the only execution step Claude performs)

- [x] Copy this plan to `docs/plans/ink-markdown-replies.md`.

### 2. Install markdansi (Jake runs)

- [ ] `bun add markdansi` (Bun project — never npm).

### 3. Read markdansi's actual API before writing code (Claude guides)

- [ ] Inspect the installed package's types/README (`node_modules/markdansi`) for: the `render(md, options?)` signature, the wrap/width option, theme options, and what it does with trailing newlines.
- [ ] Decide the options object: disable markdansi's own wrapping so Ink's `<Text>` owns layout (confirm the exact option name from the types, don't guess).

### 4. Swap the `reply` branch (Jake writes)

- [ ] In `src/console/log-line-view.tsx`: import `render` from `markdansi` (rename to something like `renderMarkdown` for clarity) and change only the `reply` case:
  ```tsx
  case "reply":
  	return <Text>{renderMarkdown(props.line.text, /* options from step 3 */)}</Text>;
  ```
- [ ] Watch the project conventions: the `.ts`/`.tsx` extension rule doesn't apply to package imports; `verbatimModuleSyntax` means any type-only import from markdansi uses `import type`.
- [ ] Consider trimming the rendered output (markdown renderers often append a trailing newline) — replies are already `.trim()`ed pre-push in `ink-app.tsx`, but the *rendered* string may regrow one.
- [ ] `toolStart`/`toolDone`/`echo` branches and the streaming `current` line in `AppView` are untouched.

### 5. Static checks (Claude runs, read-only)

- [ ] `bun run typecheck` and `bun run lint`.

### 6. Tests — the environment-dependent frame gotcha (Jake edits, Claude runs)

The #7 lesson applies: chalk (inside markdansi) sniffs the **real** stdout, so interactive runs get ANSI-styled frames while piped/CI runs get plain text.

- [ ] Run `bun test src/console/ink-app.test.ts` **both ways**: interactive and `| cat`.
- [ ] The sensitive assertion is `"modelResponded event moves the reply into the log"` (`ink-app.test.ts`) — it splits the frame on `\n` and expects an element exactly equal to `"answer"`. A plain one-word paragraph likely survives markdansi unchanged, but if styling/reflow alters it, loosen the assertion to something true in both worlds (the #7 pattern).
- [ ] Optionally add one test: a reply containing markdown (e.g. `**bold** item`) renders without raw `**` markers — asserted in a way that holds both interactive and piped (e.g. assert the raw markers are *absent* rather than asserting specific ANSI codes).

### 7. End-to-end verification (Jake drives)

- [ ] `bun src/index.ts <youtube url>` in **Ghostty** (not Warp — known Ink input lag), ask a question likely to produce a list or code fence.
- [ ] Check: reply renders styled markdown; streaming text stays plain until `modelResponded` flips it into the log; `<Static>` scrollback still behaves (no full-screen rewrites); tool lines / echo lines unchanged.

### 8. Wrap-up housekeeping (Claude, docs only)

- [ ] Check off completed boxes here, folding in any deviations/lessons as italic notes (house style).
- [ ] Mark #8 done in [ink-followups.md](ink-followups.md) with a summary paragraph matching entries #1–#7.
- [ ] Update the walkthrough memory file to point at whatever's next.

## Out of scope (deliberately)

- Markdown for the streaming `current` line (explicitly excluded by #8).
- Syntax highlighting inside code fences (markdansi ships none by default; pluggable hook exists if ever wanted).
- Per-line splitting of replies at render time (recorded in #5 as a render-time concern, still unneeded).
