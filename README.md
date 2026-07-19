# Score Shield

Score Shield is a Node.js and React reference implementation for spoiler-free sports playback. It downloads an authorized YouTube source, samples frames with FFmpeg, asks a vision model to read the broadcast scoreboard, reconciles observations into verified states, and exports a WebVTT metadata track. The React player keeps its title synchronized with the score at the viewer's current playhead.

## Requirements

- Node.js 22.13 or newer
- `ffmpeg` and `ffprobe` on `PATH`
- `yt-dlp` on `PATH`
- An OpenAI API key for real scoreboard analysis

## Run locally

Copy `.env.example` to `.env`, provide `OPENAI_API_KEY`, then run:

```bash
npm install
npm run dev
```

The React app runs at `http://localhost:3000`; the Node processor runs at `http://localhost:8787`. The recommended test source is prefilled:

```text
https://www.youtube.com/watch?v=jIrmswHtg9E
```

Only download and analyze media you are authorized to process. If the local processor or API key is unavailable, use **Preview the experience** to exercise the complete progress and spoiler-free playback UI without making model calls.

## Generated artifacts

Each job writes to `artifacts/<job-id>/`:

- `source.*` — downloaded source video
- `frames/` — timestamped analysis frames
- `observations.json` — raw AI readings
- `manifest.json` — reconciled score timeline
- `score.vtt` — timed metadata track

## Commands

```bash
npm run dev          # web app and processor
npm run dev:web      # web app only
npm run processor    # processing API only
npm run test:unit    # timeline and VTT tests
npm run build        # production web build
```
