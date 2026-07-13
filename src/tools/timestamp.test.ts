import { expect, test } from "bun:test";
import { formatTimestamp, parseTimestamp } from "./timestamp.ts";

test("parseTimestamp: start of video", () => {
	expect(parseTimestamp("0:00")).toBe(0);
});

test("parseTimestamp: seconds only", () => {
	expect(parseTimestamp("0:45")).toBe(45);
});

test("parseTimestamp: fractional seconds", () => {
	expect(parseTimestamp("0:45.5")).toBeCloseTo(45.5);
});

test("parseTimestamp: minutes and seconds", () => {
	expect(parseTimestamp("1:45")).toBe(105);
});

test("parseTimestamp: hours, minutes, and seconds", () => {
	expect(parseTimestamp("2:34:56")).toBe(9296);
});

test("parseTimestamp: hours, minutes, seconds, and fractional", () => {
	expect(parseTimestamp("2:34:56.75")).toBeCloseTo(9296.75);
});

test("parseTimestamp: hours and seconds with no minutes", () => {
	expect(parseTimestamp("1:00:45")).toBe(3645);
});

test("parseTimestamp: unnecessary leading 0s", () => {
	expect(parseTimestamp("00:00:45")).toBe(45);
});

test("parseTimestamp: bad formatting doesn't crash", () => {
	expect(parseTimestamp("1:2:3:4:5")).toBeGreaterThanOrEqual(0);
});

test("formatTimestamp: start of video", () => {
	expect(formatTimestamp(0)).toBe("00:00");
});

test("formatTimestamp: under a minute", () => {
	expect(formatTimestamp(45)).toBe("00:45");
});

test("formatTimestamp: under a minute (fractional seconds)", () => {
	expect(formatTimestamp(45.5)).toBe("00:45");
});

test("formatTimestamp: exactly a minute", () => {
	expect(formatTimestamp(60)).toBe("01:00");
});

test("formatTimestamp: over a minute but under an hour", () => {
	expect(formatTimestamp(105)).toBe("01:45");
});

test("formatTimestamp: exactly an hour", () => {
	expect(formatTimestamp(3600)).toBe("1:00:00");
});

test("formatTimestamp: over an hour", () => {
	expect(formatTimestamp(9296)).toBe("2:34:56");
});

test("formatTimestamp: over an hour with fractional seconds", () => {
	expect(formatTimestamp(9296.75)).toBe("2:34:56");
});
