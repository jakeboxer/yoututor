import Anthropic from "@anthropic-ai/sdk";
import { summarizeResult } from "../tools/tool-result.ts";
import type { AgentEvent } from "./agent-event.ts";
import type { Host } from "./host.ts";
import SYSTEM_PROMPT from "./system-prompt.ts";
import type { ToolRegistry } from "./tool-registry.ts";

// Overridable via .env alongside ANTHROPIC_API_KEY; Haiku is the dev default.
const MODEL = process.env.ANTHROPIC_MODEL ?? "claude-haiku-4-5";

export default class Agent {
	private client = new Anthropic();

	// The running conversation. Each turn appends the user message and Claude's reply, so the model
	// sees the full history on every request instead of just the latest line.
	private messages: Anthropic.MessageParam[] = [];

	constructor(
		private host: Host,
		private toolRegistry: ToolRegistry,
		private videoUrl?: string,
	) {}

	async *run(): AsyncGenerator<AgentEvent> {
		// If a URL was passed, load the video before the user says anything: we fabricate the model's
		// first move so the transcript is already in history, then let the model react to it with an
		// opening message.
		// If no URL was passed, start with an empty conversation. The model calls load_video itself
		// once the user shares a link.
		if (this.videoUrl !== undefined) {
			yield* this.seedLoadVideo(this.videoUrl);
			yield* this.respond();
		}

		// Outer loop: keeps prompting the user for more input.
		while (true) {
			// Ask the host for the next turn. Exit on EOF.
			const userInput = await this.host.requestInput();
			if (userInput === null) break;

			// Exit by typing "/exit".
			const prompt = userInput.trim();
			if (prompt === "/exit") break;

			// Skip blank lines. The Anthropic API rejects empty message content.
			if (prompt === "") continue;

			// Record the user's prompt, then let the model respond to it.
			this.messages.push({ role: "user", content: prompt });
			yield* this.respond();
		}
	}

	// Advance the conversation from the current `messages`: call the model, emit any text, run any
	// tools it asks for, and repeat until it returns a final answer instead of a tool request. Used
	// both after the seed (so the model greets) and for each user turn.
	private async *respond(): AsyncGenerator<AgentEvent> {
		// One turn may take several round-trips with the model. It might call a tool, read the result,
		// then answer (or answer directly). We loop until the reply is a final answer.
		while (true) {
			// Stream the reply instead of waiting for the whole thing. Handing over `tools` is still
			// what lets the model reply with a tool request instead of a final answer; the SDK keeps
			// assembling the full message behind the scenes so we can read it once the stream ends.
			const stream = this.client.messages.stream({
				model: MODEL,
				max_tokens: 64000,
				system: SYSTEM_PROMPT,
				tools: this.toolRegistry.schemas,
				messages: this.messages,
			});

			// Emit each chunk of answer text the moment it arrives. We stream ONLY text — a tool call's
			// input arrives as partial JSON, which we'd rather read fully-formed from finalMessage().
			for await (const event of stream) {
				if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
					yield { type: "textDelta", text: event.delta.text };
				}
			}

			// The SDK assembled the whole reply from the stream — the same shape create() returns. Use
			// it for history and control flow (text blocks, tool_use blocks, stop_reason).
			const response = await stream.finalMessage();
			this.messages.push({ role: "assistant", content: response.content });

			// Signal the reply is complete, so a renderer can close the streamed line of text.
			yield { type: "modelResponded" };

			// If no tool requested, this reply is the final answer. Break and let the caller decide what
			// happens next. (Any stop_reason other than "tool_use" means "done for now".)
			if (response.stop_reason !== "tool_use") break;

			// Otherwise: run every tool the model asked for and collect the results. A single reply can
			// contain multiple tool_use blocks (the model can call tools in parallel).
			const toolResults: Anthropic.ToolResultBlockParam[] = [];
			for (const block of response.content) {
				if (block.type === "tool_use") {
					toolResults.push(yield* this.runTool(block.id, block.name, block.input));
				}
			}

			// Feed all the results back as a SINGLE user turn, then loop so the model can read them and
			// continue. (Every tool_result for one reply goes in one message.)
			this.messages.push({ role: "user", content: toolResults });
		}
	}

	// Prime the conversation so the video is loaded before the first user turn. The API forces this
	// to be three messages: the first message must be `user`, and an assistant `tool_use` must be
	// answered by a matching `tool_result` — so we play both the user and the model for the opening
	// move, then run the tool for real.
	private async *seedLoadVideo(url: string): AsyncGenerator<AgentEvent> {
		// We invent the tool call, so we invent its id too. The tool_result below points back at it.
		const toolUseId = "seed_load_video";
		const input = { url };

		// Kickoff user message (satisfies "first message must be user") + the fabricated decision to
		// call load_video. The input mirrors the tool's real schema, so history shows the model a
		// well-formed example call it can imitate later.
		this.messages.push({
			role: "user",
			content: `Load this video so we can discuss it: ${url}`,
		});
		this.messages.push({
			role: "assistant",
			content: [{ type: "tool_use", id: toolUseId, name: "load_video", input }],
		});

		// Run the tool for real and feed the result back. The shared runTool guarantees this behaves
		// exactly like a model-issued call (progress events included), so a renderer shows the load
		// happening.
		this.messages.push({
			role: "user",
			content: [yield* this.runTool(toolUseId, "load_video", input)],
		});
	}

	// Run one tool call: announce it, execute it, report it, and return the tool_result block the
	// caller feeds back into the conversation. This is the ONLY place a tool's result/display fork
	// happens: the display artifact (if any) is included in the finished event passed to the
	// renderer, while just the pure tool call result goes into the returned block. This way, the
	// model doesn't waste tokens on display artifacts like ASCII art.
	private async *runTool(
		id: string,
		name: string,
		input: unknown,
	): AsyncGenerator<AgentEvent, Anthropic.ToolResultBlockParam> {
		// Announce the run BEFORE executing, so a renderer can show progress while a slow tool (e.g. a
		// real yt-dlp fetch) is in flight.
		yield { type: "toolRunStarted", name, input };

		const { result, display } = await this.toolRegistry.run(name, input);
		yield {
			type: "toolRunFinished",
			name,
			result: summarizeResult(result),
			...(display === undefined ? {} : { display }),
		};

		// `id` ties this result back to the tool_use request it answers.
		return { type: "tool_result", tool_use_id: id, content: result };
	}
}
