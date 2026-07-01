import type { ToolRegistry } from "../agent/tool-registry.ts";
import { createGetFramesTool } from "./get-frames.ts";
import { createGetTranscriptRangeTool } from "./get-transcript-range.ts";
import { createLoadVideoTool } from "./load-video.ts";
import type { Tool } from "./tool.ts";
import { createVideoStore } from "./video.ts";

export function createToolRegistry(videoUrl: string): ToolRegistry {
	// load_video and get_transcript_range read the same video; share one store so it's fetched at
	// most once per session.
	const videoStore = createVideoStore(videoUrl);

	// Every tool the agent can use. Add a capability by writing a Tool and dropping it in this list.
	const tools: Tool[] = [
		createGetFramesTool(videoUrl),
		createGetTranscriptRangeTool(videoStore),
		createLoadVideoTool(videoStore),
	];

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
