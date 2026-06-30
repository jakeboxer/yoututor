// Semantic events the loop emits. A renderer consumes these and decides how to display them.
// Add new variants as the loop grows.

import type { ToolResult } from "../tools/tool.ts";

export type AgentEvent =
	// A chunk of the model's answer text, streamed as it's generated (not the whole answer at once).
	| { type: "textDelta"; text: string }
	// The model finished one reply (it may have streamed text and/or requested tools). A renderer
	// uses this to close the current line of streamed text before printing anything else.
	| { type: "modelResponded" }
	// The loop is about to run a tool the model requested. Emitted BEFORE execution, so a
	// renderer can show a "running..." indicator while a slow tool (e.g. a real yt-dlp fetch) runs.
	| { type: "toolRunStarted"; name: string; input: unknown }
	// The tool finished. Carries the full result string; the renderer decides how much to show.
	| { type: "toolRunFinished"; name: string; result: ToolResult };
