import { Text } from "ink";
import { render as renderMarkdown } from "markdansi";
import BlockBuffer from "./block-buffer.ts";

export type LogLine = {
	kind:
		| "reply" // A block of reply text from the model.
		| "toolStart" // The model started a tool call.
		| "toolDone" // The model finished a tool call.
		| "echo"; // The user's submitted input, echoed into the log.

	// The text to show for the log line.
	text: string;

	// Should a gap be shown above this log line?
	// True for a "reply" log line that comes directly after another "reply" log line, so multiple
	// reply blocks don't get jammed together.
	gapAbove?: true;
};

function renderReply(markdown: string): string {
	const buffer = new BlockBuffer();
	const blocks = buffer.push(markdown);
	const trailingBlock = buffer.flush();

	if (trailingBlock !== null) {
		blocks.push(trailingBlock);
	}

	// Join the blocks into a single string. Each block is separated by a blank line.
	return blocks.map((b) => renderMarkdown(b, { wrap: false }).trim()).join("\n\n");
}

export default function LogLineView(props: { line: LogLine }) {
	switch (props.line.kind) {
		case "reply":
			return (
				<Text>
					{props.line.gapAbove ? "\n" : ""}
					{renderReply(props.line.text)}
				</Text>
			);
		case "toolStart":
			return <Text color="yellow">{props.line.text}</Text>;
		case "toolDone":
			return <Text color="green">{props.line.text}</Text>;
		case "echo":
			return <Text dimColor>{props.line.text}</Text>;
	}
}
