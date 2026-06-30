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

export const getFramesTool: Tool = {
	schema: {
		name: "get_frames",
		description:
			"Extract frames from a YouTube video so you can answer questions about the visuals that the user is seeing.",
		input_schema: z.toJSONSchema(Input) as Anthropic.Tool["input_schema"],
	},

	async run(input) {
		const parsed = Input.safeParse(input);
		if (!parsed.success) return "get_frames was called without valid timestamps.";

		return "todo";
	},
};
