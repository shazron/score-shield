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

import { readdir, rm } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

const JOB_DIRECTORY_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function cleanJobArtifacts(artifactsRoot = path.resolve(process.env.ARTIFACTS_DIR || "artifacts")) {
  let entries;
  try {
    entries = await readdir(artifactsRoot, { withFileTypes: true });
  } catch (error) {
    if (error?.code === "ENOENT") return [];
    throw error;
  }

  const jobDirectories = entries
    .filter((entry) => entry.isDirectory() && JOB_DIRECTORY_PATTERN.test(entry.name))
    .map((entry) => entry.name)
    .sort();
  await Promise.all(jobDirectories.map((name) => rm(path.join(artifactsRoot, name), {
    recursive: true,
    force: true,
    maxRetries: 3,
    retryDelay: 100,
  })));
  return jobDirectories;
}

export async function main() {
  const artifactsRoot = path.resolve(process.env.ARTIFACTS_DIR || "artifacts");
  const removed = await cleanJobArtifacts(artifactsRoot);
  console.log(removed.length
    ? `Removed ${removed.length} job artifact director${removed.length === 1 ? "y" : "ies"}. YouTube cache preserved.`
    : "No job artifact directories found. YouTube cache preserved.");
}

const invokedDirectly = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) main().catch((error) => {
  console.error(`Artifact cleanup failed: ${error.message}`);
  process.exitCode = 1;
});
