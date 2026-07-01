import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { $, Glob } from "bun";
import { tail } from "./tail.ts";
import { formatTimestamp } from "./timestamp.ts";

// One transcript line: the caption text and the second it starts at. We keep `start` as a number so
// callers can compare and slice by time; formatting back to [mm:ss] happens at the edge.
export type TranscriptEntry = { start: number; text: string };

// The outcome of loading a video's transcript. Either the parsed lines, or a plain-English message
// explaining why there aren't any (fetch failed, no captions) — the same message the model relays.
export type LoadedTranscript =
	| { ok: true; entries: TranscriptEntry[] }
	| { ok: false; message: string };

// A lazily-loaded, cached transcript for one video. load_video and get_transcript_range share a
// single store so the captions are fetched at most once per session instead of once per tool call.
export type TranscriptStore = {
	load(): Promise<LoadedTranscript>;
};

export function createTranscriptStore(videoUrl: string): TranscriptStore {
	// Hold the in-flight/resolved promise (not the value) so concurrent callers share one fetch.
	let cached: Promise<LoadedTranscript> | undefined;

	return {
		load() {
			if (cached) return cached;

			const pending = fetchTranscript(videoUrl);
			cached = pending;

			// Don't let a transient failure wedge the whole session: if the load didn't succeed, drop it
			// from the cache so the next call retries. (fetchTranscript never rejects, so no catch here.)
			pending.then((result) => {
				if (!result.ok && cached === pending) cached = undefined;
			});

			return pending;
		},
	};
}

// Render transcript entries as `[mm:ss] text` lines — the format the model reads everywhere else.
export function formatTranscript(entries: TranscriptEntry[]): string {
	return entries.map((entry) => `[${formatTimestamp(entry.start)}] ${entry.text}`).join("\n");
}

// Download captions for `videoUrl` into a fresh temp dir, then parse them. Captions-first — we take
// the video's existing captions (manual or YouTube's automatic ones), which are instant.
// Transcribing the audio ourselves when none exist is a later step. Never rejects: any failure comes
// back as { ok: false, message } so the tool has something to relay instead of crashing the loop.
async function fetchTranscript(videoUrl: string): Promise<LoadedTranscript> {
	let dir: string | undefined;

	try {
		dir = await mkdtemp(join(tmpdir(), "yoututor-"));

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
			videoUrl,
		];

		const result = await $`yt-dlp ${args}`.quiet().nothrow();

		if (result.exitCode !== 0) {
			const stderr = result.stderr.toString().trim();
			return {
				ok: false,
				message: `Couldn't load the video — yt-dlp exited with code ${result.exitCode}:\n${tail(stderr)}`,
			};
		}

		// yt-dlp names subtitle files <id>.<lang>.srt. We made a fresh dir, so take the first match.
		let srtPath: string | undefined;

		for await (const name of new Glob("*.srt").scan(dir)) {
			srtPath = join(dir, name);
			break;
		}

		if (!srtPath) {
			return {
				ok: false,
				message:
					"This video has no English captions available. (Transcribing the audio directly isn't wired up yet.)",
			};
		}

		const entries = parseSrt(await Bun.file(srtPath).text());

		if (entries.length === 0) {
			return {
				ok: false,
				message: "This video's captions came back empty — there's nothing to read.",
			};
		}

		return { ok: true, entries };
	} catch (error) {
		const detail = error instanceof Error ? error.message : String(error);
		return { ok: false, message: `Couldn't load the video's transcript: ${detail}` };
	} finally {
		// Always clean up the temp dir, even if a step above threw.
		if (dir) await rm(dir, { recursive: true, force: true });
	}
}

// Turn an SRT file into transcript entries. SRT blocks are separated by blank lines and look like:
//   1
//   00:00:18,800 --> 00:00:25,960
//   We're no strangers to
// We keep the start time and the text, and drop the index and end time.
function parseSrt(srt: string): TranscriptEntry[] {
	const entries: TranscriptEntry[] = [];
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

		entries.push({ start, text });
	}

	return entries;
}
