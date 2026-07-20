// Semantic events the loop emits. A renderer consumes these and decides how to display them.
// Add new variants as the loop grows.

export type AgentEvent =
	// A chunk of the model's answer text, streamed as it's generated (not the whole answer at once).
	| { type: "textDelta"; text: string }

	// The model finished one reply (it may have streamed text and/or requested tools). A renderer
	// uses this to close the current line of streamed text before printing anything else.
	| { type: "modelResponded" }

	// The loop is about to run a tool the model requested. Emitted BEFORE execution, so a
	// renderer can show a "running..." indicator while a slow tool (e.g. a real yt-dlp fetch) runs.
	| { type: "toolRunStarted"; name: string; input: unknown }

	// The tool finished. Carries a human-readable summary of the result (image blocks collapse to
	// placeholders); the renderer decides how much to show. `display` is presentation-ready art (e.g.
	// an ASCII thumbnail) the renderer may print verbatim; it is never part of the conversation the
	// model sees.
	| { type: "toolRunFinished"; name: string; result: string; display?: string };
