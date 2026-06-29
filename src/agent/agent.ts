import Anthropic from "@anthropic-ai/sdk";
import type { AgentEvent } from "./agent-event.ts";
import type { Host } from "./host.ts";
import SYSTEM_PROMPT from "./system-prompt.ts";

export default class Agent {
	private client = new Anthropic();

	constructor(private host: Host) {}

	async *run(): AsyncGenerator<AgentEvent> {
		// The running conversation. Each turn appends the user message and Claude's reply, so the
		// model sees the full history on every request instead of just the latest line.
		const messages: Anthropic.MessageParam[] = [];

		while (true) {
			// Ask the host for the next turn. Exit on EOF.
			const userInput = await this.host.requestInput();
			if (userInput === null) break;

			// Exit by typing "/exit".
			const prompt = userInput.trim();
			if (prompt === "/exit") break;

			// Skip blank lines. The Anthropic API rejects empty message content.
			if (prompt === "") continue;

			// Record the user's prompt.
			messages.push({ role: "user", content: prompt });

			// Send the whole conversation to Claude.
			const response = await this.client.messages.create({
				model: "claude-haiku-4-5",
				max_tokens: 16000,
				system: SYSTEM_PROMPT,
				messages,
			});

			// Append Claude's response so it's part of the history for the next turn.
			messages.push({ role: "assistant", content: response.content });

			// response.content is a list of blocks.
			// Emit each text block as an event so a rendered can consume it and decide how to display it.
			for (const block of response.content) {
				if (block.type === "text") {
					yield { type: "text", text: block.text };
				}
			}
		}
	}
}
