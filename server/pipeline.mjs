import { spawn } from "node:child_process";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import OpenAI from "openai";
import { z } from "zod";

const ObservationSchema = z.object({
  found: z.boolean(),
  homeName: z.string().default("Home"),
  awayName: z.string().default("Away"),
  homeScore: z.number().int().nonnegative().nullable(),
  awayScore: z.number().int().nonnegative().nullable(),
  confidence: z.number().min(0).max(1),
});

function executable(name, override) {
  return override || name;
}

function run(command, args, { onLine } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    const consume = (chunk, target) => {
      const text = chunk.toString();
      if (target === "stdout") stdout += text;
      else stderr += text;
      for (const line of text.split(/[\r\n]+/)) if (line) onLine?.(line);
    };
    child.stdout.on("data", (chunk) => consume(chunk, "stdout"));
    child.stderr.on("data", (chunk) => consume(chunk, "stderr"));
    child.on("error", (error) => reject(new Error(`Could not start ${command}: ${error.message}`)));
    child.on("close", (code) => code === 0 ? resolve({ stdout, stderr }) : reject(new Error(`${command} exited with code ${code}: ${stderr.slice(-600)}`)));
  });
}

function timecode(seconds) {
  const milliseconds = Math.max(0, Math.round(seconds * 1000));
  const hours = Math.floor(milliseconds / 3_600_000);
  const minutes = Math.floor((milliseconds % 3_600_000) / 60_000);
  const secs = Math.floor((milliseconds % 60_000) / 1000);
  const ms = milliseconds % 1000;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")}.${String(ms).padStart(3, "0")}`;
}

export function reconcileObservations(observations, duration) {
  const accepted = [];
  let previousCandidate = null;
  for (const observation of observations) {
    if (!observation.found || observation.confidence < 0.72 || observation.homeScore === null || observation.awayScore === null) continue;
    const key = `${observation.homeScore}:${observation.awayScore}`;
    const latest = accepted.at(-1);
    if (latest && observation.homeScore < latest.home.score && observation.awayScore <= latest.away.score) continue;
    if (latest && observation.awayScore < latest.away.score && observation.homeScore <= latest.home.score) continue;
    if (latest && key === `${latest.home.score}:${latest.away.score}`) continue;
    if (previousCandidate?.key !== key) {
      previousCandidate = { key, observation };
      if (accepted.length) continue;
    }
    accepted.push({
      start: accepted.length ? previousCandidate.observation.timestamp : 0,
      end: duration,
      home: { name: observation.homeName || "Home", score: observation.homeScore },
      away: { name: observation.awayName || "Away", score: observation.awayScore },
      confidence: observation.confidence,
      evidenceFrame: observation.frame,
    });
    if (accepted.length > 1) accepted[accepted.length - 2].end = accepted.at(-1).start;
    previousCandidate = null;
  }
  if (!accepted.length) throw new Error("No reliable scoreboard states were found in the sampled frames.");
  accepted.at(-1).end = duration;
  return accepted;
}

export function cuesToVtt(cues) {
  const blocks = cues.map((cue, index) => {
    const payload = JSON.stringify({ home: cue.home, away: cue.away, confidence: cue.confidence });
    return `${index + 1}\n${timecode(cue.start)} --> ${timecode(cue.end)}\n${payload}`;
  });
  return `WEBVTT\n\n${blocks.join("\n\n")}\n`;
}

async function analyzeFrame(client, framePath, timestamp) {
  const image = await readFile(framePath, "base64");
  const response = await client.responses.create({
    model: process.env.OPENAI_MODEL || "gpt-5.6",
    input: [{
      role: "user",
      content: [
        { type: "input_text", text: "Inspect this sports broadcast frame. Read only the persistent live scoreboard graphic, not replay captions or statistics. Return only compact JSON with keys found, homeName, awayName, homeScore, awayScore, confidence. Use found=false and null scores if no live scoreboard is legible." },
        { type: "input_image", image_url: `data:image/jpeg;base64,${image}`, detail: "high" },
      ],
    }],
  });
  const raw = response.output_text.trim().replace(/^```json\s*/i, "").replace(/```$/, "");
  return { ...ObservationSchema.parse(JSON.parse(raw)), timestamp, frame: path.basename(framePath) };
}

