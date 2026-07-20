import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { $, Glob } from "bun";
import { tail } from "./tail.ts";
import { formatTimestamp } from "./timestamp.ts";

// One transcript line: the caption text and the second it starts at. We keep `start` as a number so
// callers can compare and slice by time; formatting back to [mm:ss] happens at the edge.
export type TranscriptEntry = { start: number; text: string };

// The video's basic metadata, pulled from yt-dlp's info JSON alongside the captions. Cheap
// orientation for the model — what the video is — without any transcript text in the conversation.
// `thumbnailUrl` is display-only (ASCII art in the terminal, never sent to the model); "" = none.
export type VideoMetadata = { title: string; description: string; thumbnailUrl: string };

// The outcome of loading a video. On success: its metadata plus the parsed transcript lines. On
// failure: a plain-English message explaining why (fetch failed, no captions) — the message the
// model relays.
export type LoadedVideo =
	| { ok: true; metadata: VideoMetadata; transcriptEntries: TranscriptEntry[] }
	| { ok: false; message: string };

// The video the session is currently looking at: its URL paired with its (possibly still in-flight)
// load. One object so readers can't observe the URL of one video with the promise of another
// mid-switch.
//
// This is a cache entry, not a domain type. It exposes the store's promise-memoization mechanism,
// and despite the name, `video` can still resolve to an { ok: false } load. If the store grows more
// state (progress, multiple videos), replace this with an explicit state union (idle / loading /
// ready) instead of extending it.
export type CurrentVideo = { url: string; video: Promise<LoadedVideo> };

// A lazily-loaded, cached video (metadata + transcript), shared by all tools so a video is fetched
// at most once. Loading a different URL replaces the current video, switching the session to it.
// current() lets tools that only need the URL (get_frames) or want to refuse before any load
// (get_transcript_range) read the state without triggering a fetch.
export type VideoStore = {
	load(url: string): Promise<LoadedVideo>;
	current(): CurrentVideo | undefined;
};

// `fetch` is injectable for tests; real callers use the default yt-dlp-backed fetchVideo.
export function createVideoStore(
	fetchVideo: (url: string) => Promise<LoadedVideo> = fetchVideoWithYtDlp,
): VideoStore {
	// Hold the in-flight/resolved promise (not the value) so concurrent callers share one fetch.
	let cached: CurrentVideo | undefined;

	return {
		load(url) {
			if (cached && cached.url === url) return cached.video;

			const entry: CurrentVideo = { url, video: fetchVideo(url) };
			cached = entry;

			// Don't let a transient failure hang the whole session; if the load didn't succeed, drop it
			// from the cache so the next call retries. Guard on the entry so a load of a different URL
			// that raced this failure isn't clobbered. (fetchVideoWithYtDlp never rejects, so no catch
			// here.)
			entry.video.then((result) => {
				if (!result.ok && cached === entry) {
					cached = undefined;
				}
			});

			return entry.video;
		},

		current() {
			return cached;
		},
	};
}

// Render transcript entries as `[mm:ss] text` lines — the format the model reads everywhere else.
export function formatTranscript(entries: TranscriptEntry[]): string {
	return entries.map((entry) => `[${formatTimestamp(entry.start)}] ${entry.text}`).join("\n");
}

