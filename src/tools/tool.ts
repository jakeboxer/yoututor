import type Anthropic from "@anthropic-ai/sdk";
import type { ToolResult } from "./tool-result.ts";
import type { ToolResultWithDisplay } from "./tool-result-with-display.ts";

// One tool: the schema the model sees, paired with the handler we run when it's called.
// Co-locating them keeps "what the model sees" and "what we actually do" in a single object, so
// adding a capability is self-contained. The ToolRegistry is built from a list of these.
export type Tool = {
	// The schema advertised to the model (name, description, input JSON Schema).
	schema: Anthropic.Tool;
	// Execute the tool with the model-supplied input; return the result of the tool call (either
	// bare, or wrapped when there's also something to display to the human).
	run(input: unknown): Promise<ToolResult | ToolResultWithDisplay>;
};
