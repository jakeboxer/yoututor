import Agent from "./agent/agent.ts";
import { InkApp } from "./console/ink-app.tsx";
import { createToolRegistry } from "./tools/registry.ts";

// The YouTube URL to tutor on is required as the first CLI argument.
const videoUrl = Bun.argv[2];
if (!videoUrl) {
	console.error("Usage: bun src/index.ts <youtube-url>");
	process.exit(1);
}

console.log(`Tutoring on: ${videoUrl}`);

const host = new InkApp();
const renderer = host;

// Uncomment this to use the bare console host/renderer instead of Ink.
// const host = consoleHost;
// const renderer = new ConsoleRenderer();

// Drive the agent, handing each event to the renderer as it arrives.
for await (const event of new Agent(host, createToolRegistry(videoUrl), videoUrl).run()) {
	renderer.handle(event);
}

// Give back the control that Ink's raw-mode stdin subscription takes.
host.unmount();
