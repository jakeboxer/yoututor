import { expect, test } from "bun:test";
import { normalizeResult } from "./tool-result-with-display.ts";

test("normalizeResult: wraps a string result", () => {
	expect(normalizeResult("all good")).toEqual({ result: "all good" });
});

test("normalizeResult: wraps a content-block array result", () => {
	const blocks = [{ type: "text" as const, text: "all good" }];

	expect(normalizeResult(blocks)).toEqual({ result: blocks });
});

test("normalizeResult: passes an already-wrapped result through", () => {
	const wrapped = { result: "all good", display: "ART" };

	expect(normalizeResult(wrapped)).toBe(wrapped);
});

test("normalizeResult: a wrapped bare result has no display key", () => {
	expect(Object.keys(normalizeResult("all good"))).toEqual(["result"]);
});
