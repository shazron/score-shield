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

"use client";

import { FormEvent, useEffect, useMemo, useRef, useState } from "react";

const DEFAULT_VIDEO_URL = "https://www.youtube.com/watch?v=jIrmswHtg9E";
const GITHUB_REPOSITORY_URL = "https://github.com/shazron/score-shield";
const PROCESSOR_URL = process.env.NEXT_PUBLIC_PROCESSOR_URL ?? "http://localhost:8787";
const DEFAULT_FRAME_INTERVAL_SECONDS = 10;
const DEMO_DURATION_SECONDS = 917;
const DEMO_FRAME_COUNT = 104;

type Stage = "downloading" | "extracting" | "analyzing" | "reconciling" | "exporting" | "complete" | "failed";

type Progress = {
  stage: Stage;
  stageProgress: number;
  overallProgress: number;
  message: string;
  processedFrames?: number;
  totalFrames?: number;
  elapsedSeconds?: number;
  etaSeconds?: number;
};

type ScoreCue = {
  start: number;
  end: number;
  home: { name: string; score: number };
  away: { name: string; score: number };
  confidence: number;
  event?: { type: string; scorer?: string };
};

const demoCues: ScoreCue[] = [
  { start: 0, end: 130, home: { name: "FRA", score: 0 }, away: { name: "ENG", score: 0 }, confidence: 0.99 },
  { start: 130, end: 255, home: { name: "FRA", score: 0 }, away: { name: "ENG", score: 1 }, confidence: 0.98, event: { type: "score" } },
  { start: 255, end: 400, home: { name: "FRA", score: 0 }, away: { name: "ENG", score: 2 }, confidence: 0.98, event: { type: "score" } },
  { start: 400, end: 470, home: { name: "FRA", score: 0 }, away: { name: "ENG", score: 3 }, confidence: 0.97, event: { type: "score" } },
  { start: 470, end: 500, home: { name: "FRA", score: 0 }, away: { name: "ENG", score: 4 }, confidence: 0.98, event: { type: "score" } },
  { start: 500, end: 550, home: { name: "FRA", score: 1 }, away: { name: "ENG", score: 4 }, confidence: 0.98, event: { type: "score" } },
  { start: 550, end: 635, home: { name: "FRA", score: 2 }, away: { name: "ENG", score: 4 }, confidence: 0.98, event: { type: "score" } },
  { start: 635, end: 735, home: { name: "FRA", score: 3 }, away: { name: "ENG", score: 4 }, confidence: 0.98, event: { type: "score" } },
  { start: 735, end: 785, home: { name: "FRA", score: 3 }, away: { name: "ENG", score: 5 }, confidence: 0.98, event: { type: "score" } },
  { start: 785, end: 825, home: { name: "FRA", score: 4 }, away: { name: "ENG", score: 5 }, confidence: 0.98, event: { type: "score" } },
  { start: 825, end: DEMO_DURATION_SECONDS, home: { name: "FRA", score: 4 }, away: { name: "ENG", score: 6 }, confidence: 0.99, event: { type: "score" } },
];

const stages: Array<{ id: Exclude<Stage, "failed">; label: string }> = [
  { id: "downloading", label: "Secure source copy" },
  { id: "extracting", label: "Sample video frames" },
  { id: "analyzing", label: "Read scoreboard with AI" },
  { id: "reconciling", label: "Verify score changes" },
  { id: "exporting", label: "Build metadata track" },
  { id: "complete", label: "Ready to watch" },
];

function formatTime(value?: number) {
  if (value === undefined || !Number.isFinite(value)) return "—";
  const seconds = Math.max(0, Math.round(value));
  const minutes = Math.floor(seconds / 60);
  return `${minutes}:${String(seconds % 60).padStart(2, "0")}`;
}

function cueAt(cues: ScoreCue[], time: number) {
  let low = 0;
  let high = cues.length - 1;
  let match = cues[0];
  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    if (cues[middle].start <= time) {
      match = cues[middle];
      low = middle + 1;
    } else {
      high = middle - 1;
    }
  }
  return match;
}

