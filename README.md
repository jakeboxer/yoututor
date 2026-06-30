# YouTutor

A command-line tutor for YouTube videos. Give it a video URL, then ask questions about specific moments — *"at 4:30 they mention a 'commit graph', what does that look like?"* — and it answers using both the transcript around that timestamp and the actual video frames from that point.

It's built as an agentic harness: rather than running a fixed pipeline, the model decides which tools to call for each question. A purely verbal question ("wait, what did they just say about X?") only needs the transcript; a question about something on screen pulls frames too — and it can go fetch frames from a *different* timestamp than you asked at if the thing being explained was shown earlier.

## How it works

The core is an **agent loop**. The model can't take actions on its own — it can only read and emit text — so the harness gives it a set of tools and runs a back-and-forth:

1. Send the conversation so far (plus the tool list) to the model.
2. The reply is either a **tool request** or a **final answer**.
3. Final answer → done, show it to the user.
4. Tool request → the harness runs that tool, appends the result to the conversation, and goes back to step 1.

It cycles until the model stops asking for tools and just answers. A single question might take several trips through the loop (transcript → frames → answer), with the model choosing what it needs at each step.

## Tools

The model drives these; it isn't a hardcoded sequence. Timestamps throughout — both tool arguments and transcript output — use clock format: `mm:ss` or `h:mm:ss`, optionally with fractional seconds (e.g. `0:45.2`).

| Tool | What it does |
| --- | --- |
| `load_video(url)` | Fetches the timestamped transcript for the video (see below) and prepares it for querying. Auto-called on the initial URL. |
| `get_transcript_range(start_timestamp, end_timestamp)` | Returns the transcript text between two timestamps. The model picks the start and end, so it controls the span; widen it for more context, or ask for an asymmetric window like the run-up to a moment. |
| `get_frames(timestamps)` | Extracts a frame at each requested timestamp (via ffmpeg) and returns them as images for the model to look at. The model picks the exact timestamps, so it controls granularity — spread them out to track change over time, or cluster them on one moment. |

### Transcripts: captions-first, ASR fallback

`load_video` tries the video's existing captions first (via yt-dlp) — they're instant. If captions are missing or low quality, it falls back to transcribing the audio itself with a Whisper-class model. This keeps loading fast in the common case while staying robust when captions don't exist.

## Architecture

The design goal is a clean separation between the **agent loop** (talk to the model, run tools) and the **interface** (how the human sees output and provides input). The loop knows nothing about the UI — it imports neither `readline` nor `ink`.

This works through two channels:

- **Output** — the loop is an async generator that `yield`s semantic events (`textDelta`, `modelResponded`, `toolRunStarted`, `toolRunFinished`, `turnComplete`). The interface consumes them with a `for await` and renders however it likes.
- **Input** — when the loop needs something back (the next user turn, or permission to run a tool), it `await`s a method on an injected `Host` port. The host owns *displaying* the prompt as well as returning the answer, so the loop stays unaware of how input is gathered.

```ts
for await (const ev of agent.run(userText)) {
  renderer.handle(ev);   // console: write to stdout; Ink: push into React state
}
```

Capabilities (`load_video` / `get_transcript_range` / `get_frames`) live behind a separate `ToolRegistry` port, kept distinct from `Host` — human interaction and tool execution are different concerns.

The payoff: swapping the bare-bones console interface for a richer Ink UI is a substitution at the edges, with no changes to the loop.

## Tech stack

- **TypeScript** — the whole harness.
- **Anthropic API** — the model behind the loop.
- **yt-dlp** — caption/transcript download.
- **ffmpeg** — frame extraction.
- **whisper.cpp** (or a hosted ASR endpoint) — transcript fallback when captions are unavailable.
- **Ink** — terminal UI layer (added after the loop is solid).

## Status & roadmap

Early development. The intended build order:

- [x] Agent loop working behind a plain console interface (`readline` in, `console.log` out)
- [ ] `ToolRegistry` with the three tools — `load_video` + `get_frames` done; `get_transcript_range` pending
- [ ] `load_video` with captions-first / ASR-fallback transcript handling — captions-first done; ASR fallback pending
- [x] Multimodal frame results fed back into the loop
- [ ] Tool-permission prompts through the `Host` port
- [ ] Ink rendering layer swapped in on top

The loop and tool orchestration come first; the Ink UI is layered on last so the core is solid before the interface gets fancy.

## Usage

> Early development, but the console loop runs today.

Needs `yt-dlp` and `ffmpeg` on your `PATH`, plus an `ANTHROPIC_API_KEY` in `.env` (Bun loads it automatically).

```sh
bun install
bun src/index.ts <youtube-url>
```

It loads the transcript up front, then you ask questions referencing timestamps as you watch. Type `/exit` to quit.
