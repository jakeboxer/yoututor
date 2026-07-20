import type Anthropic from "@anthropic-ai/sdk";
import type { ToolResultWithDisplay } from "../tools/tool-result-with-display.ts";

export type ToolRegistry = {
	// Schemas sent to the model on every request.
	schemas: Anthropic.Tool[];
	// Run the named tool with the model-supplied input. The result is handed back to the model; the
	// optional display artifact goes only to the renderer.
	run(name: string, input: unknown): Promise<ToolResultWithDisplay>;
};
