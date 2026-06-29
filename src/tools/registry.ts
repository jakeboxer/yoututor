import type { ToolRegistry } from "../agent/tool-registry.ts";
import { loadVideoTool } from "./load-video.ts";
import type { Tool } from "./tool.ts";

// Every tool the agent can use. Add a capability by writing a Tool and dropping it in this list.
const tools: Tool[] = [loadVideoTool];

// Index tools by their schema name so run() can dispatch by the name the model gives us.
const byName = new Map(tools.map((tool) => [tool.schema.name, tool]));

// The concrete ToolRegistry: it derives the schema list from the tools and dispatches run() by
// name. This is the implementation of the port — the agent only ever sees the ToolRegistry type.
export const toolRegistry: ToolRegistry = {
	schemas: tools.map((tool) => tool.schema),
	async run(name, input) {
		const tool = byName.get(name);
		if (!tool) return `Unknown tool: ${name}`;
		return tool.run(input);
	},
};
