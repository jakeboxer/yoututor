import { expect, test } from "bun:test";
import type Anthropic from "@anthropic-ai/sdk";
import { APIConnectionError, APIError } from "@anthropic-ai/sdk";
import Agent from "./agent.ts";
import type { AgentEvent } from "./agent-event.ts";
import type { Host } from "./host.ts";
import type { ModelStreamStarter } from "./model-stream.ts";
import type { ToolRegistry } from "./tool-registry.ts";

// A host spy: hands out the scripted inputs one per request, then null (EOF) ends the session.
function hostWithInputs(...inputs: string[]): Host {
	const remaining = [...inputs];

	return {
		requestInput: () => Promise.resolve(remaining.shift() ?? null),
	};
}

// No tools: the agent still sends the (empty) schema list; any run() call is a test bug.
const noTools: ToolRegistry = {
	schemas: [],
	run: () => Promise.reject(new Error("no tool should run in these tests")),
};

// Build errors the way the SDK does from a real response — generate() returns the right subclass,
// so the agent's instanceof classification is exercised for real.
function apiError(status: number, type: string, message: string): APIError {
	const body = { type: "error", error: { type, message } };
	return APIError.generate(status, body, undefined, new Headers());
}

function textDeltaEvent(text: string): Anthropic.MessageStreamEvent {
	return { type: "content_block_delta", index: 0, delta: { type: "text_delta", text } };
}

// The smallest Anthropic.Message a scripted stream can resolve with: one text block, end_turn.
function finishedMessage(text: string): Anthropic.Message {
	return {
		id: "msg_scripted",
		type: "message",
		role: "assistant",
		model: "claude-scripted",
		content: [{ type: "text", text, citations: null }],
		container: null,
		stop_details: null,
		stop_reason: "end_turn",
		stop_sequence: null,
		usage: {
			input_tokens: 0,
			output_tokens: 0,
			cache_creation: null,
			cache_creation_input_tokens: null,
			cache_read_input_tokens: null,
			inference_geo: null,
			output_tokens_details: null,
			server_tool_use: null,
			service_tier: null,
		},
	};
}

type ScriptedModelResult =
	// A healthy stream
	| { events: Anthropic.MessageStreamEvent[]; final: Anthropic.Message }
	// A failure before any event arrives
	| { failWith: unknown }
	// A stream that dies after yielding some events
	| { events: Anthropic.MessageStreamEvent[]; thenFailWith: unknown };

/**
 * A starter spy: plays one script entry per model call and records every params object it gets.
 *
 * @param script One entry per expected model request, in order: request N gets script[N] as its
 * outcome (stream events + final message, or a scripted failure). A request beyond the script's
 * length throws — an unscripted model call is a test bug.
 * @returns `modelStreamStarter` to inject into the Agent, and `calls` — the request log. Each entry
 * is the full params object the agent sent for one model request (model, system, tools, messages),
 * appended at request time. `calls.length` is the number of model requests made; `calls[N]` is what
 * request N looked like on the wire — e.g. where cache_control markers sat. The `messages` array is
 * snapshotted at request time because the agent passes its live history array and keeps pushing to
 * it afterward; without the copy, every entry would show the final history instead of the history
 * as that request saw it.
 */
function scriptedModelSession(...script: ScriptedModelResult[]) {
	const calls: Anthropic.MessageStreamParams[] = [];

	const modelStreamStarter: ModelStreamStarter = (params) => {
		// The agent hands over its LIVE messages array (it keeps pushing to it after the call), so
		// snapshot it — each recorded call must show the history as it stood at request time.
		calls.push({ ...params, messages: [...params.messages] });

		const entry = script[calls.length - 1];
		if (entry === undefined) throw new Error(`unscripted model call #${calls.length}`);
		if ("failWith" in entry) throw entry.failWith;

		return {
			async *[Symbol.asyncIterator]() {
				yield* entry.events;
				if ("thenFailWith" in entry) throw entry.thenFailWith;
			},
			finalMessage: () =>
				"thenFailWith" in entry ? Promise.reject(entry.thenFailWith) : Promise.resolve(entry.final),
		};
	};

	return { modelStreamStarter, calls };
}

