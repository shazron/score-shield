---
type: Processing Workflow
title: Score timeline generation and spoiler-safe playback
description: "How Score Shield converts authorized video into validated score cues and WebVTT, then resolves only the active state during playback."
resource: /server/pipeline.mjs
tags: [workflow, score-timeline, webvtt, openai, spoiler-safety]
---

# Score timeline generation and spoiler-safe playback

The score timeline is the product’s central contract. It represents complete score state over contiguous media intervals—not a list of future scoring events. [Architecture overview](../architecture/overview.md) carries jobs and artifacts around this workflow; [Testing and source map](../testing-and-source-map.md) identifies the regression tests that protect its deterministic portions.

## From source URL to artifacts

`processVideo({ id, sourceUrl, artifactsRoot, update })` in `server/pipeline.mjs` drives six UI-compatible stages:

1. **Downloading** — invokes `yt-dlp` with `--no-playlist`, a fixed format expression, MP4 merge output, an artifact-local output template, and the already allowlisted source URL.
2. **Extracting** — uses `ffprobe` to read duration, then FFmpeg to sample one JPEG per `FRAME_INTERVAL_SECONDS` (default 20) and cap width at 1280 pixels.
3. **Analyzing** — reads each sampled JPEG sequentially and sends it as a base64 data URL to the configured OpenAI Responses model (`OPENAI_MODEL`, default `gpt-5.6`).
4. **Reconciling** — turns candidate observations into confirmed score states with deterministic rules.
5. **Exporting** — writes `score.vtt` and `manifest.json` concurrently.
6. **Complete** — the API publishes the cue array over SSE; the UI moves to the player.

The model prompt asks for the persistent live scoreboard only and rejects replay captions and statistics. Its response is parsed as JSON and validated by Zod: `found`, team names, nullable non-negative integer scores, and confidence in `[0, 1]`. Invalid JSON, missing required API key, unavailable executables, failed media commands, or no confirmed score state fail the job instead of fabricating a timeline.

## Reconciliation is authoritative

`reconcileObservations(observations, duration)` does not trust an individual model reading as a score event. It:

- ignores observations without a found scoreboard, null scores, or confidence below `0.72`;
- ignores duplicate accepted score states;
- ignores a reading where one score regresses and the other does not increase; and
- requires a newly proposed state after the first accepted cue to occur twice consecutively before accepting it.

The first accepted state begins at time `0`. Later accepted states begin at the timestamp of the candidate that began their confirmation pair; the prior cue ends at that same timestamp, and the final cue ends at the probed media duration. Each accepted manifest cue retains `home`, `away`, `confidence`, and `evidenceFrame`.

This is deliberately a hybrid design: AI supplies observations, while deterministic application logic protects monotonic score changes and cue boundaries. The current rules are a lightweight PoC, not a sport-specific adjudication engine: sampling can miss a short-lived state, team-name consistency is not separately checked, and there is no clock-aware replay detection. Do not replace deterministic guards with a prompt-only approach.

## Output contract

`manifest.json` is:

```json
{
  "schemaVersion": "1.0",
  "id": "<job id>",
  "sourceUrl": "https://…",
  "duration": 0,
  "createdAt": "<ISO timestamp>",
  "cues": ["…complete cue objects, including evidenceFrame…"]
}
```

`cuesToVtt(cues)` exports `WEBVTT` blocks with ordered interval lines and a JSON payload containing complete `home`, `away`, and `confidence` state. It intentionally does not export only a delta: a player that starts or seeks directly into a cue can render the current score without replaying prior events.

The current React player consumes final cues from SSE rather than fetching this sidecar. The manifest and VTT endpoints remain useful artifacts and should retain ordered, non-overlapping, duration-bounded cues if the client contract evolves. Their storage and availability are constrained by the in-memory jobs described in [Architecture overview](../architecture/overview.md).

## Playback resolution

`cueAt(cues, time)` in `app/page.tsx` finds the last cue with `start <= time` using binary search. The player receives YouTube time updates and derives every displayed score from that one active cue. It does not render future events or a completed-match result list.

That creates the intended user behavior:

- start from the beginning → opening score;
- resume midway → the score known at that moment;
- seek backward → earlier score state; and
- seek forward → destination state without revealing intermediate/future events in advance.

The score-safe interface initially overlays the embedded provider player; once uncovered, YouTube-owned UI can still expose information outside Score Shield’s control. The active score is also written into `document.title`, which is timeline-safe but may be an information surface in shared-screen or tab-preview scenarios.

## Safe changes

- Preserve stage names: `downloading`, `extracting`, `analyzing`, `reconciling`, `exporting`, `complete`, and `failed`; the UI directly maps them to progress labels.
- When changing observation fields or prompts, update `ObservationSchema`, output parsing, fixtures/tests, and downstream cue construction together.
- When changing reconciliation, add cases for duplicate readings, regressions, low confidence, missing scoreboards, cue boundaries, and malformed model output. Existing tests cover only a duplicate/regression sequence and basic VTT formatting.
- Use `spawn(command, args)` with `shell: false`; never interpolate a submitted URL into a shell command. The source URL is validated at the API boundary in [Architecture overview](../architecture/overview.md).
- Keep complete state in each cue and maintain strict temporal ordering/non-overlap so a client can resolve seeks independently.
