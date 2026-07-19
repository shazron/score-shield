import assert from "node:assert/strict";
import test from "node:test";
import { getInstallPlan } from "../scripts/setup.mjs";

test("uses one Homebrew operation for macOS dependencies", () => {
  assert.deepEqual(getInstallPlan("darwin", "brew", ["ffmpeg", "ffprobe", "yt-dlp"]), [
    { command: "brew", args: ["install", "ffmpeg", "yt-dlp"] },
  ]);
});

test("uses apt update and install on Debian-family Linux", () => {
  const plan = getInstallPlan("linux", "apt-get", ["yt-dlp"]);
  assert.equal(plan.length, 2);
  assert.deepEqual(plan.at(-1).args.slice(-3), ["install", "-y", "yt-dlp"]);
});

test("uses separate Winget package identifiers on Windows", () => {
  const plan = getInstallPlan("win32", "winget", ["ffmpeg", "ffprobe", "yt-dlp"]);
  assert.equal(plan.length, 2);
  assert.ok(plan[0].args.includes("Gyan.FFmpeg"));
  assert.ok(plan[1].args.includes("yt-dlp.yt-dlp"));
});
