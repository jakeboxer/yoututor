import { expect, test } from "bun:test";
import BlockBuffer from "./block-buffer.ts";

test("push with no blocks", () => {
	const buffer = new BlockBuffer();
	const result = buffer.push("line one\nline two");

	expect(result).toBeEmpty();
});

test("push with one block", () => {
	const buffer = new BlockBuffer();
	const result = buffer.push("para one\n\npara two");

	expect(result).toEqual(["para one"]);
});

test("push with two blocks", () => {
	const buffer = new BlockBuffer();
	const result = buffer.push("para one\n\npara two\n\n");

	expect(result).toEqual(["para one", "para two"]);
});

test("push with mid-delta block split", () => {
	const buffer = new BlockBuffer();
	const result1 = buffer.push("para");
	const result2 = buffer.push(" one\n\npara two");

	expect(result1).toBeEmpty();
	expect(result2).toEqual(["para one"]);
});

test("push with multiple blank lines in a row", () => {
	const buffer = new BlockBuffer();
	const result = buffer.push("a\n\n\n\nb\n\n");

	expect(result).toEqual(["a", "b"]);
});

test("push with blank line inside fence", () => {
	const buffer = new BlockBuffer();
	const result = buffer.push("```\npara one\n\npara two\n```\n\n");

	expect(result).toEqual(["```\npara one\n\npara two\n```"]);
});

test("push with fence marker split across deltas", () => {
	const buffer = new BlockBuffer();
	const result1 = buffer.push("``");
	const result2 = buffer.push("`\ncode1\n\ncode2\n");
	const result3 = buffer.push("```\n\n");

	expect(result1).toBeEmpty();
	expect(result2).toBeEmpty();
	expect(result3).toEqual(["```\ncode1\n\ncode2\n```"]);
});

test("flush returns trailing partial block", () => {
	const buffer = new BlockBuffer();
	buffer.push("para");
	const result = buffer.flush();

	expect(result).toBe("para");
});

test("whitespace-only flush", () => {
	const buffer = new BlockBuffer();
	buffer.push("   ");
	const result = buffer.flush();

	expect(result).toBeNull();
});
