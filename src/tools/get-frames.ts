import type Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { parseTimestamp, TIMESTAMP_PATTERN } from "./timestamp.ts";
import type { Tool } from "./tool.ts";

const Input = z.object({
	timestamps: z
		.array(
			z
				.string()
				.regex(
					TIMESTAMP_PATTERN,
					'Use "mm:ss" or "h:mm:ss" — e.g. "0:45" is 45 seconds in. Add a decimal for sub-second precision, e.g. "0:45.5".',
				),
		)
		.min(1)
		.describe(
			'The timestamps to grab frames at, each written "mm:ss" or "h:mm:ss" — the same format the ' +
				'transcript uses. For example "0:45" is 45 seconds into the video. Append a decimal for ' +
				'sub-second precision, e.g. "0:45.5". Pass several to compare nearby moments.',
		),
});

export function createGetFramesTool(_videoUrl: string): Tool {
	return {
		schema: {
			name: "get_frames",
			description:
				"Extract frames from a YouTube video so you can answer questions about the visuals that the user is seeing.",
			input_schema: z.toJSONSchema(Input) as Anthropic.Tool["input_schema"],
		},

		async run(input) {
			const parsed = Input.safeParse(input);
			if (!parsed.success) {
				return 'get_frames needs timestamps like "0:45" or "1:02:03" (mm:ss or h:mm:ss).';
			}

			// The colon strings are the model-facing format; convert to seconds for the actual seek.
			const seconds = parsed.data.timestamps.map(parseTimestamp);

			// Placeholder until real frame extraction is wired up: hand back a stock image once per
			// requested timestamp, so we can watch image tool results flow through the loop and reach
			// the model before we shell out to ffmpeg (what _videoUrl and `seconds` are reserved for).
			const data = Buffer.from(await Bun.file("tmp.png").bytes()).toString("base64");
			const frame: Anthropic.ImageBlockParam = {
				type: "image",
				source: { type: "base64", media_type: "image/png", data },
			};

			return seconds.map(() => frame);
		},
	};
}
