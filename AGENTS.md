# Score Shield Agent Guide

These instructions apply to the entire repository.

## Product intent

Score Shield is a spoiler-free sports-video reference implementation. A local Node.js worker downloads authorized media, extracts frames, obtains candidate score readings from a vision model, reconciles them into verified states, and writes WebVTT metadata. The React UI displays only the score associated with the viewer's current playback position.

Preserve these product invariants:

- Never expose a future score, scorer, event, or final result in the visible UI, page title, accessibility text, debug output, or timeline labels before its cue becomes active.
- Do not fetch or render the original YouTube title in the product UI; it may itself contain a spoiler.
- Resolve score state from the current media time. Seeking backward must restore the earlier score, and seeking forward must immediately resolve the destination cue.
- Label playhead-derived scores as in progress until the player reports that playback ended. Only then may the visible and document titles say final; seeking backward must remove the final state.
- Treat model results as candidate observations. Deterministic reconciliation code remains authoritative.
- Keep real processing local unless the deployment environment explicitly supports FFmpeg, `yt-dlp`, filesystem artifacts, secrets, and long-running jobs.
- Download and process only media the operator is authorized to use. Do not add access-control bypasses or cookie extraction by default.

## Runtime and architecture

- Node.js: 22.13 or newer.
- Module system: ESM (`"type": "module"`).
- UI: React/Next-compatible app built with Vinext and Vite.
- Processor: dependency-light Node HTTP server in `server/index.mjs`.
- Media pipeline: `server/pipeline.mjs`, invoking `yt-dlp`, FFprobe, and FFmpeg.
- AI: OpenAI JavaScript SDK with Zod validation.
- Progress transport: Server-Sent Events.
- Generated files: `artifacts/<job-id>/`; cached source media: `artifacts/cache/youtube/<url-hash>/`; never commit either.
- Hosted UI configuration: `.openai/hosting.json`.

Important files:

- `app/page.tsx` — submission, progress, demo, and player state.
- `app/globals.css` — product styling and responsive behavior.
- `server/index.mjs` — URL validation, job registry, API, CORS, and SSE.
- `server/config.mjs` — frame-interval validation and high-frequency sampling plan.
- `server/pipeline.mjs` — child processes, frame analysis, reconciliation, and VTT export.
- `server/startup.mjs` — required processor environment validation.
- `scripts/clean-artifacts.mjs` — cross-platform per-job cleanup that preserves cached video.
- `scripts/setup.mjs` — cross-platform dependency installation and checks.
- `scripts/dev.mjs` — combined local development launcher.
- `tests/clean-artifacts.test.mjs` — cache-preserving cleanup behavior.
- `tests/pipeline.test.mjs` — score reconciliation and WebVTT behavior.
- `tests/server-startup.test.mjs` — API-key startup enforcement.
- `tests/setup.test.mjs` — operating-system package-manager plans.
- `tests/rendered-html.test.mjs` — deployed product shell expectations.

## Setup and commands

Use the repository scripts rather than inventing parallel workflows:

```bash
npm run setup        # Install npm and media dependencies; create .env if absent
npm run setup:check  # Read-only dependency verification
npm run dev          # Web app plus processor
npm run dev:web      # Web app only
npm run processor    # Processor only
npm run artifacts:clean # Delete per-job artifacts; preserve cached YouTube media
npm run test:unit    # Fast logic tests
npm run lint         # ESLint
npm test             # Unit tests, deployment build, rendered-page test
npm run build        # Deployment build only
npm run wiki:init    # Generate initial OpenWiki repository documentation
npm run wiki:update  # Refresh OpenWiki documentation non-interactively
```

Do not run `npm run setup` merely to inspect the project because it can install system packages. Use `npm run setup:check` for diagnostics and `node scripts/setup.mjs --dry-run` to inspect planned commands.

## Implementation rules

