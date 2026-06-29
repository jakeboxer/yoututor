// Semantic events the loop emits. A renderer consumes these and decides how to display them.
// Add new variants as the loop grows.

export type AgentEvent = { type: "text"; text: string };