export async function processVideo({ id, sourceUrl, artifactsRoot, update }) {
  const jobDir = path.join(artifactsRoot, id);
  const framesDir = path.join(jobDir, "frames");
  await mkdir(framesDir, { recursive: true });
  const started = Date.now();
  const report = (stage, stageProgress, overallProgress, message, details = {}) => update({
    stage, stageProgress, overallProgress, message,
    elapsedSeconds: (Date.now() - started) / 1000,
    ...details,
  });

  report("downloading", 0, 0, "Preparing the authorized source copy…");
  const outputTemplate = path.join(jobDir, "source.%(ext)s");
  await run(executable("yt-dlp", process.env.YTDLP_PATH), [
    "--no-playlist", "--newline", "--progress-template", "download:%(progress._percent_str)s", "-f", "bv*+ba/b", "--merge-output-format", "mp4", "-o", outputTemplate, sourceUrl,
  ], { onLine(line) {
    const match = line.match(/download:\s*([\d.]+)%/);
    if (match) {
      const value = Number(match[1]);
      report("downloading", value, value * .25, `Downloading source video… ${Math.round(value)}%`);
    }
  }});

  const files = await readdir(jobDir);
  const sourceFile = files.find((file) => file.startsWith("source.") && !file.endsWith(".part"));
  if (!sourceFile) throw new Error("The downloaded source file could not be located.");
  const sourcePath = path.join(jobDir, sourceFile);
  report("extracting", 0, 25, "Inspecting the media timeline…");
  const probe = await run(executable("ffprobe", process.env.FFPROBE_PATH), ["-v", "error", "-show_entries", "format=duration", "-of", "default=noprint_wrappers=1:nokey=1", sourcePath]);
  const duration = Number(probe.stdout.trim());
  if (!Number.isFinite(duration) || duration <= 0) throw new Error("FFprobe could not determine the video duration.");

  const interval = Number(process.env.FRAME_INTERVAL_SECONDS || 20);
  report("extracting", 15, 28, `Sampling one frame every ${interval} seconds…`);
  await run(executable("ffmpeg", process.env.FFMPEG_PATH), ["-hide_banner", "-loglevel", "error", "-i", sourcePath, "-vf", `fps=1/${interval},scale='min(1280,iw)':-2`, "-q:v", "3", path.join(framesDir, "frame-%06d.jpg")]);
  const frames = (await readdir(framesDir)).filter((file) => file.endsWith(".jpg")).sort();
  if (!frames.length) throw new Error("FFmpeg did not produce any analysis frames.");
  report("extracting", 100, 40, `${frames.length} timestamped frames are ready.`, { processedFrames: 0, totalFrames: frames.length });

  if (!process.env.OPENAI_API_KEY) throw new Error("OPENAI_API_KEY is required for scoreboard analysis. Use the interactive demo to preview the player without API calls.");
  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const observations = [];
  for (let index = 0; index < frames.length; index += 1) {
    const observation = await analyzeFrame(client, path.join(framesDir, frames[index]), index * interval);
    observations.push(observation);
    const value = ((index + 1) / frames.length) * 100;
    report("analyzing", value, 40 + value * .48, `Reading scoreboard frame ${index + 1} of ${frames.length}…`, { processedFrames: index + 1, totalFrames: frames.length });
  }
  await writeFile(path.join(jobDir, "observations.json"), JSON.stringify(observations, null, 2));

  report("reconciling", 25, 90, "Rejecting replays and confirming score changes…");
  const cues = reconcileObservations(observations, duration);
  report("reconciling", 100, 96, `${cues.length} verified score states found.`);

  report("exporting", 35, 97, "Writing the WebVTT metadata track…");
  const manifest = { schemaVersion: "1.0", id, sourceUrl, duration, createdAt: new Date().toISOString(), cues };
  await Promise.all([
    writeFile(path.join(jobDir, "score.vtt"), cuesToVtt(cues)),
    writeFile(path.join(jobDir, "manifest.json"), JSON.stringify(manifest, null, 2)),
  ]);
  return { cues, manifest };
}
