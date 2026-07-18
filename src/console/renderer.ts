import type { AgentEvent } from "../agent/agent-event.ts";

// Output-port consumer (implemented by console and Ink renderers).
export type Renderer = { handle(event: AgentEvent): void };
