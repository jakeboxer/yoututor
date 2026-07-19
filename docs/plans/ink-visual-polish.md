# Ink follow-up #5: visual polish — guided walkthrough

## Context

Follow-up #5 in [ink-followups.md](ink-followups.md): all output lines currently render identically, so tool lines (`⚙`/`✓`), `> ` input echoes, and replies blur together. This walkthrough styles the log so replies stand out, and bundles follow-up #6 (empty submit echoes a bare `> ` line) since we're touching the same code paths. Markdown rendering (bullet 3 of #5) is **deferred** — but the architecture below is chosen specifically so it stays a one-branch change later.

**The architectural decision — semantic store, presentational render:**

- `InkApp.lines` is currently `string[]`; to style by line type, entries become structured: `type LogLine = { kind: "reply" | "toolStart" | "toolDone" | "echo"; text: string }` (view-internal, not a port; ended up in `src/console/log-line-view.tsx` alongside the component that consumes it — see step 3).
- One entry per semantic event, pushed **whole** — a full multi-paragraph reply is one entry. All display decisions (styling, any splitting) live in the `<Static>` render function in `AppView`, branching on `kind`.
- **Bullet 2 of #5 ("split multi-paragraph replies on newlines at push time") is deliberately superseded.** Markdown parsing needs the whole reply intact (code fences, lists, and paragraphs span lines); push-time shredding would destroy the block structure. Whole-reply entries render fine (`<Text>` handles embedded `\n`s), and markdown later means swapping only the `reply` branch of the render function — the full text is right there in `entry.text`.

Styling direction (final, after live tweaking in step 5): tool lines get full-strength color — yellow for `⚙` toolStart, green for `✓` toolDone — while echoes and the spinner/activity line are dimmed; replies stay default. (The original sketch had the tool lines dimmed too, with a cyan accent; at the terminal, undimmed color read better for them.)

**Ground rule (established walkthrough convention):** Jake types every line of code. Claude explains what to write and why, reviews the result, and runs read-only checks (`bun run typecheck`, `bun run lint`). The only files Claude edits are this plan copy (creation and progress checkboxes) and, if Jake prefers, the docs-only wrap-up edits.

## Steps

### 1. Save this plan to the repo (Claude — the only execution step Claude performs)

- [x] Copy this plan to `docs/plans/ink-visual-polish.md` so progress gets checked off there as steps complete, alongside the other walkthrough docs.

### 2. Restructure the store — `InkApp` in `src/console/ink-app.tsx` (Jake writes)

- [x] Define `type LogLine = { kind: "reply" | "toolStart" | "toolDone" | "echo"; text: string }`. *(First drafted in `ink-app.tsx`; moved to `log-line-view.tsx` in step 3 when the component got its own file — the type lives with its consumer, keeping the import one-way: `ink-app.tsx` pulls both component and type from there, no cycle.)*
- [x] Change `private lines: string[]` → `LogLine[]`, and `appendLine(line: string)` → `appendLine(line: LogLine)` (the immutable-append body is unchanged — the `<Static>` fresh-array requirement still applies).
- [x] Update the four push sites to pass kinds:
  - `modelResponded` → `{ kind: "reply", text: trimmedCurrent }` (whole reply, no splitting)
  - `toolRunStarted` → `{ kind: "toolStart", text: ... }` (existing `⚙ name {input}` formatting kept)
  - `toolRunFinished` → `{ kind: "toolDone", text: ... }`
  - `submitInput` → `{ kind: "echo", text: \`> ${text}\` }`
- [x] **Follow-up #6, same site:** in `submitInput`, early-return when the trimmed text is empty — *before* the echo and before resolving, so the prompt just stays active and keeps waiting. (Chosen over "resolve with empty text": no phantom `> ` line, no pointless agent round-trip, and no question of how the loop treats an empty turn.)

### 3. Style by kind — `AppView` in `src/console/ink-app.tsx` (Jake writes)