- Use argument arrays with `spawn`/`spawnSync`; never interpolate user input into shell command strings.
- Keep `shell: false` for media and installer subprocesses.
- Validate external input at the API boundary. The current ingestion endpoint intentionally allows HTTPS `youtube.com`, `www.youtube.com`, and `youtu.be` hosts only.
- Validate `frameIntervalSeconds` at the API boundary as a whole number from 5 through 30. The per-job UI value overrides the environment default and must be recorded in the generated manifest.
- Sample the final 120 seconds every 5 seconds. Preserve the selected interval elsewhere, account for FFmpeg's midpoint frame selection when assigning absolute timestamps, and record the high-frequency window settings in the manifest.
- Do not weaken request-size limits, CORS, URL allowlisting, or artifact path construction without adding focused security tests.
- Keep secrets server-side. Never place `OPENAI_API_KEY` in `NEXT_PUBLIC_*`, React state, logs, fixtures, or committed files.
- Fail processor startup immediately when `OPENAI_API_KEY` is missing or blank, with an actionable terminal message. Do not accept jobs or begin media downloads without it.
- Preserve `.env` and existing local artifacts. `.env.example` is the committed configuration contract.
- Make progress updates monotonic and keep stage names compatible with the UI: `downloading`, `extracting`, `analyzing`, `reconciling`, `exporting`, `complete`, `failed`.
- Keep processor logs operational and spoiler-safe: never log credentials, model response bodies, detected scores, source titles, or future cue contents.
- Keep source-cache keys deterministic and derived from normalized YouTube identity. Cache only authorized source media under `artifacts/`, and prevent concurrent jobs for the same video from starting duplicate downloads.
- Keep `npm run artifacts:clean` limited to UUID-named per-job directories and preserve `artifacts/cache/` plus unrelated directories.
- WebVTT cues must be ordered, non-overlapping, and cover the confirmed timeline. Cue payloads contain complete score state, not only deltas.
- Changes to model prompts or observation fields require corresponding Zod validation and fixture/test updates.
- Avoid relying on the model to enforce score monotonicity, replay rejection, or cue boundaries; implement those rules in testable deterministic code.
- Keep the interactive demo usable without a processor or API key, and clearly distinguish demo data from real analysis.
- Maintain keyboard access, useful labels, reduced-motion behavior, and mobile layouts when changing the React UI.
- Preserve the Apache License 2.0 header in authored TypeScript, JavaScript-module, and CSS source files. Keep `package.json` and `LICENSE` aligned on the `Apache-2.0` identifier.

## Testing expectations

Run the narrowest relevant checks while developing, then the required handoff checks:

- Setup/package-manager changes: `npm run test:unit` and `npm run setup:check`.
- Pipeline, reconciliation, or VTT changes: `npm run test:unit` and `npm run lint`.
- UI-only changes: `npm run lint` and `npm test`.
- Build, metadata, hosting, or shared changes: `npm test` and `npm run lint`.

Add regression tests for cue boundaries, invalid score regressions, malformed model output, unsupported URLs, and progress-stage changes when touching those areas. Do not use a real API key or download a full video in automated tests.

## Documentation and deployment

- Update `README.md`, `.env.example`, and this file when commands, prerequisites, configuration, architecture, or product limitations change.
- OpenWiki is installed globally at the version documented in `README.md`. Its scheduled GitHub Actions workflow updates `openwiki/`, and `AGENTS.md` through a documentation pull request; do not place provider credentials in workflow files.
- The hosted Sites deployment is the UI/demo surface. The local Node processor is not bundled into the Cloudflare-compatible deployment artifact.
- Do not commit `.env`, `artifacts/`, downloaded video, extracted frames, temporary archives, credentials, or source-repository tokens.
- Do not publish, change site access, rotate credentials, or push to an external remote unless the user explicitly requests it or the active hosting workflow requires it.

<!-- OPENWIKI:START -->

## OpenWiki

This repository uses OpenWiki for recurring code documentation. Start with `openwiki/quickstart.md`, then follow its links to architecture, workflows, domain concepts, operations, integrations, testing guidance, and source maps.

The scheduled OpenWiki GitHub Actions workflow refreshes the repository wiki. Do not hand-edit generated OpenWiki pages unless explicitly asked; prefer updating source code/docs and letting OpenWiki regenerate.

<!-- OPENWIKI:END -->
