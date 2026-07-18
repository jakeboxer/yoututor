import { Box, type Instance, render, Text } from "ink";
import type { AgentEvent } from "../agent/agent-event.ts";
import type { Renderer } from "./renderer.ts";

type AppViewProps = { lines: string[]; current: string };

function AppView(props: AppViewProps) {
	return (
		<Box flexDirection="column">
			{props.lines.map((line, index) => (
				// biome-ignore lint/suspicious/noArrayIndexKey: append-only log, entries never reorder
				<Text key={index}>{line}</Text>
			))}
			{props.current !== "" && <Text>{props.current}</Text>}
		</Box>
	);
}

export class InkApp implements Renderer {
	private lines: string[] = [];
	private current = "";
	private ink: Instance;

	constructor() {
		this.ink = render(this.buildView());
	}

	handle(event: AgentEvent): void {
		switch (event.type) {
			// Write each chunk with no trailing newline, so the answer builds up on one line as it
			// streams in.
			case "textDelta":
				this.current += event.text;
				break;
			// Reply finished: push the streamed line to the list of previous lines so the next output (a
			// tool line or the input prompt) starts fresh. No-op when the reply had no text (e.g a pure
			// tool call).
			case "modelResponded": {
				const trimmedCurrent = this.current.trim();

				if (trimmedCurrent !== "") {
					this.lines.push(trimmedCurrent);
				}

				this.current = "";
				break;
			}
			// The event carries the full input/result; the renderer chooses a compact display.
			case "toolRunStarted":
				this.lines.push(`⚙ ${event.name} ${JSON.stringify(event.input)}`);
				break;
			case "toolRunFinished":
				this.lines.push(`✓ ${event.name}`);
				break;
		}

		this.ink.rerender(this.buildView());
	}

	unmount(): void {
		this.ink.unmount();
	}

	private buildView() {
		return <AppView lines={this.lines} current={this.current} />;
	}
}