// Download a video's captions and metadata into a fresh temp dir, then parse them. Captions-first —
// we take the video's existing captions (manual or YouTube's automatic ones), which are instant.
// Transcribing the audio ourselves when none exist is a later step. Never rejects: any failure comes
// back as { ok: false, message } so the tool has something to relay instead of crashing the loop.
async function fetchVideoWithYtDlp(videoUrl: string): Promise<LoadedVideo> {
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
			"--write-info-json", // the video's metadata (title, description, …) as <id>.info.json
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
			const err = tail(result.stderr.toString().trim());
			return {
				ok: false,
				message: `Couldn't load the video — yt-dlp exited with code ${result.exitCode}:\n${err}`,
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
					"This video has no English captions available. " +
					"(Transcribing the audio directly isn't wired up yet.)",
			};
		}

		const entries = parseSrt(await Bun.file(srtPath).text());

		if (entries.length === 0) {
			return {
				ok: false,
				message: "This video's captions came back empty — there's nothing to read.",
			};
		}

		return { ok: true, metadata: await readVideoMetadata(dir), transcriptEntries: entries };
	} catch (error) {
		const detail = error instanceof Error ? error.message : String(error);
		return { ok: false, message: `Couldn't load the video: ${detail}` };
	} finally {
		// Always clean up the temp dir, even if a step above threw.
		if (dir) await rm(dir, { recursive: true, force: true });
	}
}

// Read the video's metadata from the <id>.info.json that yt-dlp wrote next to the captions.
// Best-effort: metadata is orientation, not essential, so any problem (missing/unreadable/malformed
// file, or a field that isn't a string) degrades to empty strings rather than failing the load.
async function readVideoMetadata(dir: string): Promise<VideoMetadata> {
	try {
		let infoPath: string | undefined;
		for await (const name of new Glob("*.info.json").scan(dir)) {
			infoPath = join(dir, name);
			break;
		}
		if (!infoPath) return { title: "", description: "", thumbnailUrl: "" };

		const info = JSON.parse(await Bun.file(infoPath).text());
		return {
			title: typeof info.title === "string" ? info.title : "",
			description: typeof info.description === "string" ? info.description : "",
			thumbnailUrl: deriveThumbnailUrl(info.id, info.thumbnail),
		};
	} catch {
		return { title: "", description: "", thumbnailUrl: "" };
	}
}

// Derive a thumbnail URL from the info JSON's untrusted fields.
//
// Prefer building the mqdefault URL from the video id: it's a 320x180 true-16:9 JPEG that always
// exists. If there's no id, fall back to `thumbnail` (which is often WebP and (at hqdefault) 4:3
// with letterbox bars). If there's no `thumbnail` either, fall back to "".
export function deriveThumbnailUrl(id: unknown, thumbnail: unknown): string {
	if (typeof id === "string" && id !== "") return `https://i.ytimg.com/vi/${id}/mqdefault.jpg`;
	if (typeof thumbnail === "string") return thumbnail;

	return "";
}

// Turn an SRT file into transcript entries. An SRT block looks like:
//   1
//   00:00:18,800 --> 00:00:25,960
//   We're no strangers to
// We keep the start time and the text, and drop the index and end time.
export function parseSrt(srt: string): TranscriptEntry[] {
	const entries: TranscriptEntry[] = [];
	const lines = srt.replace(/\r\n/g, "\n").split("\n");

	// SRT uses a comma before milliseconds; some variants use a period. We keep only HH:MM:SS.
	const timingRe = /^(\d{2}):(\d{2}):(\d{2})[,.]\d{3}\s*-->/;
	const indexRe = /^\d+$/;

	let start: number | undefined;
	let textLines: string[] = [];

	const flush = () => {
		if (start === undefined) return;

		// Join wrapped and blank-separated lines with spaces, then collapse the runs to single spaces.
		const text = textLines.join(" ").replace(/\s+/g, " ").trim();
		if (text) entries.push({ start, text });
	};

	for (let i = 0; i < lines.length; i++) {
		const line = lines[i] ?? "";
		const next = lines[i + 1];
		const timing = next !== undefined && indexRe.test(line.trim()) ? next.match(timingRe) : null;

		if (timing) {
			flush();
			start = Number(timing[1]) * 3600 + Number(timing[2]) * 60 + Number(timing[3]);
			textLines = [];
			i++; // consume the timing line along with the index line

			continue;
		}

		if (start !== undefined) {
			textLines.push(line);
		}
	}

	flush();

	return entries;
}
