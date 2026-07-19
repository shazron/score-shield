import { createServer } from "node:http";
import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { processVideo } from "./pipeline.mjs";

const port = Number(process.env.PROCESSOR_PORT || 8787);
const artifactsRoot = path.resolve(process.env.ARTIFACTS_DIR || "artifacts");
const jobs = new Map();
await mkdir(artifactsRoot, { recursive: true });

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
      const id = randomUUID();
      const job = { id, sourceUrl: input.sourceUrl, progress: { stage: "downloading", stageProgress: 0, overallProgress: 0, message: "Queued…" }, clients: new Set(), cues: null };
      jobs.set(id, job);
      json(response, 202, { id, statusUrl: `/api/jobs/${id}`, eventsUrl: `/api/jobs/${id}/events` });
      processVideo({ id, sourceUrl: input.sourceUrl, artifactsRoot, update(progress) { job.progress = progress; broadcast(job); } })
        .then(({ cues }) => {
          job.cues = cues;
          job.progress = { ...job.progress, stage: "complete", stageProgress: 100, overallProgress: 100, message: "Your spoiler-free player is ready.", etaSeconds: 0 };
          broadcast(job);
        })
        .catch((error) => { job.progress = { ...job.progress, stage: "failed", message: error.message }; broadcast(job); });
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
        response.writeHead(200, cors({ "content-type": resource === "manifest" ? "application/json" : "text/vtt; charset=utf-8" }));
        response.end(content);
        return;
      }
      return json(response, 200, { id: job.id, sourceUrl: job.sourceUrl, progress: job.progress, cues: job.cues });
    }

    json(response, 404, { error: "Not found." });
  } catch (error) {
    json(response, 500, { error: error instanceof Error ? error.message : "Unexpected processor error." });
  }
});

server.listen(port, "127.0.0.1", () => console.log(`Score Shield processor listening on http://localhost:${port}`));
