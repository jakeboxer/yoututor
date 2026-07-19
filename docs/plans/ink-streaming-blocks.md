# Stream replies block-by-block, rendered as markdown — guided walkthrough

## Context

Markdown rendering of replies (Ink follow-up #8, [ink-markdown-replies.md](ink-markdown-replies.md)) shipped with a deliberate compromise: the streaming `current` line shows raw markdown and only flips to styled ANSI when `modelResponded` moves the whole reply into `<Static>`. The pop-in of that flip is jarring.

Fix: stop displaying raw deltas at all. Buffer `textDelta` events and detect **completed blocks** (blank-line boundaries, fence-aware — the same splitting `renderReply` already does in `src/console/log-line-view.tsx`); as each block completes, render it as markdown and append it to the log immediately. While a block is mid-stream, the dynamic region shows only the spinner (decided: no dim raw partial text — zero pop-in, accepting that a one-paragraph reply shows nothing until it finishes).

**Why this is low-risk:** `renderReply` already renders each block *independently* (`split → renderMarkdown per block → join "\n\n"`). Streaming blocks one at a time therefore produces byte-identical final output — no new markdown correctness quirks. The already-accepted trade-offs (reference-style links across blocks don't resolve, blank-line runs collapse) are unchanged. The only new mechanics are incremental: deltas split mid-line, fence state carried across deltas, flushing the trailing block at `modelResponded`.

**Ground rule** (per established convention): **Jake types every line of code.** Claude explains what and why, reviews what was typed, and runs only checks (`bun run typecheck`, `bun run lint`, `bun test`). The only files Claude edits: this plan doc (creation + checkbox updates) and docs-only wrap-up edits.

## Design summary

- **New `BlockBuffer` class** (`src/console/block-buffer.ts`) — the incremental version of `renderReply`'s splitter, and its new single source of truth (the fence regex `/^\s*(```|~~~)/` and the `line.trim() === ""` blank test move here, not duplicated):
  - `push(delta: string): string[]` — append to an internal partial-line buffer; process only **complete** lines (terminated by `\n`) so fence/blank detection never runs on a half-arrived line. Toggle `inCodeFence` on fence lines; a blank line outside a fence closes the current block (emit if non-empty). Returns the blocks completed by this delta (usually `[]`).
  - `flush(): string | null` — join remaining block lines plus any trailing partial line; `null` if whitespace-only (preserves "whitespace-only reply appends nothing"). Caller discards the buffer afterward — fresh instance per reply, so fence state can't leak across replies.
- **`renderReply` delegates to `BlockBuffer`** (`push(fullText)` + `flush()` → render each block `{ wrap: false }`, trim, join `"\n\n"`). Behavior-identical; batch and incremental splitting can never diverge.
- **`InkApp`**: replace `private current = ""` with `private buffer = new BlockBuffer()`. `textDelta` → append each completed block as its own `reply` LogLine; `modelResponded` → flush, append if non-null, fresh buffer. New blocks get `gapAbove: true` when the previous line is also a `reply` — reproduces today's blank line between blocks without adding a gap after tool/echo lines (`exactOptionalPropertyTypes`: omit the prop, never assign `undefined`).
- **`LogLine`** gains optional `gapAbove?: true`; `LogLineView`'s reply case prepends `"\n"` when set — lightest mechanism, no `<Box>` needed.
- **`AppView`**: drop the `current` prop and its `<Text>`; spinner condition becomes just `!props.awaitingInput` ("Thinking..." now also covers active streaming — label polish out of scope).

Ink gotchas already handled by existing structure: appends go through `appendLine` (fresh array — `<Static>` memoizes on reference), and completed blocks are immutable once in `<Static>`, which is exactly what Static requires. `ConsoleRenderer` (bare `--console` path) is plain-text passthrough — untouched.

## Steps

### 1. Save this plan to the repo (Claude — the only execution step Claude performs)

- [x] Copy this plan to `docs/plans/ink-streaming-blocks.md`.

### 2. `BlockBuffer` (Jake writes, Claude guides)

- [ ] Create `src/console/block-buffer.ts` with the class per the design summary. Watch: only split on `\n`-terminated lines; keep the partial tail buffered across `push` calls; fence toggle uses the exact regex from `renderReply`.
- [ ] Conventions: kebab-case file, one thing per file, named or default export per house style, `.ts` import extensions.

### 3. `BlockBuffer` unit tests (Jake writes, Claude runs)

- [ ] Create `src/console/block-buffer.test.ts`: two blocks in one push; delta split mid-line (`"para"` then `" one\n\npara two"`) emits nothing early, then the right block; blank line **inside** a code fence doesn't split; fence marker itself split across deltas (` ``` ` arriving as ` `` ` + `` ` ``); flush returns the trailing partial block; flush of whitespace-only remainder returns `null`; runs of blank lines emit no empty blocks.
- [ ] `bun test src/console/block-buffer.test.ts` green before touching the UI.

### 4. `renderReply` delegates to `BlockBuffer` (Jake writes)

- [ ] Rewrite `renderReply` in `log-line-view.tsx` as `push` + `flush` over the full text; rendering (per-block `{ wrap: false }` + trim + `"\n\n"` join) unchanged.
- [ ] Add `gapAbove?: true` to `LogLine`; reply case prepends `"\n"` when set.
- [ ] Checkpoint: `bun test` — all existing tests must still pass (this step is pure refactor plus a dormant field).

### 5. `InkApp` streaming rewrite (Jake writes)

- [ ] Swap `current` for a `BlockBuffer`; `textDelta` appends completed blocks (computing `gapAbove` from the previous line's kind); `modelResponded` flushes and resets the buffer.
- [ ] `AppView`: remove the `current` prop/display; spinner shows whenever `!awaitingInput`.

### 6. Ink app tests (Jake edits, Claude runs)

- [ ] Replace `"textDelta event accumulates"` with: (a) *partial block is not displayed* — delta without a blank line: frame lacks the text, spinner still shows; (b) *completed block appears before modelResponded* — send `"para one\n\n"`, frame contains `para one` while still streaming. Add a gap test: two completed blocks render with a blank line between them.
- [ ] Existing tests (`moves the reply into the log`, `markdown renders without raw markers`, `blank line between paragraphs preserved`, `whitespace-only appends nothing`) should pass unchanged — they send full text then `modelResponded`, which the flush path reproduces.
- [ ] Mind the #7/#8 environment gotcha: assertions must hold both interactive and piped — no ANSI-code assertions. Run both ways (`| cat` and `script -q /dev/null bun test …`).

### 7. Static checks (Claude runs, read-only)

- [ ] `bun run typecheck` and `bun run lint`.

### 8. End-to-end verification (Jake drives)

- [ ] `bun src/index.ts <youtube url>` in **Ghostty** (not Warp — known Ink input lag); ask something likely to produce multiple paragraphs, a list, and a code fence.
- [ ] Check: blocks appear styled as they complete (raw markdown never visible); blank lines between blocks match the pre-change layout; spinner shows between blocks; long single paragraph = spinner until done (accepted trade-off); tool/echo lines and `<Static>` scrollback unchanged.

### 9. Wrap-up housekeeping (Claude, docs only)

- [ ] Check off boxes here, folding in deviations/lessons as italic notes (house style).
- [ ] Add an entry to [ink-followups.md](ink-followups.md) noting the #8 "streaming line stays plain" compromise is now resolved.

## Out of scope (deliberately)

- Showing the partial block (dim or otherwise) — decided against; spinner only.
- Spinner label polish (e.g. "Writing..." while streaming).
- Syntax highlighting in fences; markdown for the bare console renderer.
