import type Anthropic from "@anthropic-ai/sdk";
import { $ } from "bun";
import { z } from "zod";
import { tail } from "./tail.ts";
import { parseTimestamp, TIMESTAMP_DESCRIPTION, TIMESTAMP_PATTERN } from "./timestamp.ts";
import type { Tool } from "./tool.ts";
import type { ToolResult } from "./tool-result.ts";

const Input = z.object({
	timestamps: z
		.array(z.string().regex(TIMESTAMP_PATTERN, TIMESTAMP_DESCRIPTION))
		.min(1)
		.describe(
			'The timestamps to grab frames at, each written "mm:ss" or "h:mm:ss" — the same format the ' +
				'transcript uses. For example "0:45" is 45 seconds into the video. Append a decimal for ' +
				'sub-second precision, e.g. "0:45.5". Pass several to compare nearby moments.',
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
			if (!parsed.success) {
				return `get_frames couldn't read its input: ${z.prettifyError(parsed.error)}`;
			}

			// Resolve a direct video-stream URL once, then seek into it per timestamp. This lets ffmpeg
			// fetch only the bytes around each frame via HTTP range requests, instead of downloading the
			// whole video just to grab a handful of stills.
			const stream = await resolveStreamUrl(videoUrl);
			if (!stream.ok) return stream.error;

			// Frames are independent, so pull them concurrently.
			const frames = await Promise.all(
				parsed.data.timestamps.map((label) => extractFrame(stream.url, label)),
			);

			const blocks: Exclude<ToolResult, string> = [];
			const failures: string[] = [];

			for (const frame of frames) {
				if (frame.ok) {
					// Label each frame so the model can tell the returned images apart.
					blocks.push({ type: "text", text: `Frame at ${frame.label}:` });
					blocks.push({
						type: "image",
						source: { type: "base64", media_type: "image/jpeg", data: frame.data },
					});
				} else {
					failures.push(`• ${frame.label}: ${frame.error}`);
				}
			}

			if (blocks.length === 0) {
				return `Couldn't extract any frames:\n${failures.join("\n")}`;
			}

			if (failures.length > 0) {
				blocks.push({
					type: "text",
					text: `Couldn't extract some frames:\n${failures.join("\n")}`,
				});
			}

			return blocks;
		},
	};
}

type FrameResult =
	| { ok: true; label: string; data: string }
	| { ok: false; label: string; error: string };

// Grab a single JPEG frame at `label` from an already-resolved stream URL.
async function extractFrame(streamUrl: string, label: string): Promise<FrameResult> {
	// -ss before -i is an input seek: ffmpeg jumps (via HTTP range requests) to the keyframe at/before
	// the timestamp and decodes forward to the exact frame, so we only fetch a small chunk instead of
	// the whole stream. -frames:v 1 takes one frame, written to stdout as JPEG.
	const args = [
		"-hide_banner",
		"-loglevel",
		"error",
		"-nostdin",
		"-ss",
		String(parseTimestamp(label)),
		"-i",
		streamUrl,
		"-frames:v",
		"1",
		"-q:v",
		"4", // JPEG quality (2–31, lower is better) — a good-looking still without a huge payload
		"-f",
		"image2pipe",
		"-vcodec",
		"mjpeg",
		"pipe:1",
	];

	const result = await $`ffmpeg ${args}`.quiet().nothrow();

	// ffmpeg can exit 0 yet emit nothing (e.g. a timestamp past the end of the video), so check both.
	if (result.exitCode !== 0 || result.stdout.length === 0) {
		const stderr = tail(result.stderr.toString().trim());
		return { ok: false, label, error: stderr || `ffmpeg exited with code ${result.exitCode}` };
	}

	return { ok: true, label, data: result.stdout.toString("base64") };
}

// Resolve a direct, seekable video-stream URL for the video with yt-dlp's -g.
// Returns the URL, or a plain-English explanation if it couldn't be resolved.
async function resolveStreamUrl(
	videoUrl: string,
): Promise<{ ok: true; url: string } | { ok: false; error: string }> {
	// Prefer an H.264 MP4 video track (the most ffmpeg-friendly), capped at 720p to keep range
	// fetches small. Fall back to a progressive stream, then to whatever's best.
	// bestvideo/best each resolve to a single URL, so -g prints one line.
	const args = [
		"-f",
		"bestvideo[height<=720][ext=mp4]/best[height<=720][ext=mp4]/best",
		"-g",
		"--no-playlist",
		videoUrl,
	];

	const result = await $`yt-dlp ${args}`.quiet().nothrow();

	if (result.exitCode !== 0) {
		const stderr = tail(result.stderr.toString().trim());
		return {
			ok: false,
			error: `Couldn't get the video stream — yt-dlp exited with code ${result.exitCode}:\n${stderr}`,
		};
	}

	const url = result.stdout.toString().trim().split("\n")[0];
	if (!url) return { ok: false, error: "yt-dlp didn't return a video stream URL." };

	return { ok: true, url };
}
