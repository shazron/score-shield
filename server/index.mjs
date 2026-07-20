import { createServer } from "node:http";
import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { DEFAULT_FRAME_INTERVAL_SECONDS, parseFrameInterval } from "./config.mjs";
import { processVideo } from "./pipeline.mjs";
import { validateProcessorEnvironment } from "./startup.mjs";

try {
  validateProcessorEnvironment();
} catch (error) {
  console.error(JSON.stringify({
    time: new Date().toISOString(),
    level: "error",
    service: "score-shield-processor",
    message: "Processor startup failed",
    error: error instanceof Error ? error.message : "OPENAI_API_KEY is missing.",
  }));
  process.exit(1);
}

const port = Number(process.env.PROCESSOR_PORT || 8787);
const artifactsRoot = path.resolve(process.env.ARTIFACTS_DIR || "artifacts");
const jobs = new Map();
await mkdir(artifactsRoot, { recursive: true });

function log(level, message, details = {}) {
  const output = JSON.stringify({
    time: new Date().toISOString(),
    level,
    service: "score-shield-processor",
    message,
    ...details,
  });
  const writer = level === "error" ? console.error : level === "warn" ? console.warn : console.log;
  writer(output);
}

function cors(extra = {}) {
  return { "access-control-allow-origin": process.env.WEB_ORIGIN || "http://localhost:3000", "access-control-allow-methods": "GET,POST,OPTIONS", "access-control-allow-headers": "content-type", ...extra };
}

function json(response, status, value) {
  response.writeHead(status, cors({ "content-type": "application/json; charset=utf-8" }));
  response.end(JSON.stringify(value));
}

async function body(request) {
  let value = "";
  for await (const chunk of request) {
    value += chunk;
    if (value.length > 20_000) throw new Error("Request body is too large.");
  }
  return JSON.parse(value || "{}");
}

function broadcast(job) {
  const payload = `data: ${JSON.stringify({ id: job.id, progress: job.progress, cues: job.cues })}\n\n`;
  for (const client of job.clients) client.write(payload);
}

function validYouTubeUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && ["youtube.com", "www.youtube.com", "youtu.be"].includes(url.hostname);
  } catch { return false; }
}

const server = createServer(async (request, response) => {
  try {
    if (request.method === "OPTIONS") { response.writeHead(204, cors()); response.end(); return; }
    const url = new URL(request.url || "/", `http://${request.headers.host}`);

    if (request.method === "GET" && url.pathname === "/health") return json(response, 200, { ok: true });
    if (request.method === "POST" && url.pathname === "/api/jobs") {
      const input = await body(request);
      if (!validYouTubeUrl(input.sourceUrl)) return json(response, 400, { error: "A valid HTTPS YouTube URL is required." });
      const configuredInterval = parseFrameInterval(process.env.FRAME_INTERVAL_SECONDS) ?? DEFAULT_FRAME_INTERVAL_SECONDS;
      const frameIntervalSeconds = parseFrameInterval(input.frameIntervalSeconds, configuredInterval);
      if (frameIntervalSeconds === null) return json(response, 400, { error: "Frame sampling interval must be a whole number from 5 to 30 seconds." });
      const id = randomUUID();
      const job = { id, sourceUrl: input.sourceUrl, frameIntervalSeconds, progress: { stage: "downloading", stageProgress: 0, overallProgress: 0, message: "Queued…" }, clients: new Set(), cues: null };
      jobs.set(id, job);
      const jobLog = (level, message, details = {}) => log(level, message, { jobId: id, ...details });
      jobLog("info", "Processing job queued", { sourceHost: new URL(input.sourceUrl).hostname, frameIntervalSeconds });
      json(response, 202, { id, statusUrl: `/api/jobs/${id}`, eventsUrl: `/api/jobs/${id}/events` });
      processVideo({ id, sourceUrl: input.sourceUrl, frameIntervalSeconds, artifactsRoot, log: jobLog, update(progress) { job.progress = progress; broadcast(job); } })
        .then(({ cues }) => {
          job.cues = cues;
          job.progress = { ...job.progress, stage: "complete", stageProgress: 100, overallProgress: 100, message: "Your spoiler-free player is ready.", etaSeconds: 0 };
          broadcast(job);
          jobLog("info", "Processing job completed", { cueCount: cues.length, elapsedSeconds: Math.round(job.progress.elapsedSeconds || 0) });
        })
        .catch((error) => {
          const failedStage = job.progress.stage;
          job.progress = { ...job.progress, stage: "failed", message: error.message };
          broadcast(job);
          jobLog("error", "Processing job failed", { error: error.message, failedStage });
        });
      return;
    }

    const match = url.pathname.match(/^\/api\/jobs\/([^/]+)(?:\/(events|manifest|score\.vtt))?$/);
    if (request.method === "GET" && match) {
      const [, id, resource] = match;
      const job = jobs.get(id);
      if (!job) return json(response, 404, { error: "Job not found." });
      if (resource === "events") {
        response.writeHead(200, cors({ "content-type": "text/event-stream", "cache-control": "no-cache", connection: "keep-alive" }));
        job.clients.add(response);
        response.write(`data: ${JSON.stringify({ id: job.id, progress: job.progress, cues: job.cues })}\n\n`);
        request.on("close", () => job.clients.delete(response));
        return;
      }
      if (resource === "manifest" || resource === "score.vtt") {
        const filename = resource === "manifest" ? "manifest.json" : "score.vtt";
        const content = await readFile(path.join(artifactsRoot, id, filename));
        response.writeHead(200, cors({
          "content-type": resource === "manifest" ? "application/json" : "text/vtt; charset=utf-8",
          ...(resource === "score.vtt" ? { "content-disposition": "attachment; filename=score-shield.vtt" } : {}),
        }));
        response.end(content);
        return;
      }
      return json(response, 200, { id: job.id, sourceUrl: job.sourceUrl, frameIntervalSeconds: job.frameIntervalSeconds, progress: job.progress, cues: job.cues });
    }

    json(response, 404, { error: "Not found." });
  } catch (error) {
    log("error", "Processor request failed", { method: request.method, path: request.url, error: error instanceof Error ? error.message : "Unexpected processor error." });
    json(response, 500, { error: error instanceof Error ? error.message : "Unexpected processor error." });
  }
});

server.listen(port, "127.0.0.1", () => log("info", "Processor listening", { url: `http://localhost:${port}`, webOrigin: process.env.WEB_ORIGIN || "http://localhost:3000" }));
