import { expect, test } from "bun:test";
import { createVideoStore, type LoadedVideo } from "./video.ts";

const goodVideo: LoadedVideo = {
	ok: true,
	metadata: { title: "Never Gonna Give You Up", description: "", thumbnailUrl: "" },
	transcriptEntries: [{ start: 0, text: "We're no strangers to love." }],
};

const badVideo: LoadedVideo = {
	ok: false,
	message: "This video has no English captions available.",
};

// A fetch stub that records the URLs it was asked for and answers from a fixed map.
function fakeFetch(responses: Record<string, LoadedVideo>) {
	const calls: string[] = [];
	const fetch = (url: string) => {
		calls.push(url);
		const video = responses[url];
		return Promise.resolve(video ?? { ok: false as const, message: `unexpected URL: ${url}` });
	};

	return { calls, fetch };
}

const urlA = "https://www.youtube.com/watch?v=aaaa";
const urlB = "https://www.youtube.com/watch?v=bbbb";

test("same URL twice fetches once", async () => {
	const { calls, fetch } = fakeFetch({ [urlA]: goodVideo });
	const store = createVideoStore(fetch);

	expect(await store.load(urlA)).toEqual(goodVideo);
	expect(await store.load(urlA)).toEqual(goodVideo);
	expect(calls).toEqual([urlA]);
});

test("a different URL replaces the current video", async () => {
	const { calls, fetch } = fakeFetch({ [urlA]: goodVideo, [urlB]: goodVideo });
	const store = createVideoStore(fetch);

	await store.load(urlA);
	expect(store.current()?.url).toEqual(urlA);

	await store.load(urlB);
	expect(store.current()?.url).toEqual(urlB);
	expect(calls).toEqual([urlA, urlB]);
});

test("a successful load stays current", async () => {
	const { fetch } = fakeFetch({ [urlA]: goodVideo });
	const store = createVideoStore(fetch);

	await store.load(urlA);
	expect(store.current()?.url).toEqual(urlA);
	expect(await store.current()?.video).toEqual(goodVideo);
});

test("a failed load is dropped so the next call retries", async () => {
	const { calls, fetch } = fakeFetch({ [urlA]: badVideo });
	const store = createVideoStore(fetch);

	expect(await store.load(urlA)).toEqual(badVideo);
	expect(store.current()).toBeUndefined();

	await store.load(urlA);
	expect(calls).toEqual([urlA, urlA]);
});

test("current() is empty before any load and never fetches", () => {
	const { calls, fetch } = fakeFetch({});
	const store = createVideoStore(fetch);

	expect(store.current()).toBeUndefined();
	expect(calls).toBeEmpty();
});
