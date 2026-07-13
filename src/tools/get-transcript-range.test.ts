import { expect, test } from "bun:test";
import { selectTranscriptRange } from "./get-transcript-range.ts";

const entry1 = {
	start: 0,
	text: "We're no strangers to love.",
};
const entry2 = {
	start: 10,
	text: "You know the rules, and so do I.",
};
const allEntries = [entry1, entry2];

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
