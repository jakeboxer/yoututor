import { formatTimestamp } from "./timestamp.ts";
import type { Tool } from "./tool.ts";
import type { VideoStore } from "./video.ts";

// Cap how much of the (sometimes enormous) YouTube description we surface. The top of a description
// is usually the real summary; the tail is links, sponsors, and hashtags — noise we don't want
// eating the context we just worked to keep lean.
const MAX_DESCRIPTION_CHARS = 1000;

// The load_video tool: load the video (metadata + transcript) into the shared store, but
// deliberately DON'T return the transcript itself — that would bloat the context for the whole
// session. Instead it returns light orientation (title, description, covered time span) and points
// the model at get_transcript_range to read specific sections on demand.
export function createLoadVideoTool(videoStore: VideoStore): Tool {
	return {
		schema: {
			name: "load_video",
			description:
				"Load a YouTube video so you can answer questions grounded in what it actually says. Call this before answering questions about the video's content. Returns the video's title, description, and the time span its transcript covers — but NOT the transcript text itself. Read specific sections on demand with get_transcript_range.",
			input_schema: { type: "object" },
		},

		async run() {
			const video = await videoStore.load();
			if (!video.ok) return video.message;

			const { title, description } = video.metadata;
			const first = video.transcriptEntries[0];
			const last = video.transcriptEntries[video.transcriptEntries.length - 1];

			// Report the covered span so the model knows the valid range for get_transcript_range,
			// without pulling any transcript text into the conversation. transcriptEntries is non-empty
			// on success, so first/last are only optional to satisfy noUncheckedIndexedAccess; the empty
			// span carries its own leading space so concatenation stays clean either way.
			const span =
				first && last
					? ` It covers ${formatTimestamp(first.start)} to ${formatTimestamp(last.start)}.`
					: "";

			const heading = title ? `Loaded "${title}".` : "Transcript loaded.";
			const headline = `${heading}${span} Use get_transcript_range to read specific sections.`;

			const blurb = truncateDescription(description);
			return blurb ? `${headline}\n\nDescription:\n${blurb}` : headline;
		},
	};
}

// Trim a description down to MAX_DESCRIPTION_CHARS, cutting at a word/line boundary so we don't slice
// through the middle of a word. Returns "" for an empty/whitespace-only description.
function truncateDescription(text: string): string {
	const trimmed = text.trim();
	if (trimmed.length <= MAX_DESCRIPTION_CHARS) return trimmed;

	const slice = trimmed.slice(0, MAX_DESCRIPTION_CHARS);
	const boundary = Math.max(slice.lastIndexOf("\n"), slice.lastIndexOf(" "));
	const body = boundary > 0 ? slice.slice(0, boundary) : slice;

	return `${body.trimEnd()}…`;
}
