import Agent from "./agent/agent.ts";
import type { Host } from "./agent/host.ts";
import { consoleHost } from "./console/console-host.ts";
import { ConsoleRenderer } from "./console/console-renderer.ts";
import { InkApp } from "./console/ink-app.tsx";
import type { Renderer } from "./console/renderer.ts";
import { createToolRegistry } from "./tools/registry.ts";

// CLI args
const args = Bun.argv.slice(2);

// An optional YouTube URL to tutor on. Without a URL, the session starts videoless and the agent
// loads a video when the user shares a link in chat.
const videoUrl = args.find((arg) => !arg.startsWith("--"));

// An optional --console flag to use the bare console host/renderer instead of Ink.
const useConsole = args.includes("--console");

if (videoUrl) {
	console.log(`Tutoring on: ${videoUrl}`);
} else {
	console.log("No video URL given. Paste a YouTube link in chat to load one.");
}

let host: Host;
let renderer: Renderer;

if (useConsole) {
	host = consoleHost;
	renderer = new ConsoleRenderer();
} else {
	const ink = InkApp.mount();
	host = ink;
	renderer = ink;
}

// Drive the agent, handing each event to the renderer as it arrives.
for await (const event of new Agent(host, createToolRegistry(), videoUrl).run()) {
	renderer.handle(event);
}

// Give back the control the renderer took over the terminal (Ink's raw-mode stdin subscription).
renderer.unmount?.();
