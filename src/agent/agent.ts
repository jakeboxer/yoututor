import Anthropic from "@anthropic-ai/sdk";
import type { AgentEvent } from "./agent-event.ts";
import type { Host } from "./host.ts";
import SYSTEM_PROMPT from "./system-prompt.ts";

// --- Tools (temporary home) -------------------------------------------------
// For this step the tool and its implementation live right here in the agent file.
// A later step moves them behind a `ToolRegistry` port, and `load_video` gets a real
// yt-dlp-backed body. The loop in run() won't care where they live.

// What the MODEL sees: a name, a description telling it WHEN to call this, and a JSON
// Schema describing the arguments. The model fills in `input` to match the schema.
const tools: Anthropic.Tool[] = [
	{
		name: "load_video",
		description:
			"Load a YouTube video's transcript so you can answer questions grounded in what the video actually says. Call this before answering questions about the video's content. Returns the timestamped transcript.",
		input_schema: {
			type: "object",
			properties: {
				url: { type: "string", description: "The YouTube video URL to load." },
			},
			required: ["url"],
		},
	},
];

// What WE do when the model calls a tool: return a string that gets handed back as the
// tool result. This is a STUB — it ignores the URL and returns fixed fake transcript
// text, so we can exercise the loop without yt-dlp installed. The deliberately unusual
// content (garbage collection) makes it obvious from the model's answer whether it
// actually read the tool result.
function runTool(name: string, _input: unknown): string {
	if (name === "load_video") {
		return [
			"Transcript loaded (STUB DATA — not a real video):",
			"[00:00] Welcome back to the channel.",
			"[00:08] Today we're talking about how garbage collection works.",
			"[00:15] The core idea: the runtime tracks which objects are still reachable.",
			"[00:30] Anything no longer reachable can be safely freed.",
		].join("\n");
	}
	return `Unknown tool: ${name}`;
}

// ----------------------------------------------------------------------------

export default class Agent {
	private client = new Anthropic();

	constructor(
		private host: Host,
		private videoUrl: string,
	) {}

	async *run(): AsyncGenerator<AgentEvent> {
		// The running conversation. Each turn appends the user message and Claude's reply, so the
		// model sees the full history on every request instead of just the latest line.
		const messages: Anthropic.MessageParam[] = [];

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

			// Record the user's prompt, then start the agentic loop for this turn.
			messages.push({ role: "user", content: prompt });

			// Inner loop: one user question may take several round-trips with the model.
			// It might call load_video, read the result, then answer — or answer directly.
			// We keep looping until the model returns a final answer instead of a tool request.
			while (true) {
				// Send the whole conversation PLUS the tool list. Handing over `tools` is what
				// lets the model reply with a tool request instead of a final answer.
				const response = await this.client.messages.create({
					model: "claude-haiku-4-5",
					max_tokens: 16000,
					system: SYSTEM_PROMPT,
					tools,
					messages,
				});

				// Append Claude's reply to the history. This includes any tool_use blocks, which
				// MUST stay in the conversation — the tool_result we add below points back at
				// them by id.
				messages.push({ role: "assistant", content: response.content });

				// The model can write text AND request a tool in the same reply, so emit any
				// text now, before deciding what to do next.
				for (const block of response.content) {
					if (block.type === "text") {
						yield { type: "text", text: block.text };
					}
				}

				// If no tool requested, then this reply is the final answer. Break out and wait for the
				// next user turn. (Any stop_reason other than "tool_use" means "done for now".)
				if (response.stop_reason !== "tool_use") break;

				// Otherwise: run every tool the model asked for and collect the results. A single
				// reply can contain multiple tool_use blocks (the model can call tools in parallel).
				const toolResults: Anthropic.ToolResultBlockParam[] = [];
				for (const block of response.content) {
					if (block.type === "tool_use") {
						// Announce the run BEFORE executing, so a renderer can show progress while a slow tool
						// is in flight.
						yield { type: "toolRunStarted", name: block.name, input: block.input };

						const result = runTool(block.name, block.input);

						yield { type: "toolRunFinished", name: block.name, result };

						toolResults.push({
							type: "tool_result",
							tool_use_id: block.id, // ties this result to the request it answers
							content: result,
						});
					}
				}

				// Feed all the results back as a SINGLE user turn, then loop so the model can read
				// them and continue. (Every tool_result for one reply goes in one message.)
				messages.push({ role: "user", content: toolResults });
			}
		}
	}
}
