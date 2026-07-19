# Ink follow-up #5: visual polish — guided walkthrough

## Context

Follow-up #5 in [ink-followups.md](ink-followups.md): all output lines currently render identically, so tool lines (`⚙`/`✓`), `> ` input echoes, and replies blur together. This walkthrough styles the log so replies stand out, and bundles follow-up #6 (empty submit echoes a bare `> ` line) since we're touching the same code paths. Markdown rendering (bullet 3 of #5) is **deferred** — but the architecture below is chosen specifically so it stays a one-branch change later.

**The architectural decision — semantic store, presentational render:**

- `InkApp.lines` is currently `string[]`; to style by line type, entries become structured: `type LogLine = { kind: "reply" | "toolStart" | "toolDone" | "echo"; text: string }` (defined in `ink-app.tsx` — it's view-internal, not a port).
- One entry per semantic event, pushed **whole** — a full multi-paragraph reply is one entry. All display decisions (styling, any splitting) live in the `<Static>` render function in `AppView`, branching on `kind`.
- **Bullet 2 of #5 ("split multi-paragraph replies on newlines at push time") is deliberately superseded.** Markdown parsing needs the whole reply intact (code fences, lists, and paragraphs span lines); push-time shredding would destroy the block structure. Whole-reply entries render fine (`<Text>` handles embedded `\n`s), and markdown later means swapping only the `reply` branch of the render function — the full text is right there in `entry.text`.

Styling direction (chosen): non-reply lines dimmed, with light accents — e.g. cyan for `⚙` toolStart, green for `✓` toolDone, dim for echoes and the spinner/activity line; replies stay default. Exact values get tweaked live at the terminal during verification.

**Ground rule (established walkthrough convention):** Jake types every line of code. Claude explains what to write and why, reviews the result, and runs read-only checks (`bun run typecheck`, `bun run lint`). The only files Claude edits are this plan copy (creation and progress checkboxes) and, if Jake prefers, the docs-only wrap-up edits.

## Steps

### 1. Save this plan to the repo (Claude — the only execution step Claude performs)

- [x] Copy this plan to `docs/plans/ink-visual-polish.md` so progress gets checked off there as steps complete, alongside the other walkthrough docs.

### 2. Restructure the store — `InkApp` in `src/console/ink-app.tsx` (Jake writes)

- [ ] Define `type LogLine = { kind: "reply" | "toolStart" | "toolDone" | "echo"; text: string }` near the top of `ink-app.tsx`.
- [ ] Change `private lines: string[]` → `LogLine[]`, and `appendLine(line: string)` → `appendLine(line: LogLine)` (the immutable-append body is unchanged — the `<Static>` fresh-array requirement still applies).
- [ ] Update the four push sites to pass kinds:
  - `modelResponded` → `{ kind: "reply", text: trimmedCurrent }` (whole reply, no splitting)
  - `toolRunStarted` → `{ kind: "toolStart", text: ... }` (existing `⚙ name {input}` formatting kept)
  - `toolRunFinished` → `{ kind: "toolDone", text: ... }`
  - `submitInput` → `{ kind: "echo", text: \`> ${text}\` }`
- [ ] **Follow-up #6, same site:** in `submitInput`, early-return when the trimmed text is empty — *before* the echo and before resolving, so the prompt just stays active and keeps waiting. (Chosen over "resolve with empty text": no phantom `> ` line, no pointless agent round-trip, and no question of how the loop treats an empty turn.)

### 3. Style by kind — `AppView` in `src/console/ink-app.tsx` (Jake writes)

- [ ] `AppViewProps.lines` becomes `LogLine[]`.
- [ ] The `<Static>` child function branches on `line.kind` — a small `switch` (or a tiny render helper) returning a styled `<Text key={index}>` per kind:
  - `reply` → default styling, text as-is (this is the branch markdown will replace later)
  - `toolStart` → dim + cyan accent
  - `toolDone` → dim + green accent
  - `echo` → `dimColor`
- [ ] Dim the spinner/activity line in the dynamic region too.
- [ ] Note: `<Text>` composes — nested `<Text color="cyan">⚙</Text>` inside a dim line works if per-glyph accents look better than coloring the whole line. Decide by eye in step 5.

### 4. Static checks (Claude runs, read-only)

- [ ] `bun run typecheck`
- [ ] `bun run lint`

### 5. End-to-end verification (Ghostty, not Warp — Warp lags Ink input)

- [ ] Run `bun src/index.ts <some video url>`, have a short conversation with tool use. Check: tool lines and echoes visibly recede; replies stand out; a multi-paragraph reply renders with its blank lines intact inside `<Static>`.
- [ ] Tweak colors/dim live until it looks right.
- [ ] Empty submit: pressing Enter on an empty input does nothing — no `> ` line, prompt still active, typing still works.
- [ ] Regression pass: streaming still freezes into scrollback cleanly, `/exit` unmounts, Ctrl+C exits with 130, Ctrl+D at the prompt ends the session.

### 6. Wrap-up housekeeping

- [ ] Check off the boxes in this file.
- [ ] Mark #5 and #6 done in `ink-followups.md`, annotating #5: bullet 2 (push-time splitting) superseded by the store/render split for markdown-compat; bullet 3 (markdown) spun out as its own follow-up entry ("swap the `reply` branch of the render function; needs an Ink-7-compatible markdown component — check docs, `ink-markdown` is old").
- [ ] Claude updates the `ink-integration-walkthrough` memory with the new progress.

## Out of scope (deliberately)

- Markdown rendering — deferred as its own follow-up; this walkthrough's job is to make it cheap, not do it.
- Everything else in `ink-followups.md` (tests, hooks-driven state).
