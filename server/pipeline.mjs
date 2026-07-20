/*
 * Copyright 2026 Score Shield contributors
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import OpenAI from "openai";
import { z } from "zod";
import {
  buildFrameSamplingPlan,
  DEFAULT_FRAME_INTERVAL_SECONDS,
  HIGH_FREQUENCY_FRAME_INTERVAL_SECONDS,
  HIGH_FREQUENCY_WINDOW_SECONDS,
  parseFrameInterval,
  samplingFrameTimestamp,
} from "./config.mjs";

const ObservationSchema = z.object({
  found: z.boolean(),
  homeName: z.string().nullable().default(null),
  awayName: z.string().nullable().default(null),
  homeScore: z.number().int().nonnegative().nullable(),
  awayScore: z.number().int().nonnegative().nullable(),
  confidence: z.number().min(0).max(1),
});

const sourceDownloads = new Map();

export function parseObservation(value) {
  return ObservationSchema.parse(value);
}

function executable(name, override) {
  return override || name;
}

function youtubeVideoId(sourceUrl) {
  const url = new URL(sourceUrl);
  if (url.hostname === "youtu.be") return url.pathname.split("/").filter(Boolean)[0] || null;
  if (url.pathname === "/watch") return url.searchParams.get("v");
  const match = url.pathname.match(/^\/(?:embed|live|shorts)\/([^/]+)/);
  return match?.[1] || null;
}

export function sourceCacheKey(sourceUrl) {
  const url = new URL(sourceUrl);
  url.hash = "";
  url.hostname = url.hostname.toLowerCase();
  const videoId = youtubeVideoId(url.href);
  const identity = videoId ? `youtube:${videoId}` : url.href;
  return createHash("sha256").update(identity).digest("hex");
}

async function findCachedSource(cacheDir) {
  let files;
  try {
    files = await readdir(cacheDir);
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
  for (const file of files.sort()) {
    if (!file.startsWith("source.") || file.endsWith(".part") || file.endsWith(".ytdl")) continue;
    const sourcePath = path.join(cacheDir, file);
    if ((await stat(sourcePath)).size > 0) return sourcePath;
  }
  return null;
}

function run(command, args, { label = path.basename(command), log = () => {}, onLine } = {}) {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    log("info", `${label} started`);
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
    child.on("error", (error) => {
      log("error", `${label} could not start`, { error: error.message });
      reject(new Error(`Could not start ${command}: ${error.message}`));
    });
    child.on("close", (code) => {
      const durationMs = Date.now() - started;
      if (code === 0) {
        log("info", `${label} completed`, { durationMs });
        resolve({ stdout, stderr });
      } else {
        log("error", `${label} failed`, { exitCode: code, durationMs });
        const diagnostic = label === "yt-dlp" ? "" : `: ${stderr.slice(-600)}`;
        reject(new Error(`${label} exited with code ${code}${diagnostic}`));
      }
    });
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

function canonicalTeamName(observations, field, fallback) {
  const counts = new Map();
  for (const observation of observations) {
    const name = typeof observation[field] === "string" ? observation[field].trim() : "";
    if (observation.found && name) counts.set(name, (counts.get(name) || 0) + 1);
  }
  return [...counts.entries()].sort(([nameA, countA], [nameB, countB]) => {
    if (countA !== countB) return countB - countA;
    const abbreviationA = /^[A-Z0-9]{2,5}$/.test(nameA);
    const abbreviationB = /^[A-Z0-9]{2,5}$/.test(nameB);
    if (abbreviationA !== abbreviationB) return abbreviationB ? 1 : -1;
    return nameA.length - nameB.length || nameA.localeCompare(nameB);
  })[0]?.[0] || fallback;
}

function teamNamesMatch(first, second) {
  if (!first || !second) return false;
  const left = first.toUpperCase().replace(/[^A-Z0-9]/g, "");
  const right = second.toUpperCase().replace(/[^A-Z0-9]/g, "");
  return left === right || (Math.min(left.length, right.length) >= 3 && (left.startsWith(right) || right.startsWith(left)));
}

function normalizeTeamSides(observation, homeName, awayName) {
  const reversed = teamNamesMatch(observation.homeName, awayName)
    && teamNamesMatch(observation.awayName, homeName)
    && !(teamNamesMatch(observation.homeName, homeName) && teamNamesMatch(observation.awayName, awayName));
  return {
    ...observation,
    homeName,
    awayName,
    homeScore: reversed ? observation.awayScore : observation.homeScore,
    awayScore: reversed ? observation.homeScore : observation.awayScore,
  };
}

function sameScore(first, second) {
  return first.homeScore === second.homeScore && first.awayScore === second.awayScore;
}

function scoreRegresses(observation, state) {
  return observation.homeScore < state.homeScore || observation.awayScore < state.awayScore;
}

function scoreDominates(observation, candidate) {
  return observation.homeScore >= candidate.homeScore
    && observation.awayScore >= candidate.awayScore
    && !sameScore(observation, candidate);
}

export function reconcileObservations(observations, duration) {
  const homeName = canonicalTeamName(observations, "homeName", "Home");
  const awayName = canonicalTeamName(observations, "awayName", "Away");
  const normalized = observations.map((observation) => normalizeTeamSides(observation, homeName, awayName));
  const accepted = [];
  let candidate = null;
  const accept = (observation) => {
    const previous = accepted.at(-1);
    const cue = {
      start: previous ? observation.timestamp : 0,
      end: duration,
      home: { name: homeName, score: observation.homeScore },
      away: { name: awayName, score: observation.awayScore },
      confidence: observation.confidence,
      evidenceFrame: observation.frame,
    };
    if (previous) previous.end = cue.start;
    accepted.push(cue);
  };

  for (const observation of normalized) {
    if (!observation.found || observation.confidence < 0.72 || observation.homeScore === null || observation.awayScore === null) continue;
    const latest = accepted.at(-1);
    const latestScore = latest ? { homeScore: latest.home.score, awayScore: latest.away.score } : null;
    if (!latest) {
      accept(observation);
      continue;
    }
    if (scoreRegresses(observation, latestScore) || sameScore(observation, latestScore)) continue;
    if (!candidate) {
      candidate = observation;
      continue;
    }
    if (sameScore(observation, candidate)) {
      accept(candidate);
      candidate = null;
      continue;
    }
    if (scoreDominates(observation, candidate)) {
      accept(candidate);
      candidate = observation;
      continue;
    }
    candidate = observation;
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
        { type: "input_text", text: "Inspect this sports broadcast frame. Read only the persistent live scoreboard graphic, not replay captions or statistics. Return only compact JSON with keys found, homeName, awayName, homeScore, awayScore, confidence. The home fields must describe the left-hand scoreboard team and the away fields the right-hand team. Use the short 2-5 character abbreviations printed on the live scoreboard when available. If no live scoreboard is legible, use found=false and null for both names and scores." },
        { type: "input_image", image_url: `data:image/jpeg;base64,${image}`, detail: "high" },
      ],
    }],
  });
  const raw = response.output_text.trim().replace(/^```json\s*/i, "").replace(/```$/, "");
  return { ...parseObservation(JSON.parse(raw)), timestamp, frame: path.basename(framePath) };
}

export async function processVideo({ id, sourceUrl, frameIntervalSeconds, artifactsRoot, update, log = () => {} }) {
  const jobDir = path.join(artifactsRoot, id);
  const framesDir = path.join(jobDir, "frames");
  const cacheKey = sourceCacheKey(sourceUrl);
  const sourceCacheDir = path.join(artifactsRoot, "cache", "youtube", cacheKey);
  await mkdir(framesDir, { recursive: true });
  await mkdir(sourceCacheDir, { recursive: true });
  const started = Date.now();
  let loggedStage = null;
  let loggedProgressBucket = -1;
  const report = (stage, stageProgress, overallProgress, message, details = {}) => {
    const progress = {
      stage, stageProgress, overallProgress, message,
      elapsedSeconds: (Date.now() - started) / 1000,
      ...details,
    };
    update(progress);
    const bucket = Math.floor(stageProgress / 5);
    if (stage !== loggedStage || bucket > loggedProgressBucket || stageProgress === 100) {
      log("info", message, {
        stage,
        stageProgress: Math.round(stageProgress),
        overallProgress: Math.round(overallProgress),
        ...(details.processedFrames !== undefined ? { processedFrames: details.processedFrames } : {}),
        ...(details.totalFrames !== undefined ? { totalFrames: details.totalFrames } : {}),
      });
      loggedStage = stage;
      loggedProgressBucket = bucket;
    }
  };

  report("downloading", 0, 0, "Preparing the authorized source copy…");
  let sourcePath = await findCachedSource(sourceCacheDir);
  if (sourcePath) {
    log("info", "YouTube source cache hit", { cacheKey });
    report("downloading", 100, 25, "Using the cached source video…");
  } else {
    let pendingDownload = sourceDownloads.get(cacheKey);
    if (!pendingDownload) {
      const outputTemplate = path.join(sourceCacheDir, "source.%(ext)s");
      pendingDownload = run(executable("yt-dlp", process.env.YTDLP_PATH), [
        "--no-playlist", "--newline", "--progress-template", "download:%(progress._percent_str)s", "-f", "bv*+ba/b", "--merge-output-format", "mp4", "-o", outputTemplate, sourceUrl,
      ], { label: "yt-dlp", log, onLine(line) {
        const match = line.match(/download:\s*([\d.]+)%/);
        if (match) {
          const value = Number(match[1]);
          report("downloading", value, value * .25, `Downloading source video… ${Math.round(value)}%`);
        }
      }}).then(async () => {
        const downloaded = await findCachedSource(sourceCacheDir);
        if (!downloaded) throw new Error("The downloaded source file could not be located.");
        return downloaded;
      }).finally(() => sourceDownloads.delete(cacheKey));
      sourceDownloads.set(cacheKey, pendingDownload);
      log("info", "YouTube source cache miss", { cacheKey });
    } else {
      log("info", "Waiting for an in-progress download of the same source", { cacheKey });
      report("downloading", 0, 0, "Waiting for the shared source download…");
    }
    sourcePath = await pendingDownload;
    report("downloading", 100, 25, "Source video cached for future runs.");
  }

  report("extracting", 0, 25, "Inspecting the media timeline…");
  const probe = await run(executable("ffprobe", process.env.FFPROBE_PATH), ["-v", "error", "-show_entries", "format=duration", "-of", "default=noprint_wrappers=1:nokey=1", sourcePath], { label: "ffprobe", log });
  const duration = Number(probe.stdout.trim());
  if (!Number.isFinite(duration) || duration <= 0) throw new Error("FFprobe could not determine the video duration.");
  log("info", "Media timeline inspected", { durationSeconds: Math.round(duration) });

  const configuredInterval = parseFrameInterval(process.env.FRAME_INTERVAL_SECONDS) ?? DEFAULT_FRAME_INTERVAL_SECONDS;
  const interval = parseFrameInterval(frameIntervalSeconds, configuredInterval);
  if (interval === null) throw new Error("Frame sampling interval must be a whole number from 5 to 30 seconds.");
  const samplingPlan = buildFrameSamplingPlan(duration, interval);
  const hasClosingWindowOverride = samplingPlan.length > 1;
  const closingWindowInterval = Math.min(interval, HIGH_FREQUENCY_FRAME_INTERVAL_SECONDS);
  const samplingMessage = hasClosingWindowOverride
    ? `Sampling every ${interval} seconds, then every ${closingWindowInterval} seconds for the final two minutes…`
    : `Sampling one frame every ${closingWindowInterval} seconds…`;
  report("extracting", 15, 28, samplingMessage);

  const frames = [];
  for (let segmentIndex = 0; segmentIndex < samplingPlan.length; segmentIndex += 1) {
    const segment = samplingPlan[segmentIndex];
    const prefix = `frame-${String(segmentIndex + 1).padStart(2, "0")}-`;
    const args = ["-hide_banner", "-loglevel", "error"];
    if (segment.start > 0) args.push("-ss", String(segment.start));
    args.push(
      "-i", sourcePath,
      "-t", String(segment.end - segment.start),
      "-vf", `fps=1/${segment.interval},scale='min(1280,iw)':-2`,
      "-q:v", "3",
      path.join(framesDir, `${prefix}%06d.jpg`),
    );
    await run(executable("ffmpeg", process.env.FFMPEG_PATH), args, { label: `ffmpeg frame extraction segment ${segmentIndex + 1}`, log });
    const segmentFrames = (await readdir(framesDir)).filter((file) => file.startsWith(prefix) && file.endsWith(".jpg")).sort();
    for (let frameIndex = 0; frameIndex < segmentFrames.length; frameIndex += 1) {
      frames.push({
        file: segmentFrames[frameIndex],
        timestamp: samplingFrameTimestamp(segment, frameIndex, duration),
      });
    }
  }
  if (!frames.length) throw new Error("FFmpeg did not produce any analysis frames.");
  report("extracting", 100, 40, `${frames.length} timestamped frames are ready.`, { processedFrames: 0, totalFrames: frames.length });

  if (!process.env.OPENAI_API_KEY) throw new Error("OPENAI_API_KEY is required for scoreboard analysis. Use the interactive demo to preview the player without API calls.");
  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  log("info", "AI frame analysis started", { model: process.env.OPENAI_MODEL || "gpt-5.6", totalFrames: frames.length });
  const observations = [];
  for (let index = 0; index < frames.length; index += 1) {
    const observation = await analyzeFrame(client, path.join(framesDir, frames[index].file), frames[index].timestamp);
    observations.push(observation);
    const value = ((index + 1) / frames.length) * 100;
    report("analyzing", value, 40 + value * .48, `Reading scoreboard frame ${index + 1} of ${frames.length}…`, { processedFrames: index + 1, totalFrames: frames.length });
  }
  await writeFile(path.join(jobDir, "observations.json"), JSON.stringify(observations, null, 2));
  log("info", "AI frame analysis completed", { totalFrames: frames.length });

  report("reconciling", 25, 90, "Rejecting replays and confirming score changes…");
  const cues = reconcileObservations(observations, duration);
  report("reconciling", 100, 96, `${cues.length} verified score states found.`);

  report("exporting", 35, 97, "Writing the WebVTT metadata track…");
  const manifest = {
    schemaVersion: "1.0",
    id,
    sourceUrl,
    frameIntervalSeconds: interval,
    highFrequencyWindowSeconds: HIGH_FREQUENCY_WINDOW_SECONDS,
    highFrequencyFrameIntervalSeconds: closingWindowInterval,
    duration,
    createdAt: new Date().toISOString(),
    cues,
  };
  await Promise.all([
    writeFile(path.join(jobDir, "score.vtt"), cuesToVtt(cues)),
    writeFile(path.join(jobDir, "manifest.json"), JSON.stringify(manifest, null, 2)),
  ]);
  log("info", "Metadata artifacts written", { cueCount: cues.length });
  return { cues, manifest };
}
