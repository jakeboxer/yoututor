import type { ToolRegistry } from "../agent/tool-registry.ts";
import { createGetFramesTool } from "./get-frames.ts";
import { createLoadVideoTool } from "./load-video.ts";
import type { Tool } from "./tool.ts";

export function createToolRegistry(videoUrl: string): ToolRegistry {
	// Every tool the agent can use. Add a capability by writing a Tool and dropping it in this list.
	const tools: Tool[] = [createLoadVideoTool(videoUrl), createGetFramesTool(videoUrl)];

	// Index tools by their schema name so run() can dispatch by the name the model gives us.
	const byName = new Map(tools.map((tool) => [tool.schema.name, tool]));

	return {
		schemas: tools.map((tool) => tool.schema),
		async run(name, input) {
			const tool = byName.get(name);
			if (!tool) return `Unknown tool: ${name}`;

			return tool.run(input);
		},
	};
}
