# Ink follow-up #1: `<Static>` for scrollback — guided walkthrough

## Context

The minimal Ink integration (completed 2026-07-18) renders everything — completed log lines, the streaming reply, and the input field — inside Ink's dynamic region. Ink redraws that region by erasing and rewriting its lines on every render, and it is capped at the terminal height: in a long session, earlier lines get clipped instead of scrolling into terminal history. This is follow-up #1 in [ink-followups.md](ink-followups.md), called out there as "the one real correctness gap."

The fix is the standard Ink pattern for log-style apps: move completed entries (`lines`) into Ink's `<Static>` component, which renders each item exactly once, permanently, **above** the dynamic region — so they flow into normal terminal scrollback. Only the in-progress `current` text and the input prompt stay dynamic. The change touches only `AppView` in `src/console/ink-app.tsx`.

**Ground rule (per established walkthrough convention):** Jake types every line of code. Claude explains what to write and why, reviews the result, and runs read-only checks (`bun run typecheck`, `bun run lint`). Claude writes no source code — the only file Claude edits is this plan copy (creation and progress checkboxes).

Verified against current Ink docs (Context7, `/vadimdemedes/ink`): `<Static items={T[]}>{(item, index) => ReactNode}</Static>`, children must return an element with a `key`, optional `style` prop on the container.

## Steps

### 1. Save this plan to the repo (Claude — the only execution step Claude performs)

- [x] Copy this plan to `docs/plans/ink-static-scrollback.md` so it sits alongside `ink-minimal-integration.md` and `ink-followups.md` as project history. Progress gets checked off there as steps complete.

### 2. See the bug (optional but recommended, ~2 min)

- [ ] Shrink the terminal window to something short (~10 rows), run `bun src/index.ts <some video url>`, and have a conversation long enough to overflow the window. Watch earlier lines get clipped/overwritten instead of scrolling into history. Knowing exactly what broken looks like makes the fix verifiable.
- Note: use Ghostty, not Warp — Ink input is laggy in Warp and that would muddy the observation.

### 3. Understand `<Static>` before touching code

Key semantics to have in mind (discuss before editing):
- `<Static items={...}>` renders each item in `items` **once**, permanently, above all dynamic output. Once printed, an item can never be updated or removed — it's real terminal output now, not a managed region.
- Internally it tracks how many items it has already rendered and only paints the new tail on each render. This is why it must be an **append-only** array — which `InkApp.lines` already is (entries are pushed complete: trimmed replies, `⚙`/`✓` tool lines, `> ` echoes).
- Children is a **render function** `(item, index) => element`, not pre-mapped children — different shape from the current `lines.map(...)`.
- The rendered element needs a `key`; `key={index}` is the documented pattern here (fine for append-only, same reasoning as the existing biome-ignore comment).

### 4. Edit `AppView` in `src/console/ink-app.tsx` (Jake writes)

- [ ] Import `Static` from `ink`.
- [ ] Replace the `props.lines.map(...)` block inside the dynamic `<Box>` with a `<Static items={props.lines}>` whose child function renders each line as a `<Text key={index}>`.
- [ ] Place `<Static>` **before** (as a sibling of) the dynamic `<Box flexDirection="column">`, wrapping both in a fragment (`<>...</>`), so the component reads top-to-bottom the way the terminal does: permanent log first, then the live region (`current` + input prompt).
- [ ] Keep/move the `biome-ignore lint/suspicious/noArrayIndexKey` comment onto the new key usage if Biome still flags it.

What deliberately does **not** change:
- `InkApp` (the class) — `lines` is already append-only, and every mutation is followed by an unconditional `rerender()` with a fresh element tree, so `<Static>` sees the grown array and paints just the new entries. Mutating the same array reference is fine for exactly that reason (worth talking through — it's the subtle part).
- `current` handling — the streaming line stays dynamic until `modelResponded` pushes its trimmed form into `lines`, at which point it becomes permanent. That handoff already exists; `<Static>` just changes where pushed lines live.

### 5. Static checks (Claude runs, read-only)

- [ ] `bun run typecheck`
- [ ] `bun run lint`

### 6. End-to-end verification

- [ ] Re-run the step-2 experiment: short terminal, long conversation. Completed replies, tool lines, and `> ` echoes should now scroll up into terminal history (scrollable after the session), while only the streaming line and the input prompt occupy the bottom dynamic region.
- [ ] Confirm streaming still looks right: the in-progress reply updates in place, then "freezes" into scrollback when complete, with no duplicate or dropped lines.
- [ ] Confirm `/exit` still unmounts cleanly.

### 7. Wrap-up housekeeping

- [ ] Check off the boxes in this file.
- [ ] Jake marks follow-up #1 as done in `docs/plans/ink-followups.md` (his edit, or Claude's if he prefers — it's a docs file, not source).
- [ ] Claude updates the `ink-integration-walkthrough` memory with the new progress.

## Out of scope (deliberately)

- Splitting multi-paragraph replies into per-line `lines` entries (follow-up #5 notes per-line entries compose better with `<Static>`). Whole-reply entries render fine inside `<Static>` — embedded `\n`s still work — so this stays bundled with the styling polish.
- Everything else in `ink-followups.md` (Ctrl+D, spinner, `--console` flag, tests).
