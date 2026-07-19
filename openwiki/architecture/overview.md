---
type: System Architecture
title: Score Shield runtime architecture
description: "Architecture of the hosted Score Shield interface and the local Node media processor, including job APIs, artifact lifecycle, and deployment constraints."
resource: /server/index.mjs
tags: [architecture, processor, cloudflare, sse, artifacts]
---

# Score Shield runtime architecture

Score Shield is intentionally split between a browser-facing interface and a local processing service. The split protects secrets and enables native media tools that the deployed Worker does not bundle. [Operations and integrations](../operations-and-integrations.md) configures both runtimes; [Score timeline workflow](../workflows/score-timeline.md) explains the processor’s core transformation.

```text
Browser / React UI                         Local Node processor
app/page.tsx                               server/index.mjs
  POST /api/jobs ───────────────────────► create in-memory job
  EventSource /events ◄───────────────── broadcast progress + final cues
  play YouTube embed                       processVideo()
         │                                  yt-dlp → ffprobe → ffmpeg → OpenAI → reconcile
         └──────── active cue at time ───► artifacts/<job-id>/{manifest.json,score.vtt,...}

Cloudflare Worker deployment
worker/index.ts → Vinext app router + static assets
(no processor, media tools, or local artifact store)
```

## Interface and player

`app/page.tsx` owns three client views: landing, processing, and player. A valid HTTPS YouTube URL is posted to `${NEXT_PUBLIC_PROCESSOR_URL}/api/jobs`; the default is `http://localhost:8787`. The page opens an `EventSource` after a successful submission and uses the final SSE payload’s cue array to enter the player. The browser does not currently load its own completed manifest or VTT endpoint.

The player listens for YouTube iframe `infoDelivery` messages from `https://www.youtube.com`, maps `currentTime` to a cue with a binary search, and displays that cue only. A cover blocks the iframe until an explicit user action because provider-owned title/thumbnail UI cannot be completely controlled afterward. This playhead-driven display **consumes** the contiguous cue timeline produced by [Score timeline workflow](../workflows/score-timeline.md).

The default hosted experience can run `demoCues` and simulated progress, whereas real processing requires a reachable processor. The UI’s product shell is deployed through `worker/index.ts`, which sends normal traffic to Vinext and handles `/_vinext/image` with Cloudflare image transforms.

## Processor API and job state

`server/index.mjs` is a dependency-light Node HTTP server listening on `127.0.0.1:${PROCESSOR_PORT:-8787}`. It creates the artifact root at startup and holds jobs in a process-local `Map`.

| Endpoint | Behavior |
| --- | --- |
| `GET /health` | Returns `{ ok: true }`. |
| `POST /api/jobs` | Accepts `{ sourceUrl }`, validates an HTTPS `youtube.com`, `www.youtube.com`, or `youtu.be` URL, creates a UUID job, returns `202`, then starts processing asynchronously. |
| `GET /api/jobs/:id` | Returns the in-memory job snapshot, including any final cues. |
| `GET /api/jobs/:id/events` | Opens an SSE stream and immediately sends the job state; subsequent pipeline updates are broadcast to connected clients. |
| `GET /api/jobs/:id/manifest` | Reads completed `manifest.json` from the matching artifact directory. |
| `GET /api/jobs/:id/score.vtt` | Reads completed `score.vtt` from the matching artifact directory. |

Each job starts with `downloading` progress, transitions through the stage names consumed by the UI, and ends in `complete` or `failed`. Progress includes overall and stage percentages plus optional elapsed, ETA, and frame-count fields. The API validates only a bounded JSON request body (20,000 characters) and allows CORS from `WEB_ORIGIN` or `http://localhost:3000`.

**Lifecycle limitation:** a processor restart loses the job registry, so existing artifact files can remain on disk while their API records return `404`. There is no persistence, cancellation API, retry policy, terminal cleanup, or SSE reconnection/polling fallback. The current API has no authentication, rate limits, concurrency limits, or artifact ownership model; the loopback binding is therefore a material security boundary, not a deployable public-service design.

## Artifact lifecycle

`processVideo` creates `artifacts/<uuid>/frames/` and writes:

- `source.*` — local media downloaded through `yt-dlp`;
- `frames/frame-*.jpg` — sampled analysis input;
- `observations.json` — raw schema-validated model observations;
- `manifest.json` — versioned job metadata, source URL, duration, and reconciled cues; and
- `score.vtt` — cue intervals with JSON score payloads.

The job identifiers come from `randomUUID()`, and artifact access uses only those generated IDs from the in-memory map. The generated media and frames may be large or rights-sensitive; they are Git-ignored but have no automatic retention policy. Any change to durability or storage should start with [Operations and integrations](../operations-and-integrations.md) and preserve the cue contract described in [Score timeline workflow](../workflows/score-timeline.md).

## Hosted build boundary and inactive persistence scaffolding

Vite loads Vinext, a Cloudflare plugin, and `build/sites-vite-plugin.ts`. The custom plugin copies `.openai/hosting.json` and `drizzle/` into `dist/.openai` after the build. Current `hosting.json` sets D1 and R2 to `null`, so the Worker configuration has no database or bucket bindings.

`db/index.ts` has a `getDb()` helper for a Cloudflare D1 binding and `drizzle.config.ts` points to SQLite migrations, but `db/schema.ts` intentionally exports no tables. The `examples/d1/` route and schema are opt-in examples, not product runtime paths. Do not present D1 as current job storage unless a binding and schema are added.

## Change guide

- **Player or API contract change:** update the shared stage/cue shapes in `app/page.tsx` and `server/index.mjs` together; preserve the `complete`/`failed` stages and the current SSE payload shape unless the client is migrated in the same change.
- **Processor exposure change:** add focused tests before weakening URL validation, body limits, CORS, loopback binding, artifact construction, or subprocess argument handling. `AGENTS.md` requires argument arrays and `shell: false` for subprocesses.
- **Hosting change:** test the built Worker (`npm test`), not just the local processor. The hosted app and processor have different runtime capabilities.
