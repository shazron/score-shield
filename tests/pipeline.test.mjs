import assert from "node:assert/strict";
import test from "node:test";
import { cuesToVtt, reconcileObservations } from "../server/pipeline.mjs";

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

test("exports JSON score states as valid-looking WebVTT cues", () => {
  const vtt = cuesToVtt([{ start: 0, end: 62.5, home: { name: "A", score: 0 }, away: { name: "B", score: 0 }, confidence: .9 }]);
  assert.match(vtt, /^WEBVTT/);
  assert.match(vtt, /00:00:00\.000 --> 00:01:02\.500/);
  assert.match(vtt, /"home":\{"name":"A","score":0\}/);
});
