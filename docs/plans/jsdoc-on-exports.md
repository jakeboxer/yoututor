# JSDoc on exports

Planned 2026-07-26. A mechanical comment-style sweep — one sitting, no behavior change.

## Why

The TypeScript language service only surfaces `/** */` comments in hover tooltips and autocomplete; `//` comments (and plain `/* */` blocks) are invisible outside the defining file. Our port/type comments ("The model-call port. Injectable for tests…") are written exactly for the person importing the symbol elsewhere — today they only pay off after a go-to-definition.

## The rule

- **Exported symbols** get a `/** */` doc comment: the "what is this / how do I use it" summary a consumer would want in a tooltip. This is the whole existing comment when it documents the export's contract (most type comments qualify).
- **Everything else stays `//`**: interior implementation notes, rationale living *inside* function bodies, comments on non-exported helpers, and file-level narration. Implementation rationale that happens to sit above an export but isn't consumer-facing (e.g. "extracted from run() so the pure logic is unit-testable") can stay in the JSDoc — it's one comment, don't split it into two blocks.
- **No tag ceremony**: skip `@param`/`@returns` when the names and types already say it (the existing `InkApp.mount` JSDoc predates this rule; its tags can stay or go, not worth churn). Multi-line is fine — JSDoc renders line breaks and backticks in tooltips.

## Scope

Every exported symbol under `src/` whose doc comment is currently `//`-style. Find them with:

```sh
grep -rn --include="*.ts" --include="*.tsx" -B1 "^export " src/
```

Touch points (as of planning; re-grep at implementation time): `src/tools/` — `tool.ts`, `tool-result.ts`, `tool-result-with-display.ts`, `video.ts`, `timestamp.ts`, `load-video.ts`, `get-transcript-range.ts`, `get-frames.ts`, `thumbnail-art.ts`, `registry.ts`, `tail.ts`; `src/agent/` — `agent.ts`, `agent-event.ts`, `agent-error.ts`, `host.ts`, `tool-registry.ts`, `model-stream.ts`, `system-prompt.ts`; `src/console/` — the renderer/host ports and adapters (`ink-app.tsx` already has one JSDoc).

Conversion is comment-marker-only: don't reword while sweeping (a rewrite hides in a big mechanical diff). If a comment turns out to be pure implementation note with no consumer value, leaving it `//` is correct — the rule is about audience, not export keyword proximity.

## Also

- Add one line to CLAUDE.md's *TypeScript conventions* section recording the rule (JSDoc for exported symbols' summary; `//` for interior rationale; no redundant tags).

## Verify

1. `bun run typecheck`, `bun run lint`, `bun test` — should all be untouched by a comment-only diff.
2. Spot-check in the editor: hover `ModelStreamStarter` at its use site in `agent.ts` (post slice-3b) and `VideoStore` in a tool file — the summary should appear in the tooltip.
3. `git diff --stat` — every changed file should show near-balanced +/- line counts; anything lopsided means a comment got rewritten, not converted.
