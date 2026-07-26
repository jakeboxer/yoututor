import { APIConnectionError, type APIError } from "@anthropic-ai/sdk";

// A model-API failure that escaped the SDK's built-in retries. The message is one human-readable
// sentence (see describeApiError); the original SDK error rides along in `cause`. The message
// carries no "session over" framing; the consumer decides how fatal it is.
export class AgentError extends Error {
	constructor(message: string, options?: ErrorOptions) {
		super(message, options);
		this.name = "AgentError";
	}
}

// One readable sentence for an SDK error: status plus the API's error type, no stack dump.
// Connection errors never got a response, so there's no status to name.
export function describeApiError(err: APIError): string {
	if (err instanceof APIConnectionError) {
		return "couldn't reach the model API";
	}

	const status = err.status === undefined ? "unknown status" : `status ${err.status}`;
	const type = err.type === null ? "" : `: ${err.type}`;

	return `the model API rejected the request (${status}${type})`;
}
