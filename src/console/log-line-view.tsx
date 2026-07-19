import { Text } from "ink";
import { render as renderMarkdown } from "markdansi";

export type LogLine = {
	kind:
		| "reply" // A full reply from the model.
		| "toolStart" // The model started a tool call.
		| "toolDone" // The model finished a tool call.
		| "echo"; // The user's submitted input, echoed into the log.
	text: string;
};

function renderReply(markdown: string): string {
	const blocks: string[] = [];
	let current: string[] = [];
	let inCodeFence = false;

	for (const line of markdown.split("\n")) {
		// Keep track of whether or not we're in a code fence.
		if (/^\s*(```|~~~)/.test(line)) {
			inCodeFence = !inCodeFence;
		}

		if (!inCodeFence && line.trim() === "") {
			// If we hit an empty line (and we're not in a code fence), add the current block to the list
			// of blocks and start a new one.
			if (current.length) {
				blocks.push(current.join("\n"));
			}

			current = [];
		} else {
			// Add this line to the current block we're building up.
			current.push(line);
		}
	}

	if (current.length) {
		blocks.push(current.join("\n"));
	}

	// Join the blocks into a single string. Each block is separated by a blank line.
	return blocks.map((b) => renderMarkdown(b, { wrap: false }).trim()).join("\n\n");
}

export default function LogLineView(props: { line: LogLine }) {
	switch (props.line.kind) {
		case "reply":
			return <Text>{renderReply(props.line.text)}</Text>;
		case "toolStart":
			return <Text color="yellow">{props.line.text}</Text>;
		case "toolDone":
			return <Text color="green">{props.line.text}</Text>;
		case "echo":
			return <Text dimColor>{props.line.text}</Text>;
	}
}
