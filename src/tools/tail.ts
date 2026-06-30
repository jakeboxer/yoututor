// Keep only the last few lines of (possibly long) text.
// Used to trim noisy command stderr down to something worth surfacing instead of dumping the whole
// failure.
export function tail(text: string, maxLines = 5): string {
	return text.split("\n").slice(-maxLines).join("\n");
}
