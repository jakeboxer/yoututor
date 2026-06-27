import Anthropic from "@anthropic-ai/sdk";

// Minimal chat CLI: read a line, send it to Claude, print the reply, repeat.
// The SDK reads ANTHROPIC_API_KEY from the environment (Bun auto-loads .env).
const client = new Anthropic();

while (true) {
	// Exit on EOF.
	const untrimmedLine = prompt(">");
	if (untrimmedLine === null) break;

	// Exit by typing "/exit".
	const line = untrimmedLine.trim();
	if (line === "/exit") break;

	// Skip blank lines — the API rejects empty message content.
	if (line === "") continue;

	// Send the line to Claude and wait for the full reply.
	const response = await client.messages.create({
		model: "claude-haiku-4-5",
		max_tokens: 16000,
		messages: [{ role: "user", content: line }],
	});

	// response.content is a list of blocks.
	// Print the text of each text block.
	for (const block of response.content) {
		if (block.type === "text") {
			console.log(block.text);
		}
	}
}
