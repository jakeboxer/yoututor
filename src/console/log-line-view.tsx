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

export default function LogLineView(props: { line: LogLine }) {
	switch (props.line.kind) {
		case "reply":
			return <Text>{renderMarkdown(props.line.text, { wrap: false }).trim()}</Text>;
		case "toolStart":
			return <Text color="yellow">{props.line.text}</Text>;
		case "toolDone":
			return <Text color="green">{props.line.text}</Text>;
		case "echo":
			return <Text dimColor>{props.line.text}</Text>;
	}
}
