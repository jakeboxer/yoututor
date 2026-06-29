import Anthropic from "@anthropic-ai/sdk";

// Semantic events the loop emits. A renderer consumes these and decides how to display them.
// Add new variants as the loop grows.
export type AgentEvent = { type: "text"; text: string };

// The Input port. When the loop needs the user's next turn it `await`s this, so it never knows
// whether input comes from a terminal prompt or an Ink text field.Returns null on EOF, which
// ends the session. It's async so a UI host (which resolves only when the user submits) and a
// console host (which is blocking) fit the same shape.
export type Host = {
	requestInput(): Promise<string | null>;
};

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
