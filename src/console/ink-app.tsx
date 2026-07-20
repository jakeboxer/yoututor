import { Box, type Instance, render, Static, Text, useInput } from "ink";
import TextInput from "ink-text-input";
import { type ReactElement, useState } from "react";
import type { AgentEvent } from "../agent/agent-event.ts";
import type { Host } from "../agent/host.ts";
import BlockBuffer from "./block-buffer.ts";
import LogLineView, { type LogLine } from "./log-line-view.tsx";
import type { Renderer } from "./renderer.ts";
import Spinner from "./spinner.tsx";

// Custom types for Ink's render function and the parts of Ink's Instance type that we use so we can
// mock them in tests.
type InkInstance = Pick<Instance, "rerender" | "clear" | "unmount">;
type InkRender = (tree: ReactElement) => InkInstance;

type AppViewProps = {
	lines: LogLine[];
	awaitingInput: boolean;
	activity: string;
	onSubmit: (text: string) => void;
	onEof: () => void;
	onInterrupt: () => void;
};

function AppView(props: AppViewProps) {
	const [value, setValue] = useState("");

	useInput((input, key) => {
		if (!key.ctrl) return;

		switch (input) {
			case "c":
				props.onInterrupt();
				break;
			case "d":
				if (props.awaitingInput) {
					props.onEof();
				}

				break;
		}
	});

	return (
		<>
			<Static items={props.lines}>
				{(line, index) => <LogLineView key={index} line={line} />}
			</Static>
			<Box flexDirection="column">
				{!props.awaitingInput && (
					<Text dimColor>
						<Spinner /> {props.activity}
					</Text>
				)}
				{props.awaitingInput && (
					<Box>
						<Text>
							{"> "}
							<TextInput
								value={value}
								onChange={setValue}
								onSubmit={() => {
									props.onSubmit(value);
									setValue("");
								}}
							/>
						</Text>
					</Box>
				)}
			</Box>
		</>
	);
}

// We pass exitOnCtrlC: false because we want to make Ctrl+C exit immediately.
//
// By default, Ink handles the exit by just unmounting the UI, leaving the process stuck forever on
// the pending requestInput promise.
const defaultRender: InkRender = (tree) => render(tree, { exitOnCtrlC: false });
const THINKING_LABEL = "Thinking...";

export class InkApp implements Renderer, Host {
	private ink: InkInstance;

	private lines: LogLine[] = [];
	private buffer = new BlockBuffer();

	// Stashed when requestInput is called, resolved when the user sends input.
	private inputResolver: ((value: string | null) => void) | null = null;

	private activity = THINKING_LABEL;

	private constructor(renderFn: InkRender) {
		this.ink = renderFn(this.buildView());
	}

	/**
	 * Mount the Ink app and render the initial empty view.
	 * @param renderFn Function to use for rendering. Uses Ink's render() by default, but can be
	 * overridden for testing.
	 * @returns The mounted Ink app.
	 */
	static mount(renderFn: InkRender = defaultRender): InkApp {
		return new InkApp(renderFn);
	}

	handle(event: AgentEvent): void {
		switch (event.type) {
			// Add the text chunk to the block buffer and output any newly-completed blocks.
			case "textDelta": {
				const resultBlocks = this.buffer.push(event.text);

				for (const block of resultBlocks) {
					this.appendReplyBlock(block);
				}

				break;
			}

			// Reply finished: flush the block buffer and treat any remaining text as the final block of
			// the response.
			case "modelResponded": {
				const block = this.buffer.flush();

				if (block !== null) {
					this.appendReplyBlock(block);
				}

				this.buffer = new BlockBuffer();
				break;
			}

			// The event carries the full input/result; the renderer chooses a compact display.
			case "toolRunStarted":
				this.activity = `Running ${event.name}`;
				this.appendLine({
					kind: "toolStart",
					text: `⚙ ${event.name} ${JSON.stringify(event.input)}`,
				});
				break;

			case "toolRunFinished":
				this.activity = THINKING_LABEL;
				this.appendLine({ kind: "toolDone", text: `✓ ${event.name}` });
				break;
		}

		this.rerender();
	}

	requestInput(): Promise<string | null> {
		return new Promise((resolve) => {
			this.inputResolver = resolve;
			this.rerender();
		});
	}

	unmount(): void {
		this.ink.clear();
		this.ink.unmount();
	}

	private buildView() {
		return (
			<AppView
				lines={this.lines}
				awaitingInput={this.isAwaitingInput()}
				activity={this.activity}
				onSubmit={(text) => this.submitInput(text)}
				onEof={() => this.submitEof()}
				onInterrupt={() => this.interrupt()}
			/>
		);
	}

	private rerender() {
		this.ink.rerender(this.buildView());
	}

	private submitInput(text: string) {
		if (this.inputResolver === null) return;
		if (text.trim() === "") return;

		const resolver = this.inputResolver;

		// We append the un-trimmed text here to visually preserve exactly what the user typed.
		this.appendLine({ kind: "echo", text: `> ${text}` });

		this.inputResolver = null;
		this.rerender();

		resolver(text);
	}

	private submitEof() {
		if (this.inputResolver === null) return;

		const resolver = this.inputResolver;
		this.inputResolver = null;
		this.rerender();

		resolver(null);
	}

	private interrupt() {
		this.unmount();

		// Shell convention for "killed by Ctrl+C" (128 + SIGINT's signal number 2).
		// With this, anything scripting around this CLI can tell "user bailed" from "exited normally".
		process.exit(130);
	}

	private isAwaitingInput(): boolean {
		return this.inputResolver !== null;
	}

	private appendLine(line: LogLine) {
		this.lines = [...this.lines, line];
	}

	private appendReplyBlock(block: string) {
		const logLine: LogLine = { kind: "reply", text: block };

		const prev = this.lines[this.lines.length - 1];

		// If there's another reply block above this one, add a gap between them so they aren't jammed
		// together.
		if (prev?.kind === "reply") {
			logLine.gapAbove = true;
		}

		this.appendLine(logLine);
	}
}
