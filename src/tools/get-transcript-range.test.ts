import { expect, test } from "bun:test";
import { createGetTranscriptRangeTool, selectTranscriptRange } from "./get-transcript-range.ts";
import type { LoadedVideo, VideoStore } from "./video.ts";

// A store already holding `video`, as if load_video had run. The tool only reads current().
function storeWith(video: LoadedVideo): VideoStore {
	const current = {
		url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
		video: Promise.resolve(video),
	};
	return { load: () => current.video, current: () => current };
}

const emptyStore: VideoStore = {
	load: () => Promise.resolve({ ok: false, message: "unused" }),
	current: () => undefined,
};

const entry1 = {
	start: 0,
	text: "We're no strangers to love.",
};
const entry2 = {
	start: 10,
	text: "You know the rules, and so do I.",
};
const allEntries = [entry1, entry2];

const transcript1 = "[00:00] We're no strangers to love.";
const transcript2 = "[00:10] You know the rules, and so do I.";
const fullTranscript = `${transcript1}\n${transcript2}`;

const mockGetTranscriptRangeTool = createGetTranscriptRangeTool(
	storeWith({
		ok: true,
		metadata: {
			title: "Never Gonna Give You Up",
			description: "The official video by Rick Astley.",
			thumbnailUrl: "",
		},
		transcriptEntries: [entry1, entry2],
	}),
);

test("selectTranscriptRange: just start of video", () => {
	expect(selectTranscriptRange(allEntries, 0, 0)).toEqual([entry1]);
});

test("selectTranscriptRange: full video", () => {
	expect(selectTranscriptRange(allEntries, 0, 15)).toEqual([entry1, entry2]);
});

test("selectTranscriptRange: extending past video end", () => {
	expect(selectTranscriptRange(allEntries, 0, 9296)).toEqual([entry1, entry2]);
});

test("selectTranscriptRange: first second of first entry", () => {
	expect(selectTranscriptRange(allEntries, 0, 1)).toEqual([entry1]);
});

test("selectTranscriptRange: from video start to right before entry 2", () => {
	expect(selectTranscriptRange(allEntries, 0, 9.99)).toEqual([entry1]);
});

test("selectTranscriptRange: from video start to entry 2 start", () => {
	expect(selectTranscriptRange(allEntries, 0, 10)).toEqual([entry1, entry2]);
});

test("selectTranscriptRange: from right before entry 2 start to entry 2 start", () => {
	expect(selectTranscriptRange(allEntries, 9.99, 10)).toEqual([entry2]);
});

test("selectTranscriptRange: gap between entries 1 and 2", () => {
	expect(selectTranscriptRange(allEntries, 9.01, 9.99)).toBeEmpty();
});

test("selectTranscriptRange: from entry 2 start to entry 2 middle", () => {
	expect(selectTranscriptRange(allEntries, 10, 11)).toEqual([entry2]);
});

test("selectTranscriptRange: spanning middle of entry 1", () => {
	expect(selectTranscriptRange(allEntries, 1, 8)).toBeEmpty();
});

test("get_transcript_range tool: start to end", async () => {
	const actual = await mockGetTranscriptRangeTool.run({
		start_timestamp: "0:00",
		end_timestamp: "0:15",
	});

	expect(actual).toEqual(fullTranscript);
});

test("get_transcript_range tool: middle to later middle", async () => {
	const actual = await mockGetTranscriptRangeTool.run({
		start_timestamp: "0:08",
		end_timestamp: "0:12",
	});

	expect(actual).toEqual(transcript2);
});

test("get_transcript_range tool: gap between entries", async () => {
	const actual = await mockGetTranscriptRangeTool.run({
		start_timestamp: "0:04",
		end_timestamp: "0:08",
	});

	expect(actual).toEqual(
		"No transcript lines fall between 0:04 and 0:08. The transcript runs from 00:00 to 00:10.",
	);
});

test("get_transcript_range tool: bad input", async () => {
	const actual = await mockGetTranscriptRangeTool.run({
		start_timestamp: "0:02",
		end_timestamp: "0:01",
	});

	expect(actual).toContain("get_transcript_range couldn't read its input");
	expect(actual).toContain("end_timestamp must be at or after start_timestamp");
});

test("get_transcript_range tool: video failed to load", async () => {
	const errorMessage = "Video failed to load.";
	const failingGetTranscriptRangeTool = createGetTranscriptRangeTool(
		storeWith({ ok: false, message: errorMessage }),
	);
	const actual = await failingGetTranscriptRangeTool.run({
		start_timestamp: "0:00",
		end_timestamp: "0:15",
	});

	expect(actual).toEqual(errorMessage);
});

test("get_transcript_range tool: no video loaded yet", async () => {
	const actual = await createGetTranscriptRangeTool(emptyStore).run({
		start_timestamp: "0:00",
		end_timestamp: "0:15",
	});

	expect(actual).toContain("No video is loaded");
	expect(actual).toContain("load_video");
});
