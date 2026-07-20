import { expect, test } from "bun:test";
import { rgbToAscii } from "./thumbnail-art.ts";

// Build an RGB pixel buffer from [r, g, b] triples.
function pixels(...triples: [number, number, number][]): Uint8Array {
	return new Uint8Array(triples.flat());
}

const black: [number, number, number] = [0, 0, 0];
const white: [number, number, number] = [255, 255, 255];

test("rgbToAscii: black pixels map to spaces with no escapes", () => {
	expect(rgbToAscii(pixels(black, black, black, black), 2, 2)).toEqual("  \n  ");
});

test("rgbToAscii: white pixels map to the densest glyph in white, one escape per run", () => {
	expect(rgbToAscii(pixels(white, white), 2, 1)).toEqual("\x1b[38;2;255;255;255m@@\x1b[0m");
});

test("rgbToAscii: each colored row resets so color can't bleed downward", () => {
	const art = rgbToAscii(pixels(white, white), 1, 2);

	expect(art.split("\n")).toEqual([
		"\x1b[38;2;255;255;255m@\x1b[0m",
		"\x1b[38;2;255;255;255m@\x1b[0m",
	]);
});

test("rgbToAscii: a color change mid-row emits a fresh escape", () => {
	const art = rgbToAscii(pixels(white, [255, 0, 0]), 2, 1);

	expect(art).toEqual("\x1b[38;2;255;255;255m@\x1b[38;2;255;0;0m-\x1b[0m");
});

test("rgbToAscii: brightness picks the glyph via luma, not any single channel", () => {
	// Pure green reads bright to the eye (~150 luma); pure blue reads dark (~29 luma).
	const art = rgbToAscii(pixels([0, 255, 0], [0, 0, 255]), 2, 1);

	expect(art).toEqual("\x1b[38;2;0;255;0m+\x1b[38;2;0;0;255m.\x1b[0m");
});

test("rgbToAscii: a gradient hits distinct ramp glyphs", () => {
	const gray = (v: number): [number, number, number] => [v, v, v];
	const art = rgbToAscii(pixels(gray(0), gray(85), gray(170), gray(255)), 4, 1);

	expect(art).toEqual(" \x1b[38;2;85;85;85m-\x1b[38;2;170;170;170m*\x1b[38;2;255;255;255m@\x1b[0m");
});
