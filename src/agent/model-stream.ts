import Anthropic, { type APIError } from "@anthropic-ai/sdk";

// What Agent.respond() consumes: the event stream plus the assembled final message. The SDK's
// MessageStream satisfies this structurally.
export type ModelStream = AsyncIterable<Anthropic.MessageStreamEvent> & {
	finalMessage(): Promise<Anthropic.Message>;
};

// The model-call port. Injectable for tests; real callers use createAnthropicStreamStarter().
export type ModelStreamStarter = (params: Anthropic.MessageStreamParams) => ModelStream;

// The production starter, backing one real Anthropic client. The SDK's built-in backoff
// (maxRetries, default 2) is the ONLY retry layer, by design — anything that escapes it is fatal
// for the turn. The client lives here rather than at module level so tests that inject a fake
// starter never construct a real client or need ANTHROPIC_API_KEY.
export function createAnthropicStreamStarter(): ModelStreamStarter {
	const client = new Anthropic();
	const start: ModelStreamStarter = (params) => client.messages.stream(params);
	const fault = process.env.FAULT;

	return fault ? createFailingStreamStarter(fault, start) : start;
}

// Dev-only fault injector (FAULT=<kind>): the first request fails as if the error had escaped the
// SDK's retries, then every later request delegates normally — so once errors are survivable, the
// session's recovery is directly observable. Kinds: a numeric status ("429", "529", …) thrown
// before iteration, "conn" for a connection error, or "midstream" for a few real events followed
// by a connection drop from the iterator — the one failure that can't be triggered for real.
function createFailingStreamStarter(kind: string, start: ModelStreamStarter): ModelStreamStarter {
	let failed = false;

	return (params) => {
		if (failed) return start(params);
		failed = true;

		if (kind === "midstream") {
			return dropMidStream(start(params));
		} else {
			throw injectedError(kind);
		}
	};
}

// Events forwarded before the injected drop: the stream opens with message/content-block
// bookkeeping, so three events is just enough for the first text delta to reach the renderer.
const EVENTS_BEFORE_DROP = 3;

function dropMidStream(stream: ModelStream): ModelStream {
	return {
		async *[Symbol.asyncIterator]() {
			let forwarded = 0;

			for await (const event of stream) {
				yield event;
				forwarded += 1;

				if (forwarded >= EVENTS_BEFORE_DROP) break;
			}

			throw new Anthropic.APIConnectionError({
				message: "injected mid-stream drop (FAULT=midstream)",
			});
		},

		// Unreached — the iterator above throws first — but ModelStream requires it.
		finalMessage: () => stream.finalMessage(),
	};
}

function injectedError(kind: string): APIError {
	if (kind === "conn") {
		return new Anthropic.APIConnectionError({
			message: "injected connection failure (FAULT=conn)",
		});
	}

	const status = Number(kind);
	if (!Number.isInteger(status)) {
		throw new Error(`FAULT must be a status code, "conn", or "midstream" — got "${kind}"`);
	}

	// Build the body the way a real API failure would, so generate() picks the right subclass and
	// describeApiError has an error type to name.
	const body = {
		type: "error",
		error: { type: "injected_fault", message: `injected failure (FAULT=${kind})` },
	};

	return Anthropic.APIError.generate(status, body, undefined, new Headers());
}
