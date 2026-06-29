import type { AgentEvent } from "../agent/agent-event.ts";

// Console renderer: decides how to display each event the agent emits. The caller owns the event
// loop and feeds events in one at a time, so the renderer is free to accumulate state across calls
// (e.g. tracking an in-progress tool run) without owning iteration. When a shared Renderer
// interface lands — implemented by this and an Ink renderer — `handle` is the method it'll define.
export class ConsoleRenderer {
	// True when streamed text has been written without a terminating newline yet.
	private midLine = false;

	handle(event: AgentEvent): void {
		switch (event.type) {
			// Write each chunk with no trailing newline, so the answer builds up on one line as it
			// streams in. console.log would force a line break after every chunk.
			case "textDelta":
				process.stdout.write(event.text);
				this.midLine = true;
				break;
			// Reply finished: close the streamed line so the next output (a tool line or the input
			// prompt) starts fresh. No-op when the reply had no text (e.g. a pure tool call).
			case "modelResponded":
				if (this.midLine) {
					process.stdout.write("\n");
					this.midLine = false;
				}
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
