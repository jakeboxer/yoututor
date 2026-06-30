import type Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import type { Tool } from "./tool.ts";

const Input = z.object({
	timestamps: z
		.array(z.number())
		.min(1)
		.describe(
			"The timestamps (in seconds through the video) of the frames to get. Fractional seconds are allowed.",
		),
});

export function createGetFramesTool(videoUrl: string): Tool {
	return {
		schema: {
			name: "get_frames",
			description:
				"Extract frames from a YouTube video so you can answer questions about the visuals that the user is seeing.",
			input_schema: z.toJSONSchema(Input) as Anthropic.Tool["input_schema"],
		},

		async run(input) {
			const parsed = Input.safeParse(input);
			if (!parsed.success) return "get_frames was called without valid timestamps.";

			// Placeholder until real frame extraction is wired up: hand back a stock image once per
			// requested timestamp, so we can watch image tool results flow through the loop and reach
			// the model before we shell out to ffmpeg (what _videoUrl is reserved for).
			const data = Buffer.from(await Bun.file("tmp.png").bytes()).toString("base64");
			const frame: Anthropic.ImageBlockParam = {
				type: "image",
				source: { type: "base64", media_type: "image/png", data },
			};

			return parsed.data.timestamps.map(() => frame);
		},
	};
}
