---
type: Operations Runbook
title: Local operations and integrations
description: "Runbook for Score Shield setup, local process orchestration, media and AI dependencies, hosted UI configuration, and documentation automation."
resource: /scripts/setup.mjs
tags: [operations, setup, integrations, openai, cloudflare, github-actions]
---

# Local operations and integrations

Score Shield’s real processing path is intentionally local. Its required command-line media tools, filesystem artifacts, and server-side OpenAI credential are configured here and used by the [Score timeline workflow](workflows/score-timeline.md). The hosted interface is a separate Worker build described in [Architecture overview](architecture/overview.md).

## Setup and local lifecycle

| Command | Meaning | Side effects |
| --- | --- | --- |
| `npm run setup` | Runs `scripts/setup.mjs`. Validates Node 22.13+, installs npm packages, finds/installs media tools, creates `.env` if absent, then verifies tools. | Can install packages, use a system package manager, and invoke `sudo` on non-Windows Linux. |
| `npm run setup:check` | Runs setup with `--check`. | Read-only prerequisite verification; fails if required media tools are unavailable. |
| `node scripts/setup.mjs --dry-run` | Displays planned setup commands. | Does not install or create `.env`. |
| `npm run dev` | Runs `scripts/dev.mjs`. | Starts processor and UI together; signal handling stops both children. |
| `npm run processor` | Starts only `server/index.mjs` with `.env` if present. | Serves processor on loopback port 8787 unless overridden. |
| `npm run dev:web` | Starts Vinext development server. | Starts UI only. |

The setup script requires `ffmpeg`, `ffprobe`, and `yt-dlp`. It selects Homebrew on macOS; Homebrew, apt, dnf, or pacman on Linux; and Winget or Chocolatey on Windows. It deliberately uses argument arrays and `shell: false` for installer calls. `setup` leaves an existing `.env` untouched and copies `.env.example` only when absent.

## Configuration contract

`.env.example` supplies placeholders only. Keep secrets in ignored `.env`; never put an API key in `NEXT_PUBLIC_*`, browser state, fixtures, logs, or committed files.

| Variable | Default | Consumer |
| --- | --- | --- |
| `OPENAI_API_KEY` | none | Required by the local processor before frame analysis. |
| `OPENAI_MODEL` | `gpt-5.6` | OpenAI Responses model used by `server/pipeline.mjs`. |
| `FRAME_INTERVAL_SECONDS` | `20` | FFmpeg sampling cadence; lower values increase temporal precision and cost. |
| `PROCESSOR_PORT` | `8787` | Loopback listener port for `server/index.mjs`. |
| `NEXT_PUBLIC_PROCESSOR_URL` | `http://localhost:8787` | Processor base URL compiled into `app/page.tsx`. |
| `YTDLP_PATH`, `FFMPEG_PATH`, `FFPROBE_PATH` | command on `PATH` | Optional executable overrides for the processor. |
| `ARTIFACTS_DIR` | `artifacts` | Optional root for per-job source media, frames, and exported timelines. |
| `WEB_ORIGIN` | `http://localhost:3000` | CORS origin sent by the processor. |

`NEXT_PUBLIC_PROCESSOR_URL` is intentionally public configuration; it must never convey a secret. If it points to a remote processor, current code does not add authentication, quotas, ownership checks, or durable state. Treat remote use as unimplemented hardening work, not a supported deployment mode.

## External integrations and boundaries

- **YouTube:** the processor accepts only HTTPS `youtube.com`, `www.youtube.com`, and `youtu.be` URLs; `yt-dlp` downloads a no-playlist source copy. Operators are responsible for authorization and platform terms. The UI embeds YouTube with `enablejsapi=1` to observe playback time. It does not request the source video title.
- **FFmpeg and FFprobe:** used for frame extraction and duration probing. They must be available to the local processor, not merely the hosted UI.
- **OpenAI:** used only server-side through the JavaScript SDK for frame observations. Model results are validated and then reconciled deterministically; they are not directly shown as trusted events.
- **Cloudflare/Vinext:** `worker/index.ts` serves the hosted UI and Cloudflare image optimization. Vite config provides optional D1/R2 local bindings based on `.openai/hosting.json`; both are currently `null`.
- **Drizzle/D1:** `db/index.ts` can open a `DB` binding, but `db/schema.ts` has no tables. `examples/d1/` demonstrates notes persistence only; it is not wired into Score Shield.

## Troubleshooting and operational limits

| Symptom | Check |
| --- | --- |
| Setup changes more than expected | Use `npm run setup:check` or `--dry-run` before `npm run setup`; the full command can install dependencies. |
| Processor fails before analysis | Verify `yt-dlp`, FFmpeg, and FFprobe are on `PATH` with `npm run setup:check`. On Windows, restart the terminal after tool installation if needed. |
| Error says API key is required | Add `OPENAI_API_KEY` only to local `.env`, then restart the processor. The demo does not need it. |
| UI cannot connect | Run `npm run dev` or `npm run processor`; visit `/health`; verify `NEXT_PUBLIC_PROCESSOR_URL`, port, and `WEB_ORIGIN`. |
| Job vanishes after restart | Expected: jobs are stored in a process-local map. Artifacts may remain under `artifacts/<id>/`, but their HTTP routes require the restarted process to know the job. |
| Disk contains old media/frames | Expected: there is no retention task. Manually remove unneeded artifact directories, subject to local authorization and retention obligations. |

## Documentation automation

`.github/workflows/openwiki-update.yml` runs on a daily schedule and manually. It installs OpenWiki, runs `openwiki code --update --print`, and uses `peter-evans/create-pull-request` to open or update an `openwiki/update` branch PR. Its configured provider is OpenRouter with model `z-ai/glm-5.2`; it passes repository secrets by name (`OPENROUTER_API_KEY`, plus LangSmith tracing settings) and does not commit credentials.

The workflow’s PR scope includes `openwiki`, `AGENTS.md`, `CLAUDE.md`, and the workflow itself. Local equivalents are `npm run wiki:init` and `npm run wiki:update`. Generated wiki content belongs under `openwiki/`; source documentation and the agent guide remain primary evidence for changes to the runtime.