function ShieldMark() {
  return <span className="shield-mark" aria-hidden="true"><span>SS</span></span>;
}

function Header({ onReset }: { onReset?: () => void }) {
  return (
    <header className="site-header">
      <button className="brand" onClick={onReset} aria-label="Score Shield home">
        <ShieldMark />
        <span>Score Shield</span>
      </button>
      <div className="header-actions">
        <a className="repository-link" href={GITHUB_REPOSITORY_URL} target="_blank" rel="noreferrer">View on GitHub <span aria-hidden="true">↗</span></a>
        <div className="privacy-pill"><span className="privacy-dot" /> Spoiler protection on</div>
      </div>
    </header>
  );
}

function Landing({ onProcess, onDemo }: { onProcess: (url: string, frameIntervalSeconds: number) => Promise<void>; onDemo: () => void }) {
  const [url, setUrl] = useState(DEFAULT_VIDEO_URL);
  const [frameIntervalSeconds, setFrameIntervalSeconds] = useState(DEFAULT_FRAME_INTERVAL_SECONDS);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError("");
    if (!/^https:\/\/(www\.)?(youtube\.com|youtu\.be)\//i.test(url)) {
      setError("Paste a valid YouTube URL to continue.");
      return;
    }
    setSubmitting(true);
    try {
      await onProcess(url, frameIntervalSeconds);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The processor could not be reached.");
      setSubmitting(false);
    }
  }

  return (
    <main>
      <section className="hero">
        <div className="hero-copy">
          <div className="eyebrow"><span /> Watch the game, not the result</div>
          <h1>Every score arrives<br /><em>right on time.</em></h1>
          <p className="lede">Score Shield reads the scoreboard from a match video, builds a time-synced metadata track, and reveals only what you have already watched.</p>
          <form className="source-form" onSubmit={submit}>
            <label htmlFor="video-url">YouTube video URL</label>
            <div className="input-row">
              <span className="youtube-glyph" aria-hidden="true">▶</span>
              <input id="video-url" value={url} onChange={(event) => setUrl(event.target.value)} spellCheck={false} />
              <button type="submit" disabled={submitting}>{submitting ? "Connecting…" : "Process video"}<span>→</span></button>
            </div>
            <div className="sampling-control">
              <div className="sampling-heading"><label htmlFor="frame-interval">Frame sampling interval</label><output htmlFor="frame-interval">{frameIntervalSeconds} seconds</output></div>
              <input id="frame-interval" type="range" min="5" max="30" step="1" value={frameIntervalSeconds} onChange={(event) => setFrameIntervalSeconds(Number(event.target.value))} aria-describedby="sampling-help" />
              <div className="sampling-scale" aria-hidden="true"><span>5s · most precise</span><span>30s · lowest cost</span></div>
              <p id="sampling-help">The final two minutes are always sampled every 5 seconds. Shorter intervals improve accuracy but analyze more frames and use more API calls.</p>
            </div>
            {error && <p className="form-error" role="alert">{error} <button type="button" onClick={onDemo}>Preview the experience instead</button></p>}
            <p className="consent">Only process media you are authorized to download and analyze.</p>
          </form>
        </div>

        <div className="score-stage" aria-label="Spoiler-free score preview">
          <div className="ambient-line line-one" />
          <div className="ambient-line line-two" />
          <div className="score-card">
            <div className="card-top"><span>LIVE AT YOUR PACE</span><span className="encrypted">● PROTECTED</span></div>
            <div className="teams">
              <div><span className="team-badge home-badge">F</span><strong>FRA</strong></div>
              <div className="score"><span>0</span><i>–</i><span>0</span></div>
              <div><span className="team-badge away-badge">E</span><strong>ENG</strong></div>
            </div>
            <div className="timeline"><span style={{ width: "37%" }} /><b style={{ left: "37%" }} /></div>
            <div className="card-bottom"><span>18:42 watched</span><span>Future score hidden</span></div>
          </div>
          <div className="floating-cue"><span>METADATA CUE</span><strong>00:18:42.000</strong><small>Score state verified · 98%</small></div>
        </div>
      </section>

      <section className="proof-strip">
        <div><strong>01</strong><span>AI reads the broadcast scoreboard</span></div>
        <div><strong>02</strong><span>Score changes become timed cues</span></div>
        <div><strong>03</strong><span>Your title follows your playhead</span></div>
      </section>

      <section className="principle">
        <p>Built for catch-up viewing</p>
        <h2>No final scores. No accidental thumbnails.<br />Just the match as it unfolds.</h2>
        <button className="text-button" onClick={onDemo}>Try the interactive demo <span>↗</span></button>
      </section>
    </main>
  );
}

