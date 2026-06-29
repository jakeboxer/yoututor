import type { Host } from "../agent/host.ts";

// Console host: owns reading input from the terminal. The loop calls this when it needs the
// user's next turn; we wrap Bun's blocking prompt() and hand back the line (null on Ctrl+D).
export const consoleHost: Host = {
	async requestInput() {
		return prompt(">");
	},
};
