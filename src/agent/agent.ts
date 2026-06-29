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
		while (true) {
			// Ask the host for the next turn. Exit on EOF.
			const untrimmedLine = await this.host.requestInput();
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