function ProgressScreen({ progress, onCancel }: { progress: Progress; onCancel: () => void }) {
  const activeIndex = stages.findIndex((item) => item.id === progress.stage);
  const failed = progress.stage === "failed";
  return (
    <main className="processing-shell">
      <section className="processing-card">
        <div className="processing-title">
          <div><span className={`status-kicker ${failed ? "failed" : ""}`}><i /> {failed ? "Processing stopped" : "Processing safely"}</span><h1>{failed ? "This run needs attention" : "Building your spoiler shield"}</h1><p>{progress.message}</p></div>
          <div className="progress-orbit" style={{ "--progress": `${progress.overallProgress * 3.6}deg` } as React.CSSProperties}>
            <strong>{Math.round(progress.overallProgress)}<small>%</small></strong>
          </div>
        </div>
        <div className="overall-track"><span style={{ width: `${progress.overallProgress}%` }} /></div>
        <div className="progress-meta">
          <span>Elapsed <strong>{formatTime(progress.elapsedSeconds)}</strong></span>
          <span>Estimated remaining <strong>{formatTime(progress.etaSeconds)}</strong></span>
          {progress.totalFrames && <span>Frames <strong>{progress.processedFrames ?? 0} / {progress.totalFrames}</strong></span>}
        </div>
        <div className="stage-list">
          {stages.slice(0, -1).map((item, index) => {
            const done = activeIndex > index || progress.stage === "complete";
            const active = item.id === progress.stage;
            return <div key={item.id} className={`stage-row ${done ? "done" : ""} ${active ? "active" : ""}`}>
              <span className="stage-icon">{done ? "✓" : String(index + 1).padStart(2, "0")}</span>
              <div><strong>{item.label}</strong><small>{done ? "Complete" : active ? progress.message : "Waiting"}</small></div>
              <span className="stage-value">{done ? "100%" : active ? `${Math.round(progress.stageProgress)}%` : "—"}</span>
            </div>;
          })}
        </div>
        {failed && <div className="failed-banner" role="alert"><strong>The source was not changed.</strong><span>Check that the processor has an API key and that yt-dlp and FFmpeg are available, then try again.</span></div>}
        <div className="processing-note"><ShieldMark /><p><strong>You can leave this tab open.</strong><br />The full video is processed before playback so every seek lands on the correct score.</p><button onClick={onCancel}>Cancel</button></div>
      </section>
    </main>
  );
}

