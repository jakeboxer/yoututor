// The colon timestamp format ([h:]mm:ss) is the contract shared by every timestamp the model sees
// and emits: load_video prints transcript lines as [mm:ss], the user asks about "0:45", and
// get_frames takes the same strings back. Keeping format and parse together keeps both sides of
// that contract in sync.

// Seconds -> [mm:ss], or [h:mm:ss] once the video passes an hour.
export function formatTimestamp(totalSeconds: number): string {
	const hrs = Math.floor(totalSeconds / 3600);
	const mins = Math.floor((totalSeconds % 3600) / 60);
	const secs = Math.floor(totalSeconds % 60);
	const mm = String(mins).padStart(2, "0");
	const ss = String(secs).padStart(2, "0");
	return hrs > 0 ? `${hrs}:${mm}:${ss}` : `${mm}:${ss}`;
}

// Matches [h:]mm:ss with optional fractional seconds: "0:45", "1:23", "1:02:03", "0:45.5".
export const TIMESTAMP_PATTERN = /^(?:\d+:)?\d{1,2}:\d{1,2}(?:\.\d+)?$/;

// "[h:]mm:ss[.fff]" -> total seconds. Assumes `label` already matches TIMESTAMP_PATTERN, so each
// colon-separated part is a clean number; fold them in from most- to least-significant.
export function parseTimestamp(label: string): number {
	return label.split(":").reduce((acc, part) => acc * 60 + Number(part), 0);
}
