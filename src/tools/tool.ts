import type Anthropic from "@anthropic-ai/sdk";

// One tool: the schema the model sees, paired with the handler we run when it's called.
// Co-locating them keeps "what the model sees" and "what we actually do" in a single object, so
// adding a capability is self-contained. The ToolRegistry is built from a list of these.
export type Tool = {
	// The schema advertised to the model (name, description, input JSON Schema).
	schema: Anthropic.Tool;
	// Execute the tool with the model-supplied input; return the result string.
	run(input: unknown): Promise<string>;
};
