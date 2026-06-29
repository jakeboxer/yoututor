import Agent from "./agent/agent.ts";
import type { Host } from "./agent/host.ts";

// The YouTube URL to tutor on is required as the first CLI argument.
const videoUrl = Bun.argv[2];
if (!videoUrl) {
	console.error("Usage: bun src/index.ts <youtube-url>");
	process.exit(1);
}

console.log(`Tutoring on: ${videoUrl}`);

// Console host: owns reading input from the terminal. The loop calls this when it needs the
// user's next turn; we wrap Bun's blocking prompt() and hand back the line (null on Ctrl+D).
const consoleHost: Host = {
	async requestInput() {
		return prompt(">");
	},
};

// Console renderer: consume the agent's events and decide how to show them.
for await (const event of new Agent(consoleHost, videoUrl).run()) {
	if (event.type === "text") {
		console.log(event.text);
	}
}
