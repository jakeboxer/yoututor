import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { $, Glob } from "bun";
import { tail } from "./tail.ts";
import { formatTimestamp } from "./timestamp.ts";
import type { Tool } from "./tool.ts";

// The load_video tool: fetch a YouTube video's captions with yt-dlp and return them as a
// timestamped transcript. Captions-first — we take the video's existing captions (manual or
// YouTube's automatic ones), which are instant. Transcribing the audio ourselves when none exist is
// a later step.
export function createLoadVideoTool(videoUrl: string): Tool {
	return {
		schema: {
			name: "load_video",
			description:
				"Load a YouTube video's transcript so you can answer questions grounded in what the video actually says. Call this before answering questions about the video's content. Returns the timestamped transcript.",
			input_schema: { type: "object" },
		},

		async run() {
			return fetchTranscript(videoUrl);
		},
	};
}

// Download captions for `url` into a fresh temp dir, then parse them.
// Returns a transcript string, or a plain-English explanation if the fetch failed or the video has
// no captions. Either way the model gets something useful to relay, instead of the tool throwing
// and crashing the loop.
async function fetchTranscript(url: string): Promise<string> {
	const dir = await mkdtemp(join(tmpdir(), "yoututor-"));

	try {
		// Ask yt-dlp for English captions (manual or automatic) as SRT — its native SRT is already
		// deduplicated and tag-free, unlike VTT/json3, and needs no ffmpeg. Args go in as an array so
		// Bun.$ escapes each one (keeps `en.*` and `%(id)s` from being touched by shell parsing).
		const args = [
			"--skip-download", // we only want the captions, not the video
			"--write-subs", // manually-uploaded captions, if any
			"--write-auto-subs", // YouTube's auto-generated captions as a fallback
			"--sub-langs",
			// Prefer the original English track, then common variants. Deliberately NOT "en.*" — that
			// also matches the many "English from <language>" auto-translation tracks, and yt-dlp
			// downloads one file per match (slow, and YouTube rate-limits the burst of requests).
			"en-orig,en,en-US,en-GB",
			"--sub-format",
			"srt",
			"--no-playlist", // a playlist URL still loads just the one video
			"-P",
			dir, // write everything into our temp dir
			"-o",
			"%(id)s", // name files by video id; yt-dlp appends .<lang>.srt
			url,
		];

		const result = await $`yt-dlp ${args}`.quiet().nothrow();

		if (result.exitCode !== 0) {
			const stderr = result.stderr.toString().trim();
			return `Couldn't load the video — yt-dlp exited with code ${result.exitCode}:\n${tail(stderr)}`;
		}

		// yt-dlp names subtitle files <id>.<lang>.srt. We made a fresh dir, so take the first match.
		let srtPath: string | undefined;

		for await (const name of new Glob("*.srt").scan(dir)) {
			srtPath = join(dir, name);
			break;
		}

		if (!srtPath) {
			return "This video has no English captions available. (Transcribing the audio directly isn't wired up yet.)";
		}

		return parseSrt(await Bun.file(srtPath).text());
	} finally {
		// Always clean up the temp dir, even if parsing threw.
		await rm(dir, { recursive: true, force: true });
	}
}

// Turn an SRT file into `[mm:ss] text` lines. SRT blocks are separated by blank lines and look like:
//   1
//   00:00:18,800 --> 00:00:25,960
//   We're no strangers to
// We keep the start time and the text, and drop the index and end time.
function parseSrt(srt: string): string {
	const lines: string[] = [];
	const blocks = srt
		.replace(/\r\n/g, "\n")
		.trim()
		.split(/\n{2,}/);

	for (const block of blocks) {
		const rows = block.split("\n");
		const timing = rows[1];
		if (!timing) continue;

		// Pull HH:MM:SS off the start timestamp (SRT uses a comma before milliseconds, which we ignore).
		const match = timing.match(/^(\d{2}):(\d{2}):(\d{2})[,.]\d{3}\s*-->/);
		if (!match) continue;

		const start = Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]);
		if (Number.isNaN(start)) continue;

		// Everything after the timestamp line is caption text; join wrapped lines with a space.
		const text = rows.slice(2).join(" ").trim();
		if (!text) continue;

		lines.push(`[${formatTimestamp(start)}] ${text}`);
	}

	return lines.join("\n");
}
