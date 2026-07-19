---
type: Project Guide
title: Score Shield quickstart
description: "Engineer entry point for Score Shield: its spoiler-free score-timeline product, local development workflow, runtime boundaries, and documentation map."
resource: /README.md
tags: [score-shield, onboarding, spoiler-free-video, node, react]
---

# Score Shield quickstart

Score Shield is a reference implementation for spoiler-free sports playback. It turns an authorized YouTube recording into a **time-bounded score timeline**: sampled broadcast frames are read by a vision model, deterministic code confirms plausible score states, and a React player renders only the state at its current playhead. The original video is unchanged; the generated metadata is the spoiler-control layer.

The system deliberately has two runtimes:

- a Cloudflare-compatible React/Vinext interface that can host the product shell and an interactive demo; and
- a local Node processor that needs `yt-dlp`, FFmpeg/FFprobe, writable artifacts, and an OpenAI API key.

The processor’s job and media flow is documented in [Architecture overview](architecture/overview.md); the score-safety rules and artifact format have their canonical explanation in [Score timeline workflow](workflows/score-timeline.md).

## Start locally

**Prerequisite:** Node.js 22.13+ (`package.json`). Do not read or commit the local `.env`; use the placeholder contract in `.env.example`.

```bash
npm run setup        # Installs npm dependencies; may install missing system media tools; creates .env if absent
# Add OPENAI_API_KEY to .env for real analysis
npm run dev          # Starts UI at :3000 and processor at :8787
```

Open `http://localhost:3000`; check the processor at `http://localhost:8787/health`. The landing page can run its fixed interactive demo without processor access or an API key. `npm run setup` can invoke a package manager (and potentially `sudo` on Linux), so use `npm run setup:check` for a read-only diagnostic or `node scripts/setup.mjs --dry-run` to see prospective commands first. See [Operations and integrations](operations-and-integrations.md) for configuration and recovery notes.

## Product invariants

These rules are stated in `AGENTS.md` and implemented across `app/page.tsx` and `server/pipeline.mjs`:

1. Do not reveal a future score, scorer, event, or final result in user-visible text, metadata, labels, or debug output before its cue is active.
2. Do not fetch or display the source YouTube title in the product UI.
3. Resolve score state from current media time: backward seeks restore an earlier cue; forward seeks resolve the cue at the destination.
4. Treat model output as candidate observations; deterministic reconciliation decides what becomes a cue.
5. Keep real media processing local unless a target environment explicitly supports its process, storage, secret, and long-running-job needs.
6. Process only media the operator is authorized to download and analyze.

The browser title currently changes to the active, playhead-derived score. That preserves the timeline rule but is a deliberate surface to reassess if observers, tab previews, or screen sharing are part of the threat model.

## Documentation map

- [Architecture overview](architecture/overview.md) — request/data flow, processor API and SSE, deployment split, artifact lifecycle, and present security boundary.
- [Score timeline workflow](workflows/score-timeline.md) — frame-to-observation-to-cue logic, WebVTT/manifest outputs, UI synchronization, and safe change rules.
- [Operations and integrations](operations-and-integrations.md) — setup script behavior, configuration variables, external tools/services, deployment scaffolding, and the scheduled documentation workflow.
- [Testing and source map](testing-and-source-map.md) — test commands, covered behavior, change-based checks, primary source files, and recent repository evolution.

## Working-tree and history context

The repository’s first substantial implementation was added in `c7254c8` (processor, hosted UI, pipeline, and tests). The latest committed change, `8397dc6`, made the demo reflect FRA–ENG timeline data, added cross-platform setup support and its tests, and strengthened the rendered-shell assertion. During documentation discovery, `README.md`, `AGENTS.md`, and `package.json` had local modifications, while the wiki and documentation automation were not yet tracked. Treat repository-local guidance as potentially in-progress and avoid overwriting it during runtime work.

## Backlog

- **Public processor hardening** — `server/index.mjs`, `server/pipeline.mjs`: public deployment architecture, authentication/job ownership, quotas, cancellation, durable job state, and artifact cleanup are not implemented, so this wiki documents the current local-only boundary rather than a production runbook.
- **Database-backed workflows** — `db/schema.ts`, `.openai/hosting.json`: Drizzle/D1 support is scaffolded but has no schema or configured binding; document it further only when the product starts persisting data.
