import type { AgentEvent } from "../agent/agent-event.ts";

// Console renderer: decides how to display each event the agent emits. The caller owns the event
// loop and feeds events in one at a time, so the renderer is free to accumulate state across calls
// (e.g. tracking an in-progress tool run) without owning iteration. When a shared Renderer
// interface lands — implemented by this and an Ink renderer — `handle` is the method it'll define.
export class ConsoleRenderer {
	handle(event: AgentEvent): void {
		switch (event.type) {
			case "text":
				console.log(event.text);
				break;
			// The event carries the full input/result; the renderer chooses a compact display.
			case "toolRunStarted":
				console.log(`⚙ ${event.name} ${JSON.stringify(event.input)}`);
				break;
			case "toolRunFinished":
				console.log(`✓ ${event.name}`);
				break;
		}
	}
}
