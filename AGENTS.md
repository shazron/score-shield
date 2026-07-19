# Score Shield Agent Guide

These instructions apply to the entire repository.

## Product intent

Score Shield is a spoiler-free sports-video reference implementation. A local Node.js worker downloads authorized media, extracts frames, obtains candidate score readings from a vision model, reconciles them into verified states, and writes WebVTT metadata. The React UI displays only the score associated with the viewer's current playback position.

Preserve these product invariants:

- Never expose a future score, scorer, event, or final result in the visible UI, page title, accessibility text, debug output, or timeline labels before its cue becomes active.
- Do not fetch or render the original YouTube title in the product UI; it may itself contain a spoiler.
- Resolve score state from the current media time. Seeking backward must restore the earlier score, and seeking forward must immediately resolve the destination cue.
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
- Generated files: `artifacts/<job-id>/`; never commit them.
- Hosted UI configuration: `.openai/hosting.json`.

Important files:

- `app/page.tsx` — submission, progress, demo, and player state.
- `app/globals.css` — product styling and responsive behavior.
- `server/index.mjs` — URL validation, job registry, API, CORS, and SSE.
- `server/pipeline.mjs` — child processes, frame analysis, reconciliation, and VTT export.
- `scripts/setup.mjs` — cross-platform dependency installation and checks.
- `scripts/dev.mjs` — combined local development launcher.
- `tests/pipeline.test.mjs` — score reconciliation and WebVTT behavior.
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
npm run test:unit    # Fast logic tests
npm run lint         # ESLint
npm test             # Unit tests, deployment build, rendered-page test
npm run build        # Deployment build only
```

Do not run `npm run setup` merely to inspect the project because it can install system packages. Use `npm run setup:check` for diagnostics and `node scripts/setup.mjs --dry-run` to inspect planned commands.

## Implementation rules

- Use argument arrays with `spawn`/`spawnSync`; never interpolate user input into shell command strings.
- Keep `shell: false` for media and installer subprocesses.
- Validate external input at the API boundary. The current ingestion endpoint intentionally allows HTTPS `youtube.com`, `www.youtube.com`, and `youtu.be` hosts only.
- Do not weaken request-size limits, CORS, URL allowlisting, or artifact path construction without adding focused security tests.
- Keep secrets server-side. Never place `OPENAI_API_KEY` in `NEXT_PUBLIC_*`, React state, logs, fixtures, or committed files.
- Preserve `.env` and existing local artifacts. `.env.example` is the committed configuration contract.
- Make progress updates monotonic and keep stage names compatible with the UI: `downloading`, `extracting`, `analyzing`, `reconciling`, `exporting`, `complete`, `failed`.
- WebVTT cues must be ordered, non-overlapping, and cover the confirmed timeline. Cue payloads contain complete score state, not only deltas.
- Changes to model prompts or observation fields require corresponding Zod validation and fixture/test updates.
- Avoid relying on the model to enforce score monotonicity, replay rejection, or cue boundaries; implement those rules in testable deterministic code.
- Keep the interactive demo usable without a processor or API key, and clearly distinguish demo data from real analysis.
- Maintain keyboard access, useful labels, reduced-motion behavior, and mobile layouts when changing the React UI.

## Testing expectations

Run the narrowest relevant checks while developing, then the required handoff checks:

- Setup/package-manager changes: `npm run test:unit` and `npm run setup:check`.
- Pipeline, reconciliation, or VTT changes: `npm run test:unit` and `npm run lint`.
- UI-only changes: `npm run lint` and `npm test`.
- Build, metadata, hosting, or shared changes: `npm test` and `npm run lint`.

Add regression tests for cue boundaries, invalid score regressions, malformed model output, unsupported URLs, and progress-stage changes when touching those areas. Do not use a real API key or download a full video in automated tests.

## Documentation and deployment

- Update `README.md`, `.env.example`, and this file when commands, prerequisites, configuration, architecture, or product limitations change.
- The hosted Sites deployment is the UI/demo surface. The local Node processor is not bundled into the Cloudflare-compatible deployment artifact.
- Do not commit `.env`, `artifacts/`, downloaded video, extracted frames, temporary archives, credentials, or source-repository tokens.
- Do not publish, change site access, rotate credentials, or push to an external remote unless the user explicitly requests it or the active hosting workflow requires it.
