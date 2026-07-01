import type { Tool } from "./tool.ts";
import { formatTranscript, type TranscriptStore } from "./transcript.ts";

// The load_video tool: return the video's timestamped transcript. The fetch/parse lives in the
// shared transcript store (see transcript.ts) so load_video and get_transcript_range read the same
// captions, loaded at most once per session.
export function createLoadVideoTool(transcript: TranscriptStore): Tool {
	return {
		schema: {
			name: "load_video",
			description:
				"Load a YouTube video's transcript so you can answer questions grounded in what the video actually says. Call this before answering questions about the video's content. Returns the timestamped transcript.",
			input_schema: { type: "object" },
		},

		async run() {
			const loaded = await transcript.load();
			return loaded.ok ? formatTranscript(loaded.entries) : loaded.message;
		},
	};
}
