import { Box, type Instance, render, Static, Text, useInput } from "ink";
import TextInput from "ink-text-input";
import { useState } from "react";
import type { AgentEvent } from "../agent/agent-event.ts";
import type { Host } from "../agent/host.ts";
import type { Renderer } from "./renderer.ts";

type AppViewProps = {
	lines: string[];
	current: string;
	awaitingInput: boolean;
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
			<Static items={props.lines}>{(line, index) => <Text key={index}>{line}</Text>}</Static>
			<Box flexDirection="column">
				{props.current !== "" && <Text>{props.current}</Text>}
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

export class InkApp implements Renderer, Host {
	private ink: Instance;

	private lines: string[] = [];
	private current = "";

	// Stashed when requestInput is called, resolved when the user sends input.
	private inputResolver: ((value: string | null) => void) | null = null;

	constructor() {
		// We pass exitOnCtrlC: false because we want to make Ctrl+C exit immediately.
		// By default, Ink handles the exit by just unmounting the UI, leaving the process stuck forever
		// on the pending requestInput promise.
		this.ink = render(this.buildView(), { exitOnCtrlC: false });
	}

	handle(event: AgentEvent): void {
		switch (event.type) {
			// Write each chunk with no trailing newline, so the answer builds up on one line as it
			// streams in.
			case "textDelta":
				this.current += event.text;
				break;

			// Reply finished: append the streamed line to the list of previous lines so the next output
			// (a tool line or the input prompt) starts fresh. No-op when the reply had no text (e.g a
			// pure tool call).
			case "modelResponded": {
				const trimmedCurrent = this.current.trim();

				if (trimmedCurrent !== "") {
					this.appendLine(trimmedCurrent);
				}

				this.current = "";
				break;
			}

			// The event carries the full input/result; the renderer chooses a compact display.
			case "toolRunStarted":
				this.appendLine(`⚙ ${event.name} ${JSON.stringify(event.input)}`);
				break;

			case "toolRunFinished":
				this.appendLine(`✓ ${event.name}`);
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
		this.ink.unmount();
	}

	private buildView() {
		return (
			<AppView
				lines={this.lines}
				current={this.current}
				awaitingInput={this.isAwaitingInput()}
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

		const resolver = this.inputResolver;

		this.appendLine(`> ${text}`);
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

	private appendLine(line: string) {
		this.lines = [...this.lines, line];
	}
}
