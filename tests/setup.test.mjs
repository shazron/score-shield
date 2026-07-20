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
