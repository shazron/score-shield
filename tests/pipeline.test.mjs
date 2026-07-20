import assert from "node:assert/strict";
import test from "node:test";
import { buildFrameSamplingPlan, parseFrameInterval, samplingFrameTimestamp } from "../server/config.mjs";
import { cuesToVtt, parseObservation, reconcileObservations, sourceCacheKey } from "../server/pipeline.mjs";

test("accepts only frame intervals from 5 to 30 seconds", () => {
  assert.equal(parseFrameInterval(undefined), 10);
  assert.equal(parseFrameInterval(""), 10);
  assert.equal(parseFrameInterval(5), 5);
  assert.equal(parseFrameInterval(20), 20);
  assert.equal(parseFrameInterval(30), 30);
  assert.equal(parseFrameInterval(4), null);
  assert.equal(parseFrameInterval(31), null);
  assert.equal(parseFrameInterval(7.5), null);
});

test("samples the final two minutes every 5 seconds", () => {
  assert.deepEqual(buildFrameSamplingPlan(917, 20), [
    { start: 0, end: 797, interval: 20 },
    { start: 797, end: 917, interval: 5 },
  ]);
});

test("keeps 5-second sampling unchanged and overrides an entire short video", () => {
  assert.deepEqual(buildFrameSamplingPlan(917, 5), [{ start: 0, end: 917, interval: 5 }]);
  assert.deepEqual(buildFrameSamplingPlan(45, 30), [{ start: 0, end: 45, interval: 5 }]);
});

test("timestamps FPS-filtered frames at the center of their sampling buckets", () => {
  assert.equal(samplingFrameTimestamp({ start: 800, end: 860, interval: 10 }, 0, 917), 805);
  assert.equal(samplingFrameTimestamp({ start: 800, end: 860, interval: 10 }, 2, 917), 825);
});

test("uses one cache entry for equivalent YouTube video URLs", () => {
  const watch = sourceCacheKey("https://www.youtube.com/watch?v=jIrmswHtg9E&t=30");
  const short = sourceCacheKey("https://youtu.be/jIrmswHtg9E?si=example");
  assert.equal(watch, short);
  assert.notEqual(watch, sourceCacheKey("https://www.youtube.com/watch?v=anotherVideo"));
});

test("accepts null team names when a frame has no live scoreboard", () => {
  const observation = parseObservation({
    found: false,
    homeName: null,
    awayName: null,
    homeScore: null,
    awayScore: null,
    confidence: 0.2,
  });
  assert.equal(observation.found, false);
  assert.equal(observation.homeName, null);
  assert.equal(observation.awayName, null);
});

test("reconciles repeated scoreboard observations and rejects regressions", () => {
  const base = { found: true, homeName: "Home", awayName: "Away", confidence: .95 };
  const cues = reconcileObservations([
    { ...base, timestamp: 0, frame: "1.jpg", homeScore: 0, awayScore: 0 },
    { ...base, timestamp: 20, frame: "2.jpg", homeScore: 0, awayScore: 0 },
    { ...base, timestamp: 40, frame: "3.jpg", homeScore: 1, awayScore: 0 },
    { ...base, timestamp: 60, frame: "4.jpg", homeScore: 1, awayScore: 0 },
    { ...base, timestamp: 80, frame: "5.jpg", homeScore: 0, awayScore: 0 },
  ], 100);
  assert.deepEqual(cues.map((cue) => [cue.start, cue.end, cue.home.score, cue.away.score]), [[0, 40, 0, 0], [40, 100, 1, 0]]);
});

test("keeps team labels stable and confirms fast consecutive score changes", () => {
  const frames = [
    [80, "France", 0, "England", 0],
    [100, "FRA", 0, "ENG", 0],
    [180, "FRA", 0, "ENG", 1],
    [200, "FRA", 0, "ENG", 1],
    [280, "France", 0, "England", 2],
    [300, "FRA", 0, "ENG", 2],
    [420, "France", 0, "England", 3],
    [440, "FRA", 0, "ENG", 4],
    [480, "FRA", 0, "ENG", 4],
    [520, "FRA", 1, "ENG", 4],
    [560, "France", 2, "England", 4],
    [580, "FRA", 2, "ENG", 4],
    [640, "FRA", 3, "ENG", 4],
    [660, "FRA", 3, "ENG", 4],
    [740, "FRA", 3, "ENG", 5],
    [800, "FRA", 4, "ENG", 5],
    [820, "FRA", 4, "ENG", 6],
    [860, null, 4, null, 5],
    [900, "France", 4, "England", 6],
  ].map(([timestamp, homeName, homeScore, awayName, awayScore], index) => ({
    found: true,
    homeName,
    homeScore,
    awayName,
    awayScore,
    confidence: 0.99,
    timestamp,
    frame: `${index + 1}.jpg`,
  }));
  const cues = reconcileObservations(frames, 917);
  assert.deepEqual(cues.map((cue) => [cue.start, cue.home.score, cue.away.score]), [
    [0, 0, 0], [180, 0, 1], [280, 0, 2], [420, 0, 3], [440, 0, 4], [520, 1, 4],
    [560, 2, 4], [640, 3, 4], [740, 3, 5], [800, 4, 5], [820, 4, 6],
  ]);
  assert.ok(cues.every((cue) => cue.home.name === "FRA" && cue.away.name === "ENG"));
  assert.equal(cues.at(-1).end, 917);
});

test("confirms the test video's final score from consecutive closing-window frames", () => {
  const base = { found: true, homeName: "FRA", awayName: "ENG", confidence: .99 };
  const cues = reconcileObservations([
    { ...base, timestamp: 804.5, frame: "before-1.jpg", homeScore: 4, awayScore: 5 },
    { ...base, timestamp: 809.5, frame: "before-2.jpg", homeScore: 4, awayScore: 5 },
    { ...base, timestamp: 829.5, frame: "final-1.jpg", homeScore: 4, awayScore: 6 },
    { ...base, timestamp: 834.5, frame: "final-2.jpg", homeScore: 4, awayScore: 6 },
  ], 916.694);
  assert.deepEqual(cues.map((cue) => [cue.start, cue.home.score, cue.away.score]), [
    [0, 4, 5],
    [829.5, 4, 6],
  ]);
});

test("exports JSON score states as valid-looking WebVTT cues", () => {
  const vtt = cuesToVtt([{ start: 0, end: 62.5, home: { name: "A", score: 0 }, away: { name: "B", score: 0 }, confidence: .9 }]);
  assert.match(vtt, /^WEBVTT/);
  assert.match(vtt, /00:00:00\.000 --> 00:01:02\.500/);
  assert.match(vtt, /"home":\{"name":"A","score":0\}/);
});
