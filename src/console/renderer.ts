import type { AgentEvent } from "../agent/agent-event.ts";

// Output-port consumer (implemented by console and Ink renderers). unmount is for renderers that
// take over the terminal (Ink claims stdout and raw-mode stdin) and must give it back on shutdown;
// renderers that just write lines leave it undefined.
export type Renderer = { handle(event: AgentEvent): void; unmount?(): void };
