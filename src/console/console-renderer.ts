import type { AgentEvent } from "../agent/agent-event.ts";
import type { Renderer } from "./renderer.ts";

// Console renderer: decides how to display each event the agent emits. The caller owns the event
// loop and feeds events in one at a time, so the renderer is free to accumulate state across calls
// (e.g. tracking an in-progress tool run) without owning iteration.
export class ConsoleRenderer implements Renderer {
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
				if (event.display !== undefined) {
					console.log(event.display);
				}

				console.log(`✓ ${event.name}`);
				break;
			// The API's `input` counter is only the uncached remainder, so the headline input number is
			// the sum of all three input-side buckets. Cache write before read: tokens are written on
			// the request that first sends them, read back on the requests after.
			case "stats":
				console.log(
					`tokens: ` +
						`input ${event.usage.input + event.usage.cacheWrite + event.usage.cacheRead} ` +
						`(uncached ${event.usage.input} · ` +
						`cache write ${event.usage.cacheWrite} · ` +
						`cache read ${event.usage.cacheRead}) · ` +
						`output ${event.usage.output}`,
				);
				break;
			// The turn failed: close the streamed line first (a mid-stream drop leaves partial text
			// unterminated), then report the error and let the loop return to the prompt.
			case "error":
				if (this.midLine) {
					process.stdout.write("\n");
					this.midLine = false;
				}

				console.log(`✗ ${event.message}`);
				break;
		}
	}
}
