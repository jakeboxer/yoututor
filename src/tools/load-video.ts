import type Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { type RenderThumbnailArt, renderThumbnailArt } from "./thumbnail-art.ts";
import { formatTimestamp } from "./timestamp.ts";
import type { Tool } from "./tool.ts";
import type { VideoStore } from "./video.ts";

// Cap how much of the (sometimes enormous) YouTube description we surface. The top of a description
// is usually the real summary; the tail is links, sponsors, and hashtags — noise we don't want
// eating the context we just worked to keep lean.
const MAX_DESCRIPTION_CHARS = 1000;

const Input = z.object({
	// We expect a plain z.string() instead of z.url() so that users can paste scheme-less links
	// ("youtube.com/watch?v=…" with no "https://"). yt-dlp properly handles these, and rejects actual
	// garbage URLs with error messages that the model will understand.
	url: z
		.string()
		.describe(
			'The YouTube URL of the video to load, e.g. "https://www.youtube.com/watch?v=dQw4w9WgXcQ".',
		),
});

// The load_video tool: load the video (metadata + transcript) into the shared store, but
// deliberately DON'T return the transcript itself — that would bloat the context for the whole
// session. Instead it returns light orientation (title, description, covered time span) and points
// the model at get_transcript_range to read specific sections on demand.
// `renderArt` is injectable for tests; real callers use the default ffmpeg-backed converter.
export function createLoadVideoTool(
	videoStore: VideoStore,
	renderArt: RenderThumbnailArt = renderThumbnailArt,
): Tool {
	return {
		schema: {
			name: "load_video",
			description:
				"Load a YouTube video so you can answer questions grounded in what it actually says. " +
				"Call this when the user shares a video link, before answering questions about its " +
				"content; calling it again with a different URL switches the session to that video. " +
				"Returns the video's title, description, and the time span its transcript covers — but " +
				"NOT the transcript text itself. Read specific sections on demand with " +
				"get_transcript_range.",
			input_schema: z.toJSONSchema(Input) as Anthropic.Tool["input_schema"],
		},

		async run(input) {
			const parsed = Input.safeParse(input);
			if (!parsed.success) {
				return `load_video couldn't read its input: ${z.prettifyError(parsed.error)}`;
			}

			const video = await videoStore.load(parsed.data.url);
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
			const text = blurb ? `${headline}\n\nDescription:\n${blurb}` : headline;

			// Best-effort garnish: ASCII art of the thumbnail, for the renderer only. Any failure
			// (including a converter that throws) means no art — never a failed tool.
			let display: string | undefined;
			if (video.metadata.thumbnailUrl) {
				display = await renderArt(video.metadata.thumbnailUrl).catch(() => undefined);
			}

			return display === undefined ? text : { result: text, display };
		},
	};
}

// Trim a description down to MAX_DESCRIPTION_CHARS, cutting at a word/line boundary so we don't
// slice through the middle of a word. Returns "" for an empty/whitespace-only description.
function truncateDescription(text: string): string {
	const trimmed = text.trim();
	if (trimmed.length <= MAX_DESCRIPTION_CHARS) return trimmed;

	const slice = trimmed.slice(0, MAX_DESCRIPTION_CHARS);
	const boundary = Math.max(slice.lastIndexOf("\n"), slice.lastIndexOf(" "));
	const body = boundary > 0 ? slice.slice(0, boundary) : slice;

	return `${body.trimEnd()}…`;
}
