import type Anthropic from "@anthropic-ai/sdk";

export type ToolResult = NonNullable<Anthropic.ToolResultBlockParam["content"]>;

// Flatten a tool result to display text for events.
// Image (and other non-text) blocks become [type] placeholders.
export function summarizeResult(result: ToolResult): string {
	if (typeof result === "string") return result;

	return result.map((block) => (block.type === "text" ? block.text : `[${block.type}]`)).join(" ");
}
