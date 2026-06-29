import Agent from "./agent/agent.ts";
import { consoleHost } from "./console/console-host.ts";
import { ConsoleRenderer } from "./console/console-renderer.ts";
import { toolRegistry } from "./tools/registry.ts";

// The YouTube URL to tutor on is required as the first CLI argument.
const videoUrl = Bun.argv[2];
if (!videoUrl) {
	console.error("Usage: bun src/index.ts <youtube-url>");
	process.exit(1);
}

console.log(`Tutoring on: ${videoUrl}`);

// Drive the agent, handing each event to the renderer as it arrives.
const renderer = new ConsoleRenderer();
for await (const event of new Agent(consoleHost, toolRegistry, videoUrl).run()) {
	renderer.handle(event);
}
