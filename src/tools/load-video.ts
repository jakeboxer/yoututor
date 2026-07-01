import { formatTimestamp } from "./timestamp.ts";
import type { Tool } from "./tool.ts";
import type { TranscriptStore } from "./transcript.ts";

// The load_video tool: fetch the video's transcript into the shared store, but deliberately DON'T
// return it. Dumping a long transcript into the conversation would bloat the context for the whole
// session, so we just confirm the load; the model reads what it needs via get_transcript_range.
export function createLoadVideoTool(transcript: TranscriptStore): Tool {
	return {
		schema: {
			name: "load_video",
			description:
				"Load a YouTube video's transcript so you can answer questions grounded in what the video actually says. Call this before answering questions about the video's content. Loads the transcript into the session and confirms it's ready — read specific parts with get_transcript_range.",
			input_schema: { type: "object" },
		},

		async run() {
			const loaded = await transcript.load();
			if (!loaded.ok) return loaded.message;

			// Report the covered time span so the model knows the valid range for get_transcript_range,
			// without pulling any transcript text into the conversation. entries is non-empty on success.
			const first = loaded.entries[0];
			const last = loaded.entries[loaded.entries.length - 1];
			const span =
				first && last
					? ` It covers ${formatTimestamp(first.start)} to ${formatTimestamp(last.start)}.`
					: "";
			return `Transcript loaded.${span} Use get_transcript_range to read specific sections.`;
		},
	};
}
