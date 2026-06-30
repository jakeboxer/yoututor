import type Anthropic from "@anthropic-ai/sdk";
import type { ToolResult } from "../tools/tool.ts";

export type ToolRegistry = {
	// Schemas sent to the model on every request.
	schemas: Anthropic.Tool[];
	// Run the named tool with the model-supplied input; return the result handed back to the model.
	run(name: string, input: unknown): Promise<ToolResult>;
};
