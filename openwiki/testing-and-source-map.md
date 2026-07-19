---
type: Engineering Guide
title: Testing guidance and source map
description: "Change-oriented verification guidance and a concise map of the Score Shield UI, processor, deployment, setup, and persistence scaffolding."
resource: "/tests"
tags: [testing, source-map, quality, development]
---

# Testing guidance and source map

Use this page to locate a change and select the smallest meaningful verification set. The system’s high-risk behavior is the deterministic score timeline documented in [Score timeline workflow](workflows/score-timeline.md); the integrated UI/processor boundary is documented in [Architecture overview](architecture/overview.md).

## Verification commands

| Command | What it does | Use when |
| --- | --- | --- |
| `npm run test:unit` | Runs Node tests for reconciliation/VTT and setup install plans. | Fast feedback for pipeline or setup changes. |
| `npm run lint` | Runs ESLint, ignoring generated `dist` and `.next`. | Any code change, especially UI and shared types. |
| `npm run build` | Builds the Vinext/Cloudflare deployment artifact. | Hosting/build checks only; it does not exercise media processing. |
| `npm test` | Runs unit tests, production build, then the rendered Worker HTML test. | Required before handoff for UI, build, metadata, hosting, or shared changes. |
| `npm run setup:check` | Validates Node/media prerequisites without installation. | Setup/package-manager edits and local environment diagnosis. |

`AGENTS.md` asks for `npm run test:unit` plus lint for pipeline/reconciliation/VTT changes, and `npm test` plus lint for UI-only, build, metadata, hosting, or shared changes. Automated tests must not use a real API key or download a full video.

## Current test coverage

| Test | Evidence it protects | Not covered |
| --- | --- | --- |
| `tests/pipeline.test.mjs` | Duplicate readings, a score regression, cue intervals, and basic VTT time/JSON formatting. | Download/probe/extract, OpenAI behavior, malformed model output, API/SSE, persistence, and many reconciliation edge cases. |
| `tests/setup.test.mjs` | Homebrew aggregation, apt plan shape, and separate Winget identifiers. | Real package installation and manager detection. |
| `tests/rendered-html.test.mjs` | Built Worker returns the expected score-safe landing shell and FRA/ENG demo content, without template residue. | Client interactions, EventSource failures, iframe playback messages, and responsive/accessibility behavior. |

When changing pipeline safety logic, add regression cases for confidence thresholds, absent scoreboards, malformed observations, team/score transitions, and cue boundary behavior. When changing the API or player flow, add coverage for unsupported URLs, stage payload compatibility, failed/stalled SSE, and cancellation semantics before treating the interface as production-ready.

## Source map

| Area | Primary files | Start here when changing |
| --- | --- | --- |
| Product UI, demo, player, SSE client | `app/page.tsx`, `app/globals.css`, `app/layout.tsx` | Spoiler-visible strings, active-cue behavior, browser title, iframe cover, progress presentation, responsive/a11y work. |
| Processor HTTP boundary | `server/index.mjs` | URL validation, CORS, job records, artifact endpoint behavior, SSE transport. |
| Media + AI pipeline | `server/pipeline.mjs` | Subprocess calls, observation schema/prompt, reconciliation, VTT/manifest generation. |
| Local developer lifecycle | `scripts/setup.mjs`, `scripts/dev.mjs`, `.env.example`, `package.json` | Node/tool prerequisites, process orchestration, commands, and environment contract. |
| Hosted runtime/build | `worker/index.ts`, `vite.config.ts`, `build/sites-vite-plugin.ts`, `.openai/hosting.json` | Worker behavior, image transforms, bindings, packaged deployment metadata. |
| Future persistence scaffold | `db/index.ts`, `db/schema.ts`, `drizzle.config.ts`, `examples/d1/` | Only when adding a real data model; existing example code is not production-wired. |
| Documentation workflow | `.github/workflows/openwiki-update.yml`, `README.md`, `AGENTS.md` | Generated-wiki refresh behavior and contributor instructions. |

## Change paths

- **Score detection or score logic:** begin in `server/pipeline.mjs`; check the cue contract against [Score timeline workflow](workflows/score-timeline.md), run unit tests and lint, then add tests for the altered deterministic rule.
- **Submission/progress/player UI:** read `app/page.tsx` alongside `server/index.mjs`; a stage name or SSE payload alteration is an interface change. Run lint and `npm test`.
- **Local setup:** change `scripts/setup.mjs` and its unit tests together. Preserve the distinction between diagnostic `--check`, non-mutating `--dry-run`, and install-capable default setup.
- **Hosting or asset behavior:** start at `vite.config.ts` and `worker/index.ts`; run the full test command because the rendered HTML test imports `dist/server/index.js` after the production build.
- **Database work:** establish a real schema, migration, and `.openai/hosting.json` binding before using `getDb()` in a product path; do not mistake `examples/d1/` for wired functionality.

## Recent evolution

The initial product implementation (`c7254c8`) added the UI, local processor, media/AI pipeline, Cloudflare build path, starter Drizzle files, and tests. The latest commit (`8397dc6`) replaced generic demo teams with a FRA–ENG score timeline, added the cross-platform setup script and tests, and tightened rendered-shell assertions. This evolution explains why setup and the static demo deserve coverage even though the core processor code predates them.

The working tree includes uncommitted documentation-related changes (`README.md`, `AGENTS.md`, `package.json`) and untracked automation/docs files. Account for those local changes when editing contributor guidance; do not overwrite them as part of runtime work.
