import Anthropic from "@anthropic-ai/sdk";

// Semantic events the loop emits. A renderer consumes these and decides how to display them.
// Add new variants as the loop grows.
export type AgentEvent = { type: "text"; text: string };

export default class Agent {
	private client = new Anthropic();

	async *run(): AsyncGenerator<AgentEvent> {
		while (true) {
			// Exit on EOF.
			const untrimmedLine = prompt(">");
			if (untrimmedLine === null) break;

			// Exit by typing "/exit".
			const line = untrimmedLine.trim();
			if (line === "/exit") break;

			// Skip blank lines. The Anthropic API rejects empty message content.
			if (line === "") continue;

			// Send the line to Claude and wait for the full reply.
			const response = await this.client.messages.create({
				model: "claude-haiku-4-5",
				max_tokens: 16000,
				messages: [{ role: "user", content: line }],
			});

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