function YouTubePlayer({ videoId, onTime }: { videoId: string; onTime: (time: number) => void }) {
  const frame = useRef<HTMLIFrameElement>(null);
  const [uncovered, setUncovered] = useState(false);

  useEffect(() => {
    function receive(event: MessageEvent) {
      if (event.origin !== "https://www.youtube.com") return;
      try {
        const data = typeof event.data === "string" ? JSON.parse(event.data) : event.data;
        if (data?.event === "infoDelivery" && typeof data.info?.currentTime === "number") onTime(data.info.currentTime);
      } catch { /* Ignore unrelated frame messages. */ }
    }
    window.addEventListener("message", receive);
    const timer = window.setInterval(() => frame.current?.contentWindow?.postMessage(JSON.stringify({ event: "listening", id: "score-shield" }), "https://www.youtube.com"), 1000);
    return () => { window.removeEventListener("message", receive); window.clearInterval(timer); };
  }, [onTime]);

  return <div className="video-frame">
    <iframe ref={frame} title="Spoiler-free match video" src={`https://www.youtube.com/embed/${videoId}?enablejsapi=1&origin=${typeof window !== "undefined" ? window.location.origin : ""}&rel=0&modestbranding=1`} allow="autoplay; encrypted-media; picture-in-picture" allowFullScreen />
    {!uncovered && <button className="privacy-cover" onClick={() => setUncovered(true)}><ShieldMark /><strong>Video details are covered</strong><span>Start when you’re ready</span><i>▶</i></button>}
  </div>;
}

function PlayerScreen({ cues, videoUrl, vttUrl, onReset }: { cues: ScoreCue[]; videoUrl: string; vttUrl: string | null; onReset: () => void }) {
  const [time, setTime] = useState(0);
  const cue = useMemo(() => cueAt(cues, time), [cues, time]);
  const parsedUrl = new URL(videoUrl);
  const videoId = parsedUrl.hostname === "youtu.be" ? parsedUrl.pathname.slice(1) : parsedUrl.searchParams.get("v") ?? "jIrmswHtg9E";
  const safeTitle = `${cue.home.name} ${cue.home.score}–${cue.away.score} ${cue.away.name}`;

  useEffect(() => { document.title = `${safeTitle} · Score Shield`; }, [safeTitle]);

  return <main className="player-shell">
    <section className="player-heading">
      <div><span className="status-kicker"><i /> Synced to your playhead</span><h1>{safeTitle}</h1><p>The score above contains no information beyond this exact moment.</p></div>
      <div className="current-score"><small>{formatTime(time)}</small><strong>{cue.home.score}<i>–</i>{cue.away.score}</strong><span>{Math.round(cue.confidence * 100)}% verified</span></div>
    </section>
    <YouTubePlayer videoId={videoId} onTime={setTime} />
    <section className="player-footer">
      <div className="cue-readout"><span>ACTIVE METADATA CUE</span><strong>{formatTime(cue.start)} → {formatTime(cue.end)}</strong></div>
      <div className="safe-message"><span className="lock-icon">◆</span><p><strong>Future cues stay sealed.</strong><br />Seeking updates the title instantly without listing upcoming events.</p></div>
      <div className="player-actions">
        {vttUrl && <a className="download-button" href={vttUrl} download="score-shield.vtt">Download .vtt</a>}
        <button className="secondary-button" onClick={onReset}>Process another video</button>
      </div>
    </section>
    <section className="challenges" aria-labelledby="challenges-title">
      <div className="challenges-heading">
        <p>Prototype notes</p>
        <h2 id="challenges-title">Challenges still to solve</h2>
        <span>This reference implementation proves the score-timeline idea while leaving a few platform-level problems for future work.</span>
      </div>
      <ol className="challenge-grid">
        <li><strong>01</strong><h3>YouTube can still reveal its title</h3><p>The cover protects the initial player area, but YouTube’s own player chrome may show the source title after playback begins—and that title may contain the final score.</p></li>
        <li><strong>02</strong><h3>First-party playback is the workaround</h3><p>Playing the authorized downloaded MP4 in our own video player would remove YouTube’s title overlay. That playback path is intentionally left for a later exercise.</p></li>
        <li><strong>03</strong><h3>Portable metadata needs another step</h3><p>The prototype uses a WebVTT sidecar that the UI reads directly with JavaScript. Embedding it into the video would make the timeline portable, but browsers do not currently expose embedded metadata tracks consistently.</p></li>
      </ol>
    </section>
  </main>;
}

