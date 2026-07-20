import type { ToolResult } from "./tool-result.ts";

// A tool's result plus an optional display-only artifact (e.g. ASCII thumbnail art) for the
// renderer to print verbatim. `display` is NEVER sent to the model; it exists so a tool can show
// the human something without spending tokens on it.
export type ToolResultWithDisplay = { result: ToolResult; display?: string };

// Accept either a bare result or the full wrapper, so tools with nothing to display keep returning
// plain results. A ToolResult is a string or a content-block array, so the check covers all
// possibilties.
export function normalizeResult(value: ToolResult | ToolResultWithDisplay): ToolResultWithDisplay {
	if (typeof value === "string" || Array.isArray(value)) return { result: value };

	return value;
}
