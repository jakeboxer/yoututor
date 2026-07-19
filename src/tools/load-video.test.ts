import { expect, test } from "bun:test";
import { createLoadVideoTool } from "./load-video.ts";
import type { LoadedVideo, VideoStore } from "./video.ts";

// A store spy: records the URLs load() receives and always answers with `video`.
function storeSpy(video: LoadedVideo) {
	const loadedUrls: string[] = [];
	const store: VideoStore = {
		load(url) {
			loadedUrls.push(url);
			return Promise.resolve(video);
		},
		current: () => undefined,
	};

	return { loadedUrls, store };
}

test("load_video: passes the URL to the store and returns the headline", async () => {
	const { loadedUrls, store } = storeSpy({
		ok: true,
		metadata: { title: "Never Gonna Give You Up", description: "The official video." },
		transcriptEntries: [
			{ start: 0, text: "We're no strangers to love." },
			{ start: 10, text: "You know the rules, and so do I." },
		],
	});

	const url = "https://www.youtube.com/watch?v=dQw4w9WgXcQ";
	const actual = await createLoadVideoTool(store).run({ url });

	expect(loadedUrls).toEqual([url]);
	expect(actual).toContain('Loaded "Never Gonna Give You Up".');
	expect(actual).toContain("It covers 00:00 to 00:10.");
	expect(actual).toContain("The official video.");
});

test("load_video: relays a failed load's message", async () => {
	const message = "This video has no English captions available.";
	const { store } = storeSpy({ ok: false, message });

	const actual = await createLoadVideoTool(store).run({ url: "https://youtube.com/watch?v=x" });

	expect(actual).toEqual(message);
});

test("load_video: missing url is a validation error, not a crash", async () => {
	const { loadedUrls, store } = storeSpy({ ok: false, message: "unused" });

	const actual = await createLoadVideoTool(store).run({});

	expect(actual).toContain("load_video couldn't read its input");
	expect(loadedUrls).toBeEmpty();
});
