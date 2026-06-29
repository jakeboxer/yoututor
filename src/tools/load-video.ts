import type { Tool } from "./tool.ts";

// The load_video tool. STUB: it ignores the URL and returns fixed fake transcript text, so we can
// exercise the loop without yt-dlp installed. Step 4 swaps the run() body for a real yt-dlp call —
// the schema and the Tool shape stay the same.
export const loadVideoTool: Tool = {
	schema: {
		name: "load_video",
		description:
			"Load a YouTube video's transcript so you can answer questions grounded in what the video actually says. Call this before answering questions about the video's content. Returns the timestamped transcript.",
		input_schema: {
			type: "object",
			properties: {
				url: { type: "string", description: "The YouTube video URL to load." },
			},
			required: ["url"],
		},
	},

	// The deliberately unusual content (garbage collection) makes it obvious from the model's
	// answer whether it actually read the tool result.
	async run(_input) {
		return [
			"Transcript loaded (STUB DATA — not a real video):",
			"[00:00] Welcome back to the channel.",
			"[00:08] Today we're talking about how garbage collection works.",
			"[00:15] The core idea: the runtime tracks which objects are still reachable.",
			"[00:30] Anything no longer reachable can be safely freed.",
		].join("\n");
	},
};