export default function Home() {
  const [view, setView] = useState<"landing" | "processing" | "player">("landing");
  const [videoUrl, setVideoUrl] = useState(DEFAULT_VIDEO_URL);
  const [cues, setCues] = useState<ScoreCue[]>(demoCues);
  const [vttUrl, setVttUrl] = useState<string | null>(null);
  const [progress, setProgress] = useState<Progress>({ stage: "downloading", stageProgress: 0, overallProgress: 0, message: "Preparing the source…" });
  const streamRef = useRef<EventSource | null>(null);
  const demoTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  function reset() {
    streamRef.current?.close();
    if (demoTimer.current) clearInterval(demoTimer.current);
    document.title = "Score Shield · Spoiler-free sports viewing";
    setVttUrl(null);
    setView("landing");
  }

  async function processVideo(url: string, frameIntervalSeconds: number) {
    setVideoUrl(url);
    setVttUrl(null);
    const response = await fetch(`${PROCESSOR_URL}/api/jobs`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ sourceUrl: url, frameIntervalSeconds }) });
    if (!response.ok) {
      const failure = await response.json().catch(() => null) as { error?: string } | null;
      throw new Error(failure?.error ?? "The local processor is offline. Start it, or preview the interactive demo.");
    }
    const job = await response.json() as { id: string };
    setView("processing");
    const stream = new EventSource(`${PROCESSOR_URL}/api/jobs/${job.id}/events`);
    streamRef.current = stream;
    stream.onmessage = (event) => {
      const update = JSON.parse(event.data);
      setProgress(update.progress);
      if (update.progress.stage === "complete") {
        stream.close();
        setCues(update.cues);
        setVttUrl(`${PROCESSOR_URL}/api/jobs/${job.id}/score.vtt`);
        setView("player");
      }
      if (update.progress.stage === "failed") stream.close();
    };
  }

  function startDemo() {
    setVideoUrl(DEFAULT_VIDEO_URL);
    setVttUrl(null);
    setView("processing");
    const stagePlan: Array<{ stage: Progress["stage"]; end: number; message: string }> = [
      { stage: "downloading", end: 26, message: "Downloading an authorized source copy…" },
      { stage: "extracting", end: 43, message: "Sampling timestamped frames…" },
      { stage: "analyzing", end: 88, message: "Reading FRA–ENG scoreboard changes with AI…" },
      { stage: "reconciling", end: 96, message: "Rejecting replays and verifying transitions…" },
      { stage: "exporting", end: 100, message: "Writing the WebVTT metadata track…" },
    ];
    const started = Date.now();
    let overall = 0;
    demoTimer.current = setInterval(() => {
      overall = Math.min(100, overall + 1);
      const planIndex = stagePlan.findIndex((item) => overall <= item.end);
      const plan = stagePlan[Math.max(0, planIndex)];
      const previousEnd = planIndex > 0 ? stagePlan[planIndex - 1].end : 0;
      const stageProgress = ((overall - previousEnd) / (plan.end - previousEnd)) * 100;
      setProgress({ stage: plan.stage, overallProgress: overall, stageProgress, message: plan.message, elapsedSeconds: (Date.now() - started) / 1000, etaSeconds: 100 - overall, processedFrames: plan.stage === "analyzing" ? Math.min(DEMO_FRAME_COUNT, Math.round(stageProgress * DEMO_FRAME_COUNT / 100)) : undefined, totalFrames: plan.stage === "analyzing" ? DEMO_FRAME_COUNT : undefined });
      if (overall === 100) {
        if (demoTimer.current) clearInterval(demoTimer.current);
        window.setTimeout(() => { setCues(demoCues); setView("player"); }, 500);
      }
    }, 65);
  }

  return <div className="app-shell">
    <Header onReset={reset} />
    {view === "landing" && <Landing onProcess={processVideo} onDemo={startDemo} />}
    {view === "processing" && <ProgressScreen progress={progress} onCancel={reset} />}
    {view === "player" && <PlayerScreen cues={cues} videoUrl={videoUrl} vttUrl={vttUrl} onReset={reset} />}
    <footer><span>Score Shield · Reference implementation</span><span>Metadata, not spoilers.</span></footer>
  </div>;
}
