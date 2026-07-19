import { expect, test } from "bun:test";
import { createGetFramesTool } from "./get-frames.ts";
import type { LoadedVideo, VideoStore } from "./video.ts";

// A load result no test in this file ever awaits; get_frames only reads current().url, so the
// stores below just need something satisfying the VideoStore shape.
const unusedVideo: Promise<LoadedVideo> = Promise.resolve({ ok: false, message: "unused" });

// These paths never reach yt-dlp/ffmpeg, so the store can be inert.
const emptyStore: VideoStore = {
	load: () => unusedVideo,
	current: () => undefined,
};

// A store with a video "loaded".
const videoUrl = "https://www.youtube.com/watch?v=dQw4w9WgXcQ";
const loadedStore: VideoStore = {
	load: () => unusedVideo,
	current: () => ({ url: videoUrl, video: unusedVideo }),
};

test("get_frames: no video loaded yet", async () => {
	const actual = await createGetFramesTool(emptyStore).run({ timestamps: ["0:45"] });

	expect(actual).toContain("No video is loaded");
	expect(actual).toContain("load_video");
});

test("get_frames: empty timestamps list is a validation error", async () => {
	const actual = await createGetFramesTool(emptyStore).run({ timestamps: [] });

	expect(actual).toContain("get_frames couldn't read its input");
});

test("get_frames: returns a labeled image per timestamp", async () => {
	const resolvedUrls: string[] = [];
	const tool = createGetFramesTool(loadedStore, {
		async resolveStreamUrl(url) {
			resolvedUrls.push(url);
			return { ok: true, url: "https://stream.example/video.mp4" };
		},

		// Tag each frame's bytes with its label so the pairing below is checkable.
		async extractFrame(_streamUrl, label) {
			return { ok: true, label, data: `jpeg-${label}` };
		},
	});

	const actual = await tool.run({ timestamps: ["0:05", "1:30"] });

	// The stream URL is resolved once, for the currently-loaded video.
	expect(resolvedUrls).toEqual([videoUrl]);
	expect(actual).toMatchObject([
		{ type: "text", text: expect.stringContaining("0:05") },
		{ type: "image", source: { media_type: "image/jpeg", data: "jpeg-0:05" } },
		{ type: "text", text: expect.stringContaining("1:30") },
		{ type: "image", source: { media_type: "image/jpeg", data: "jpeg-1:30" } },
	]);
});

test("get_frames: partial success returns the good frames plus a note", async () => {
	const tool = createGetFramesTool(loadedStore, {
		async resolveStreamUrl() {
			return { ok: true, url: "https://stream.example/video.mp4" };
		},

		async extractFrame(_streamUrl, label) {
			if (label === "0:05") {
				return { ok: true, label, data: "jpeg-0:05" };
			} else {
				return { ok: false, label, error: "past the end of the video" };
			}
		},
	});

	const actual = await tool.run({ timestamps: ["0:05", "9:59"] });

	expect(actual).toMatchObject([
		{ type: "text", text: expect.stringContaining("0:05") },
		{ type: "image", source: { data: "jpeg-0:05" } },
		{ type: "text", text: expect.stringMatching(/9:59.*past the end of the video/) },
	]);
});