// Drain Agent.run() into a list, capturing a mid-iteration rejection instead of letting it escape —
// the error cases need both the events that made it out and the throw that ended the run.
async function collect(run: AsyncGenerator<AgentEvent>) {
	const events: AgentEvent[] = [];
	let thrown: unknown;

	try {
		for await (const event of run) {
			events.push(event);
		}
	} catch (err) {
		thrown = err;
	}

	return { events, thrown };
}

test("agent: one turn streams text deltas and closes with modelResponded", async () => {
	const { modelStreamStarter, calls } = scriptedModelSession({
		events: [textDeltaEvent("Hel"), textDeltaEvent("lo.")],
		final: finishedMessage("Hello."),
	});

	const agent = new Agent(hostWithInputs("hi there"), noTools, undefined, modelStreamStarter);
	const { events, thrown } = await collect(agent.run());

	expect(thrown).toBeUndefined();
	expect(events).toEqual([
		{ type: "textDelta", text: "Hel" },
		{ type: "textDelta", text: "lo." },
		{ type: "modelResponded" },
	]);
	expect(calls).toHaveLength(1);
	expect(calls[0]?.messages.at(-1)).toEqual({
		role: "user",
		content: [{ type: "text", text: "hi there", cache_control: { type: "ephemeral" } }],
	});
});

test("agent: an API error surfaces as an error event and the next turn recovers", async () => {
	const rateLimited = apiError(429, "rate_limit_error", "Too many requests");
	const { modelStreamStarter, calls } = scriptedModelSession(
		{ failWith: rateLimited },
		{ events: [textDeltaEvent("Hello.")], final: finishedMessage("Hello.") },
	);

	const agent = new Agent(
		hostWithInputs("hi", "try again"),
		noTools,
		undefined,
		modelStreamStarter,
	);
	const { events, thrown } = await collect(agent.run());

	// The failed turn yields error (no modelResponded); the second turn streams normally.
	expect(thrown).toBeUndefined();
	expect(events).toEqual([
		{ type: "error", message: expect.stringContaining("429") },
		{ type: "textDelta", text: "Hello." },
		{ type: "modelResponded" },
	]);

	// The SDK's maxRetries is the only retry layer — one call per turn, no attempts of the agent's
	// own. The failed turn left history ending in a user turn, so the retry's request carries both
	// user turns back-to-back (the API merges consecutive same-role messages).
	expect(calls).toHaveLength(2);
	expect(calls[1]?.messages).toEqual([
		{ role: "user", content: "hi" },
		{
			role: "user",
			content: [{ type: "text", text: "try again", cache_control: { type: "ephemeral" } }],
		},
	]);
});

test("agent: a mid-stream drop delivers the partial text, then an error event, then recovers", async () => {
	const { modelStreamStarter } = scriptedModelSession(
		{
			events: [textDeltaEvent("Half an ans"), textDeltaEvent("wer")],
			thenFailWith: new APIConnectionError({ message: "Connection error." }),
		},
		{ events: [textDeltaEvent("Whole answer.")], final: finishedMessage("Whole answer.") },
	);

	const agent = new Agent(hostWithInputs("hi", "again"), noTools, undefined, modelStreamStarter);
	const { events, thrown } = await collect(agent.run());

	expect(thrown).toBeUndefined();
	expect(events).toEqual([
		{ type: "textDelta", text: "Half an ans" },
		{ type: "textDelta", text: "wer" },
		{ type: "error", message: "couldn't reach the model API" },
		{ type: "textDelta", text: "Whole answer." },
		{ type: "modelResponded" },
	]);
});

test("agent: a non-API error propagates raw, not wrapped in AgentError", async () => {
	const bug = new TypeError("undefined is not a function");
	const { modelStreamStarter } = scriptedModelSession({ failWith: bug });

	const agent = new Agent(hostWithInputs("hi"), noTools, undefined, modelStreamStarter);
	const { thrown } = await collect(agent.run());

	expect(thrown).toBe(bug);
});
