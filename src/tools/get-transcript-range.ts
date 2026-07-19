import type Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import {
	formatTimestamp,
	parseTimestamp,
	TIMESTAMP_DESCRIPTION,
	TIMESTAMP_PATTERN,
} from "./timestamp.ts";
import type { Tool } from "./tool.ts";
import { formatTranscript, type TranscriptEntry, type VideoStore } from "./video.ts";

const Input = z
	.object({
		start_timestamp: z
			.string()
			.regex(TIMESTAMP_PATTERN, TIMESTAMP_DESCRIPTION)
			.describe(
				'Where the range begins, written "mm:ss" or "h:mm:ss" — the same format the transcript ' +
					'uses. For example "0:45" is 45 seconds into the video. Append a decimal for sub-second ' +
					'precision, e.g. "0:45.5". Transcript lines at or after this time are included.',
			),
		end_timestamp: z
			.string()
			.regex(TIMESTAMP_PATTERN, TIMESTAMP_DESCRIPTION)
			.describe(
				'Where the range ends, in the same "mm:ss" / "h:mm:ss" format; must be at or after ' +
					"start_timestamp. Transcript lines up to this time are included. Choose the bounds " +
					"yourself so the window fits what you need — you can ask for an asymmetric span, e.g. more " +
					"lead-up before a moment than follow-up after it.",
			),
	})
	// Reject a backwards range here rather than letting it through to an empty transcript.
	.refine((data) => parseTimestamp(data.end_timestamp) >= parseTimestamp(data.start_timestamp), {
		message: "end_timestamp must be at or after start_timestamp.",
		path: ["end_timestamp"],
	});

// Which transcript entries fall in [start, end], inclusive on both ends. Keyed on each entry's
// START time only: a caption that begins before `start` is excluded even if its text runs into the
// window (we don't store caption end times). Extracted from run() so the pure logic is unit-testable.
export function selectTranscriptRange(
	entries: TranscriptEntry[],
	start: number,
	end: number,
): TranscriptEntry[] {
	return entries.filter((entry) => entry.start >= start && entry.start <= end);
}

export function createGetTranscriptRangeTool(videoStore: VideoStore): Tool {
	return {
		schema: {
			name: "get_transcript_range",
			description:
				"Read the transcript for a specific stretch of the video, given a start and end timestamp. " +
				"Use this to focus on one moment or section — like the lead-up to something the user asks " +
				"about — instead of re-reading the whole transcript. Returns the timestamped transcript " +
				"lines that fall within the range.",
			input_schema: z.toJSONSchema(Input) as Anthropic.Tool["input_schema"],
		},

		async run(input) {
			const parsed = Input.safeParse(input);
			if (!parsed.success) {
				return `get_transcript_range couldn't read its input: ${z.prettifyError(parsed.error)}`;
			}

			// If no video load has been started yet, let the model know that this tool can't be used
			// until a videl load has been started.
			const current = videoStore.current();
			if (!current) return "No video is loaded yet. Call load_video with a YouTube URL first.";

			const video = await current.video;
			if (!video.ok) return video.message;

			const start = parseTimestamp(parsed.data.start_timestamp);
			const end = parseTimestamp(parsed.data.end_timestamp);

			// Inclusive on both ends, keyed by each line's start time — the semantics the field
			// descriptions promise the model ("at or after" start, "up to" end).
			const inRange = selectTranscriptRange(video.transcriptEntries, start, end);

			if (inRange.length === 0) {
				// Point the model at the transcript's actual bounds so it can widen its range next turn
				// instead of guessing again. transcriptEntries is non-empty whenever load() succeeds.
				const first = video.transcriptEntries[0];
				const last = video.transcriptEntries[video.transcriptEntries.length - 1];
				const span =
					first && last
						? ` The transcript runs from ${formatTimestamp(first.start)} to ${formatTimestamp(last.start)}.`
						: "";
				return `No transcript lines fall between ${parsed.data.start_timestamp} and ${parsed.data.end_timestamp}.${span}`;
			}

			return formatTranscript(inRange);
		},
	};
}
