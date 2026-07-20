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

const children = [
  spawn(process.execPath, ["--env-file-if-exists=.env", "server/index.mjs"], { stdio: "inherit", env: process.env }),
  spawn("npm", ["run", "dev:web"], { stdio: "inherit", env: process.env }),
];

function stop(signal = "SIGTERM") {
  for (const child of children) if (!child.killed) child.kill(signal);
}

process.on("SIGINT", () => { stop("SIGINT"); process.exit(130); });
process.on("SIGTERM", () => { stop(); process.exit(143); });
for (const child of children) child.on("exit", (code) => { if (code && code !== 130) { stop(); process.exit(code); } });
