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

- [x] `bun add markdansi` (Bun project — never npm). *Got 0.3.2, matching the plan.*

### 3. Read markdansi's actual API before writing code (Claude guides)

- [x] Inspect the installed package's types/README (`node_modules/markdansi`) for: the `render(md, options?)` signature, the wrap/width option, theme options, and what it does with trailing newlines.
- [x] Decide the options object: disable markdansi's own wrapping so Ink's `<Text>` owns layout (confirm the exact option name from the types, don't guess).

*Findings: signature is `render(markdown, options?): string` as hoped; the option is literally `wrap?: boolean` (default true), and `{ wrap: false }` leaves width `undefined` — no markdansi line-breaking at all. Output always ends with `\n`, and heading-first output gains a leading `\n` too, so trim both ends. The environment sniffing is markdansi's own, not chalk's: `color` defaults to `process.stdout.isTTY` — same interactive-vs-piped consequence as #7, different mechanism.*

### 4. Swap the `reply` branch (Jake writes)

- [x] In `src/console/log-line-view.tsx`: import `render` from `markdansi` (renamed `renderMarkdown`) and change only the `reply` case.
- [x] Watch the project conventions: the `.ts`/`.tsx` extension rule doesn't apply to package imports; `verbatimModuleSyntax` means any type-only import from markdansi uses `import type`. *(Neither bit — only the value import was needed; the options literal is inferred.)*
- [x] Consider trimming the rendered output — yes, `.trim()`: the trailing `\n` is guaranteed and heading-first output grows a leading one.
- [x] `toolStart`/`toolDone`/`echo` branches and the streaming `current` line in `AppView` are untouched.

*Deviation found at step 7: the straight one-liner (`renderMarkdown(props.line.text, { wrap: false }).trim()`) **lost blank lines between paragraphs**. markdansi deliberately renders blocks compactly — `renderChildren` concatenates block output with no separator and `RenderOptions` has no spacing knob — so the reply's paragraph structure is destroyed inside the renderer, unrecoverable by post-processing. Fix that shipped: a private `renderReply` helper in `log-line-view.tsx` splits the reply into blank-line-separated blocks (fence-aware — a ```` ``` ````/`~~~` toggle so blank lines inside code fences don't split), renders each block with `{ wrap: false }`, trims, and rejoins with `\n\n`. Accepted trade-offs, both fine for LLM replies: reference-style link definitions in a different block won't resolve; runs of blank lines collapse to one gap (standard markdown behavior anyway). Bonus: rendering a fence as its own block re-enabled markdansi's code box, which whole-string rendering (no width) had been silently skipping.*

### 5. Static checks (Claude runs, read-only)

- [x] `bun run typecheck` and `bun run lint`. *Clean on both the one-liner and the later `renderReply` version.*

### 6. Tests — the environment-dependent frame gotcha (Jake edits, Claude runs)

The #7 lesson applies — via markdansi's own stdout sniffing rather than chalk (see step 3 findings): interactive runs get ANSI-styled frames while piped/CI runs get plain text.

- [x] Run `bun test src/console/ink-app.test.ts` **both ways**: interactive and `| cat`. *(Piped run plus `script -q /dev/null bun test …` for the TTY flavor.)*
- [x] The sensitive assertion `"modelResponded event moves the reply into the log"` survived **unchanged** in both modes: a plain one-word paragraph gets no styling from the default theme even with color on, and `.trim()` restores the exact string.
- [x] Added two tests, both asserted in ways true in both worlds: `"reply markdown renders without raw markers"` (`**bold** item` → frame contains `bold`, not `**` — markers *absent*, no ANSI-code assertions) and `"blank line between reply paragraphs is preserved"` (`para one\n\npara two` survives verbatim — plain paragraphs are unstyled in either mode, so exact-substring holds).

### 7. End-to-end verification (Jake drives)

- [x] `bun src/index.ts <youtube url>` in **Ghostty** (not Warp — known Ink input lag), ask a question likely to produce a list or code fence.
- [x] Check: reply renders styled markdown; streaming text stays plain until `modelResponded` flips it into the log; `<Static>` scrollback still behaves (no full-screen rewrites); tool lines / echo lines unchanged. *This pass caught the blank-line loss (fix folded into step 4 above); second pass confirmed paragraph gaps preserved and the boxed code fences look good (`codeBox: false` is the off switch if that ever changes).*

### 8. Wrap-up housekeeping (Claude, docs only)

- [x] Check off completed boxes here, folding in any deviations/lessons as italic notes (house style).
- [x] Mark #8 done in [ink-followups.md](ink-followups.md) with a summary paragraph matching entries #1–#7.
- [x] Update the walkthrough memory file to point at whatever's next.

## Out of scope (deliberately)

- Markdown for the streaming `current` line (explicitly excluded by #8).
- Syntax highlighting inside code fences (markdansi ships none by default; pluggable hook exists if ever wanted).
- Per-line splitting of replies at render time (recorded in #5 as a render-time concern, still unneeded).