- [x] `AppViewProps.lines` becomes `LogLine[]`.
- [x] The `<Static>` child renders a dedicated component (Jake's call, upgraded from the planned render-helper): `LogLineView` in `src/console/log-line-view.tsx` (default export, per repo convention), props just `{ line: LogLine }`, body a `switch` on `line.kind` returning a styled `<Text>` per case:
  - `reply` → default styling, text as-is (this is the branch markdown will replace later)
  - `toolStart` → `color="yellow"`
  - `toolDone` → `color="green"`
  - `echo` → `dimColor`

  A component beats a helper here: the `key` lands naturally at the call site (`<LogLineView key={index} line={line} />`), it can grow hooks if the markdown branch ever needs them, and it's a named seam. Lesson that came up: `key` identifies *siblings in the array `<Static>` builds*, so it belongs on the mapped element — a `key` on the lone `<Text>` inside the component is silently ignored (and types can't catch it; the first draft had `index` as a prop for exactly this misplacement).
- [x] Dim the spinner/activity line: `dimColor` on the outer `<Text>` in `AppView` (nested `<Text>` styles compose, so it covers the glyph too). `Spinner` itself stays style-agnostic — presentation is the caller's decision, same philosophy as keys living at the call site.
- [x] Per-glyph accents (nested `<Text>` spans) considered and skipped — whole-line coloring looked right by eye.

### 4. Static checks (Claude runs, read-only)

- [x] `bun run typecheck`
- [x] `bun run lint` *(Surfaced an unrelated pre-existing gap: Biome was checking `.claude/settings.local.json` — the file is gitignored, but via the **global** gitignore, which Biome's `vcs.useIgnoreFile` doesn't read. Fixed in `biome.json` with `files.includes: ["**", "!.claude"]` rather than reformatting a machine-managed file.)*

### 5. End-to-end verification (Ghostty, not Warp — Warp lags Ink input)

- [x] Run `bun src/index.ts <some video url>`, have a short conversation with tool use. Check: tool lines and echoes visibly recede; replies stand out; a multi-paragraph reply renders with its blank lines intact inside `<Static>`.
- [x] Tweak colors/dim live until it looks right. *(Landed on undimmed yellow/green for the tool lines — the dim+cyan sketch receded too far; echoes and spinner stay dim, whole-line coloring, no per-glyph spans.)*
- [x] Empty submit: pressing Enter on an empty input does nothing — no `> ` line, prompt still active, typing still works.
- [x] Regression pass: streaming still freezes into scrollback cleanly, `/exit` unmounts, Ctrl+C exits with 130, Ctrl+D at the prompt ends the session.

### 6. Wrap-up housekeeping

- [x] Check off the boxes in this file.
- [x] Mark #5 and #6 done in `ink-followups.md`, annotating #5: bullet 2 (push-time splitting) superseded by the store/render split for markdown-compat; bullet 3 (markdown) spun out as its own follow-up entry ("swap the `reply` branch of `LogLineView`; needs an Ink-7-compatible markdown component — check docs, `ink-markdown` is old").
- [x] Claude updates the `ink-integration-walkthrough` memory with the new progress.

## Addendum: trailing spinner frame on exit (fixed same day)

After wrap-up, one more quirk: `/exit` and Ctrl+D left a fossilized `⠋ Thinking...` line in the terminal. Cause: `InkApp` can't know the session is ending — `/exit` is agent-loop knowledge (`agent.ts`), and EOF resolution is followed by a wind-down the UI doesn't see — so the frame painted after the final input resolves legitimately shows the spinner (`!awaitingInput && current === ""`), and Ink's `unmount()` leaves the last frame in place. Fix at the one seam where "done" is knowable: `InkApp.unmount()` now calls `this.ink.clear()` (Ink 7 Instance API, verified via Context7) before `this.ink.unmount()` — it erases only the dynamic region, and at wind-down that region contains exactly the junk (spinner line; `current` is empty, prompt gone). `<Static>` output is real scrollback and untouched.

Deliberate choice: `interrupt()` (Ctrl+C) shares the teardown, so it inherits the clear — a dangling `> ` prompt is wiped, and a *partially streamed* reply now vanishes on mid-stream Ctrl+C instead of lingering (it never reached `lines`). Chosen on purpose: leftover partial text reads as a complete reply, and one uniform teardown path beats two.

## Out of scope (deliberately)

- Markdown rendering — deferred as its own follow-up; this walkthrough's job is to make it cheap, not do it.
- Everything else in `ink-followups.md` (tests, hooks-driven state).
