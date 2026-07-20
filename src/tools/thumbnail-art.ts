import { $ } from "bun";

// Renders a thumbnail URL as terminal ASCII art. Injectable so tool tests don't hit the network or
// ffmpeg; real callers use the default renderThumbnailArt. Resolves undefined on any failure
// (thumbnail art is garnish, so there's no error to report, just no art).
export type RenderThumbnailArt = (thumbnailUrl: string) => Promise<string | undefined>;

// Dark-to-light glyphs; a pixel's brightness picks the glyph.
const RAMP = " .:-=+*#%@";

const ART_WIDTH = 80; // fits a standard 80-column terminal; narrower ones will wrap the art.
const ART_HEIGHT = 22; // ≈ 80 × (9/16) ÷ 2 — terminal cells are about twice as tall as wide.

// Map raw RGB pixels (3 bytes each, row-major) to ASCII art lines. Brightness determines the glyph,
// the pixel's own color paints it via a 24-bit ANSI escape. Escapes are only emitted when the
// color changes (and never for spaces, which show no foreground), so flat areas stay cheap. Each
// colored row ends with a reset so nothing bleeds into the next line.
export function rgbToAscii(pixels: Uint8Array, width: number, height: number): string {
	const rows: string[] = [];

	for (let y = 0; y < height; y++) {
		let row = "";
		let color: string | undefined;

		for (let x = 0; x < width; x++) {
			const i = (y * width + x) * 3;
			const r = pixels[i] ?? 0;
			const g = pixels[i + 1] ?? 0;
			const b = pixels[i + 2] ?? 0;

			// Rec. 601 luma — how bright the pixel reads to the eye.
			const luma = 0.299 * r + 0.587 * g + 0.114 * b;
			const glyph = RAMP.charAt(Math.round((luma / 255) * (RAMP.length - 1)));

			if (glyph !== " ") {
				const paint = `\x1b[38;2;${r};${g};${b}m`;
				if (paint !== color) {
					row += paint;
					color = paint;
				}
			}

			row += glyph;
		}

		rows.push(color === undefined ? row : `${row}\x1b[0m`);
	}

	return rows.join("\n");
}

// Image bytes (JPEG, PNG, or anything else ffmpeg decodes) -> ASCII art. ffmpeg decodes and
// downscales in one pass, emitting ART_WIDTH × ART_HEIGHT RGB pixels on stdout. Anything else (bad
// image, missing binary) means no art. Buffer-based so get_frames can reuse it for frames.
export async function artFromImage(image: Uint8Array): Promise<string | undefined> {
	const args = [
		"-hide_banner",
		"-loglevel",
		"error",
		"-i",
		"pipe:0", // the image bytes arrive on stdin
		"-frames:v",
		"1",
		"-vf",
		`scale=${ART_WIDTH}:${ART_HEIGHT}`,
		"-pix_fmt",
		"rgb24",
		"-f",
		"rawvideo",
		"pipe:1", // raw pixels leave on stdout
	];

	const result = await $`ffmpeg ${args} < ${new Blob([image])}`.quiet().nothrow();
	const pixels = new Uint8Array(result.stdout);

	// Exit early if ffmpeg errored.
	if (result.exitCode !== 0) return undefined;

	// Exit early if ffmpeg gave us an unexpected number of pixels.
	if (pixels.length !== ART_WIDTH * ART_HEIGHT * 3) return undefined;

	return rgbToAscii(pixels, ART_WIDTH, ART_HEIGHT);
}

// The default RenderThumbnailArt: fetch the thumbnail and convert it. Never throws.
export async function renderThumbnailArt(thumbnailUrl: string): Promise<string | undefined> {
	try {
		const response = await fetch(thumbnailUrl);
		if (!response.ok) return undefined;

		return await artFromImage(new Uint8Array(await response.arrayBuffer()));
	} catch {
		return undefined;
	}
}
