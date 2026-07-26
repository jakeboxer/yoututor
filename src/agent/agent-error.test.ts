import { expect, test } from "bun:test";
import { APIConnectionError, APIError } from "@anthropic-ai/sdk";
import { describeApiError } from "./agent-error.ts";

// Build errors the way the SDK does from a real response — generate() returns the right subclass,
// so instanceof classification is exercised for real. Needs no client and no ANTHROPIC_API_KEY.
function apiError(status: number, type: string, message: string): APIError {
	const body = { type: "error", error: { type, message } };
	return APIError.generate(status, body, undefined, new Headers());
}

test("describeApiError: rate limit (429) names the status and error type", () => {
	const description = describeApiError(apiError(429, "rate_limit_error", "Too many requests"));
	expect(description).toBe("the model API rejected the request (status 429: rate_limit_error)");
});

test("describeApiError: overloaded (529) names the status and error type", () => {
	const description = describeApiError(apiError(529, "overloaded_error", "Overloaded"));
	expect(description).toBe("the model API rejected the request (status 529: overloaded_error)");
});

test("describeApiError: bad request (400) names the status and error type", () => {
	const description = describeApiError(apiError(400, "invalid_request_error", "bad model name"));
	expect(description).toBe(
		"the model API rejected the request (status 400: invalid_request_error)",
	);
});

test("describeApiError: connection error says the API couldn't be reached", () => {
	const description = describeApiError(new APIConnectionError({ message: "Connection error." }));
	expect(description).toBe("couldn't reach the model API");
});

test("describeApiError: one readable sentence, no stack dump", () => {
	const description = describeApiError(apiError(529, "overloaded_error", "Overloaded"));
	expect(description).not.toInclude("\n");
	expect(description).not.toInclude("    at ");
});
