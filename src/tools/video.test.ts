import { expect, test } from "bun:test";
import { parseSrt } from "./video.ts";

const subtitle1 = `
1
00:05:00,400 --> 00:05:15,300
This is an example of
a subtitle.
`.trim();

const subtitle2 = `
2
00:05:16,400 --> 00:05:25,300
This is an example of
a subtitle - 2nd subtitle.
`.trim();

const entry1 = {
	start: 300,
	text: "This is an example of a subtitle.",
};
const entry2 = {
	start: 316,
	text: "This is an example of a subtitle - 2nd subtitle.",
};

const fullSrt = `
${subtitle1}

${subtitle2}
`.trim();

test("parseSrt: empty string", () => {
	expect(parseSrt("")).toBeEmpty();
});

test("parseSrt: single subtitle", () => {
	expect(parseSrt(subtitle1)).toEqual([entry1]);
});

test("parseSrt: multiple subtitles", () => {
	expect(parseSrt(fullSrt)).toEqual([entry1, entry2]);
});

test("parseSrt: multiple subtitles with period millisecond separator", () => {
	expect(parseSrt(fullSrt.replaceAll(",", "."))).toEqual([entry1, entry2]);
});

test("parseSrt: multiple subtitles with carriage return", () => {
	expect(parseSrt(fullSrt.replaceAll(/(?<!\r)\n/g, "\r\n"))).toEqual([entry1, entry2]);
});

test("parseSrt: subtitle with newlines in it", () => {
	const srt = `
${subtitle1}

It has


newlines in it.
  `.trim();

	expect(parseSrt(srt)[0]?.text).toEqual(
		"This is an example of a subtitle. It has newlines in it.",
	);
});

test("parseSrt: subtitle with extra text and a newline before its number", () => {
	const srt = `
extra text

${subtitle1}
  `.trim();

	expect(parseSrt(srt)).toEqual([entry1]);
});

test("parseSrt: subtitle with extra text and no newline before its number", () => {
	const srt = `
extra text
${subtitle1}
  `.trim();

	expect(parseSrt(srt)).toEqual([entry1]);
});

test("parseSrt: a subtitle with no text followed by a valid subtitle", () => {
	const srt = `
1
00:05:00,400 --> 00:05:15,300

${subtitle2}
  `.trim();

	expect(parseSrt(srt)).toEqual([entry2]);
});

test("parseSrt: subtitle with no timing info", () => {
	const srt = `
1
This is an example of
a subtitle.
  `.trim();

	expect(parseSrt(srt)).toBeEmpty();
});
