# Someday / open questions

Ideas deferred from the Ink integration walkthroughs. None of these are planned work; each is a "revisit when the need actually arises," recorded with the reasoning so it doesn't have to be re-derived.

- **Hooks-driven state**: `InkApp`'s imperative mutate-then-`rerender()` driver was chosen as the minimal proof surface. If the UI grows real interactivity (scrolling, focus, multiple panes), consider inverting: state lives in the component (`useState`/`useReducer`), and `InkApp` shrinks to an event-forwarding shell. Don't do this preemptively, the imperative driver is simpler while the component stays a pure projection.

- **Richer event vocabulary**: a fancier UI may want events the loop doesn't emit yet (e.g. turn boundaries, tool progress). That's an `AgentEvent` design question, not an Ink one; extend the union deliberately, not per-widget.

- **Graceful mid-turn abort**: there's currently no way to stop a turn without killing the session. The trigger would be **Esc**: cancel the in-flight model/tool call and reprompt. Needs cancellation (AbortController) plumbed through the agent loop, so it's a loop design question, not a UI one.
