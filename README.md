# Score Shield

Score Shield is a Node.js and React reference implementation for spoiler-free sports playback. It downloads an authorized YouTube video, samples timestamped frames, uses AI to read the broadcast scoreboard, reconciles those observations into a reliable score timeline, and exports a WebVTT metadata track. The player uses the metadata to show only the score at the viewer's current playhead.

The hosted interface and interactive demo are available at [score-shield-sports.shazron.chatgpt.site](https://score-shield-sports.shazron.chatgpt.site). Real video processing runs locally because it requires FFmpeg, `yt-dlp`, filesystem access, and an OpenAI API key.

## Why?

Watching a recorded match should still feel live. Fans often avoid news, social media, and messages until they have time to watch, only to have the result revealed by the streaming page itself. A title such as `England vs France 6–4 — World Cup 2026` gives away the final score before the viewer presses play. Even a title that only names the winner can remove most of the suspense.

The problem also affects games watched across multiple sessions. Streaming services such as YouTube can remember the playhead and resume a video where the viewer stopped. If someone pauses at halftime and returns later, the platform may put them back at the correct moment while still surrounding the player with a title, thumbnail, description, or recommendation based on the completed match. The playback position is preserved, but the viewing experience has already been spoiled.

Score Shield treats the title as part of the playback experience instead of permanent text. The generated metadata track records how the score changes over time, allowing the interface to show only what was known at the viewer's current position. Starting from the beginning shows the opening score; resuming midway shows the score at that moment; seeking backward restores an earlier state; and seeking forward updates only after the destination is reached.

This approach gives streaming providers a practical way to preserve suspense without maintaining a separate spoiler-free edit of every game. The original video stays unchanged, while a small sidecar or embedded metadata track controls spoiler-safe titles, score displays, chapter labels, and future highlight experiences.

## Access the preview directly

Open the public preview in any modern browser:

**[Open the Score Shield preview](https://score-shield-sports.shazron.chatgpt.site)**

No ChatGPT login is required, so the link can be shared directly with demo viewers. On the landing screen, select **Preview the experience** to run the built-in FRA vs ENG demonstration and see the protected title and score update as playback advances or the timeline is scrubbed.

The hosted preview uses public demonstration data and does not run the video-processing worker. To analyze a YouTube video and generate a new score timeline, follow [Prepare a development machine](#prepare-a-development-machine), [Configure AI analysis](#configure-ai-analysis), and [Run locally](#run-locally) below.

## How it works

```text
YouTube URL
  → authorized local download with yt-dlp
  → FFprobe media inspection
  → timestamped frame sampling with FFmpeg
  → scoreboard reading with an OpenAI vision model
  → deterministic score-state reconciliation
  → manifest.json and score.vtt
  → React player synchronized to the current playhead
```

The AI produces candidate observations. Deterministic application code decides which observations become confirmed score states, rejects likely regressions and replay graphics, and builds contiguous WebVTT cues.

## Prerequisite

Install Node.js 22.13 or newer from the [official Node.js download page](https://nodejs.org/en/download). Choose an LTS release unless you have a reason to use the current release. The Node.js installer includes `npm`, so there is no separate npm download.

After installation, open a new terminal and verify both commands are available:

```bash
node --version
npm --version
```

The setup command below can install the remaining project and media dependencies, but it cannot install Node.js because `npm` itself requires Node. For version-manager and platform-specific options, see npm's official [Node.js and npm installation guide](https://docs.npmjs.com/downloading-and-installing-node-js-and-npm/).

## Prepare a development machine

Run:

```bash
npm run setup
```

This command:

- verifies the Node.js version;
- installs npm packages;
- detects and installs FFmpeg, FFprobe, and `yt-dlp` when missing;
- creates `.env` from `.env.example` without overwriting an existing file; and
- verifies that the required media commands are on `PATH`.

Supported package managers:

| Platform | Package managers |
| --- | --- |
| macOS | Homebrew |
| Linux | Homebrew, apt, dnf, pacman |
| Windows | Winget, Chocolatey |

Linux system package installation may request `sudo`. On Windows, restart the terminal after installation if newly installed commands are not immediately visible on `PATH`.

Useful preparation modes:

```bash
npm run setup:check              # Verify without installing anything
node scripts/setup.mjs --dry-run # Show the commands without running them
```

## Configure AI analysis

After setup, add an API key to `.env`:

```dotenv
OPENAI_API_KEY=your_key_here
```

Available configuration:

| Variable | Default | Purpose |
| --- | --- | --- |
| `OPENAI_API_KEY` | none | Required for real scoreboard analysis |
| `OPENAI_MODEL` | `gpt-5.6` | Vision-capable model used for frame analysis |
| `FRAME_INTERVAL_SECONDS` | `20` | Sampling interval; lower values improve temporal precision but increase cost |
| `PROCESSOR_PORT` | `8787` | Local processing API port |
| `NEXT_PUBLIC_PROCESSOR_URL` | `http://localhost:8787` | Processor URL used by the React interface |
| `YTDLP_PATH` | `yt-dlp` on `PATH` | Optional executable override |
| `FFMPEG_PATH` | `ffmpeg` on `PATH` | Optional executable override |
| `FFPROBE_PATH` | `ffprobe` on `PATH` | Optional executable override |

Never commit `.env` or expose an API key in browser code.

## Run locally

Start the web app and processing API together:

```bash
npm run dev
```

- React interface: `http://localhost:3000`
- Processing API: `http://localhost:8787`
- Health check: `http://localhost:8787/health`

The UI is prefilled with this public test source:

```text
https://www.youtube.com/watch?v=jIrmswHtg9E
```

Only download and analyze media you are authorized to process. If the processor or API key is unavailable, choose **Preview the experience** to exercise the progress and protected-player flows without downloading the video or making model calls.

## Processing progress

The processor reports structured progress through Server-Sent Events:

```text
downloading → extracting → analyzing → reconciling → exporting → complete
```

The React interface displays the active stage, stage percentage, overall percentage, elapsed time, estimated remaining time when available, and analyzed frame counts. A failed job remains visible with a useful error instead of silently disappearing.

## API

| Method | Endpoint | Purpose |
| --- | --- | --- |
| `GET` | `/health` | Processor health check |
| `POST` | `/api/jobs` | Start a job with `{ "sourceUrl": "https://…" }` |
| `GET` | `/api/jobs/:id` | Get a job snapshot |
| `GET` | `/api/jobs/:id/events` | Stream progress using Server-Sent Events |
| `GET` | `/api/jobs/:id/manifest` | Download the completed JSON timeline |
| `GET` | `/api/jobs/:id/score.vtt` | Download the WebVTT metadata track |

The API accepts HTTPS YouTube and `youtu.be` URLs only. Jobs are currently stored in memory, so processor restarts discard job status while generated files remain on disk.

## Generated artifacts

Each job writes to `artifacts/<job-id>/`:

| Artifact | Description |
| --- | --- |
| `source.*` | Downloaded source video |
| `frames/` | Timestamped frames sent for analysis |
| `observations.json` | Raw, validated AI observations |
| `manifest.json` | Reconciled score timeline and evidence references |
| `score.vtt` | Time-aligned score metadata track |

The `artifacts/` directory is ignored by Git and may contain large or copyrighted media. Remove job directories manually when they are no longer needed.

## Project structure

```text
app/                    React interface and styling
server/index.mjs        Local HTTP API and SSE job progress
server/pipeline.mjs     Download, sampling, AI analysis, reconciliation, export
scripts/dev.mjs         Starts the web app and processor together
scripts/setup.mjs       Cross-platform dependency preparation
tests/                  Pipeline, setup, and rendered-page tests
public/                 Static assets and social preview
.openai/hosting.json    Hosted demo configuration
```

## Commands

```bash
npm run setup        # Install and verify local dependencies
npm run setup:check  # Verify dependencies without changing anything
npm run dev          # Start the web app and processor
npm run dev:web      # Start only the React web app
npm run processor    # Start only the local processing API
npm run test:unit    # Run timeline, WebVTT, and setup tests
npm test             # Run unit tests, production build, and rendered-page test
npm run lint         # Run ESLint
npm run build        # Build the hosted React experience
npm run wiki:init    # Generate the initial OpenWiki repository documentation
npm run wiki:update  # Refresh OpenWiki documentation non-interactively
```

## OpenWiki documentation

[OpenWiki](https://github.com/langchain-ai/openwiki) can generate agent-oriented repository documentation under `openwiki/`. Install the pinned CLI version, ensure `OPENAI_API_KEY` is configured in `.env`, and then generate the first version locally:

```bash
npm install --global openwiki@0.2.0
npm run wiki:init
```

The workflow at `.github/workflows/openwiki-update.yml` runs daily and can also be started manually from the GitHub Actions tab. It refreshes the wiki and opens or updates a `docs: update OpenWiki` pull request rather than writing directly to the default branch.

Before running the workflow, add `OPENAI_API_KEY` as a GitHub Actions repository secret under **Settings → Secrets and variables → Actions**. Under **Settings → Actions → General → Workflow permissions**, also allow GitHub Actions to create pull requests. The workflow uses OpenAI with `gpt-5.6-terra`; change `OPENWIKI_PROVIDER`, `OPENWIKI_MODEL_ID`, and the corresponding secret if another [supported provider](https://github.com/langchain-ai/openwiki#customizing) is preferred. CI telemetry is disabled in the checked-in workflow.

## Current limitations

- The PoC targets scoreboard-based sports broadcasts and is not yet sport-specific.
- Sampling every 20 seconds favors cost over exact scoring-event timing.
- The first implementation analyzes sampled frames sequentially and does not yet cache unchanged scoreboard crops.
- A YouTube iframe may display provider-owned title or thumbnail UI that the surrounding page cannot fully control. The player covers the iframe until the viewer chooses to begin.
- Local job state is not durable across processor restarts.
- The hosted site demonstrates the interface; it does not host the FFmpeg processing worker.

## Development guidelines

Read [`AGENTS.md`](AGENTS.md) before changing the project. At minimum, run `npm run test:unit` and `npm run lint` for logic changes. Run `npm test` before handing off changes that affect the player, build configuration, metadata, or deployment output.

## Responsible use

Score Shield is a reference implementation, not a mechanism for bypassing media access controls. Process only videos you own or are authorized to download and analyze, respect the source platform's terms, and do not redistribute downloaded source media.
