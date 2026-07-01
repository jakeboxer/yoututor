import type Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { parseTimestamp, TIMESTAMP_DESCRIPTION, TIMESTAMP_PATTERN } from "./timestamp.ts";
import type { Tool } from "./tool.ts";

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

export function createGetTranscriptRangeTool(videoUrl: string): Tool {
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

			return `TODO (${videoUrl})`;
		},
	};
}
