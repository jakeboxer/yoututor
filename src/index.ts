import Agent from "./agent/agent.ts";
import { InkApp } from "./console/ink-app.tsx";
import { createToolRegistry } from "./tools/registry.ts";

// The YouTube URL to tutor on, as an optional first CLI argument. Without one, the session starts
// videoless and the agent loads a video when the user shares a link in chat.
const videoUrl = Bun.argv[2];

if (videoUrl) {
	console.log(`Tutoring on: ${videoUrl}`);
} else {
	console.log("No video URL given. Paste a YouTube link in chat to load one.");
}

const host = new InkApp();
const renderer = host;

// Uncomment this to use the bare console host/renderer instead of Ink.
// const host = consoleHost;
// const renderer = new ConsoleRenderer();

// Drive the agent, handing each event to the renderer as it arrives.
for await (const event of new Agent(host, createToolRegistry(), videoUrl).run()) {
	renderer.handle(event);
}

// Give back the control that Ink's raw-mode stdin subscription takes.
host.unmount();
