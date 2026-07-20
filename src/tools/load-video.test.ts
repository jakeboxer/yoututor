import { expect, test } from "bun:test";
import { createLoadVideoTool } from "./load-video.ts";
import type { RenderThumbnailArt } from "./thumbnail-art.ts";
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

// An art spy: records the thumbnail URLs it's asked to render and always answers with `art`.
function artSpy(art: string | undefined) {
	const renderedUrls: string[] = [];
	const renderArt: RenderThumbnailArt = (url) => {
		renderedUrls.push(url);
		return Promise.resolve(art);
	};

	return { renderedUrls, renderArt };
}

const loadedVideo: LoadedVideo = {
	ok: true,
	metadata: {
		title: "Never Gonna Give You Up",
		description: "The official video.",
		thumbnailUrl: "https://i.ytimg.com/vi/dQw4w9WgXcQ/mqdefault.jpg",
	},
	transcriptEntries: [
		{ start: 0, text: "We're no strangers to love." },
		{ start: 10, text: "You know the rules, and so do I." },
	],
};

test("load_video: passes the URL to the store and returns the headline", async () => {
	const { loadedUrls, store } = storeSpy(loadedVideo);
	const { renderArt } = artSpy(undefined);

	const url = "https://www.youtube.com/watch?v=dQw4w9WgXcQ";
	const actual = await createLoadVideoTool(store, renderArt).run({ url });

	expect(loadedUrls).toEqual([url]);
	expect(actual).toContain('Loaded "Never Gonna Give You Up".');
	expect(actual).toContain("It covers 00:00 to 00:10.");
	expect(actual).toContain("The official video.");
});

test("load_video: rendered art rides along as display, not in the result", async () => {
	const { store } = storeSpy(loadedVideo);
	const { renderedUrls, renderArt } = artSpy("##ART##");

	const actual = await createLoadVideoTool(store, renderArt).run({
		url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
	});

	expect(renderedUrls).toEqual([loadedVideo.metadata.thumbnailUrl]);
	expect(actual).toEqual({
		result: expect.stringContaining('Loaded "Never Gonna Give You Up".'),
		display: "##ART##",
	});
});

test("load_video: no art means a plain string result with no display key", async () => {
	const { store } = storeSpy(loadedVideo);
	const { renderArt } = artSpy(undefined);

	const actual = await createLoadVideoTool(store, renderArt).run({
		url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
	});

	expect(typeof actual).toEqual("string");
});

test("load_video: a throwing art renderer doesn't fail the tool", async () => {
	const { store } = storeSpy(loadedVideo);
	const renderArt: RenderThumbnailArt = () => Promise.reject(new Error("boom"));

	const actual = await createLoadVideoTool(store, renderArt).run({
		url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
	});

	expect(actual).toContain('Loaded "Never Gonna Give You Up".');
});

test("load_video: no thumbnail URL, no render attempt", async () => {
	const { store } = storeSpy({
		...loadedVideo,
		metadata: { ...loadedVideo.metadata, thumbnailUrl: "" },
	});
	const { renderedUrls, renderArt } = artSpy("##ART##");

	await createLoadVideoTool(store, renderArt).run({
		url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
	});

	expect(renderedUrls).toBeEmpty();
});

test("load_video: relays a failed load's message without rendering art", async () => {
	const message = "This video has no English captions available.";
	const { store } = storeSpy({ ok: false, message });
	const { renderedUrls, renderArt } = artSpy("##ART##");

	const actual = await createLoadVideoTool(store, renderArt).run({
		url: "https://youtube.com/watch?v=x",
	});

	expect(actual).toEqual(message);
	expect(renderedUrls).toBeEmpty();
});

test("load_video: missing url is a validation error, not a crash", async () => {
	const { loadedUrls, store } = storeSpy({ ok: false, message: "unused" });
	const { renderArt } = artSpy(undefined);

	const actual = await createLoadVideoTool(store, renderArt).run({});

	expect(actual).toContain("load_video couldn't read its input");
	expect(loadedUrls).toBeEmpty();
});
