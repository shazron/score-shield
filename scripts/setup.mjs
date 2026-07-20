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

import { copyFile, access } from "node:fs/promises";
import { constants } from "node:fs";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";

const requiredNode = [22, 13, 0];
const mediaTools = ["ffmpeg", "ffprobe", "yt-dlp"];

function versionAtLeast(current, required) {
  const values = current.split(".").map(Number);
  for (let index = 0; index < required.length; index += 1) {
    if ((values[index] ?? 0) > required[index]) return true;
    if ((values[index] ?? 0) < required[index]) return false;
  }
  return true;
}

function commandExists(command) {
  const lookup = process.platform === "win32" ? "where" : "which";
  return spawnSync(lookup, [command], { stdio: "ignore" }).status === 0;
}

function elevated(command, args) {
  if (process.platform !== "win32" && typeof process.getuid === "function" && process.getuid() !== 0) {
    if (!commandExists("sudo")) throw new Error(`Installing system packages requires root access, but sudo is unavailable. Run as root: ${command} ${args.join(" ")}`);
    return { command: "sudo", args: [command, ...args] };
  }
  return { command, args };
}

export function getInstallPlan(platform, manager, missing) {
  const needsFfmpeg = missing.includes("ffmpeg") || missing.includes("ffprobe");
  const needsYtDlp = missing.includes("yt-dlp");
  if (!needsFfmpeg && !needsYtDlp) return [];

  if (platform === "darwin" && manager === "brew") {
    return [{ command: "brew", args: ["install", ...[needsFfmpeg && "ffmpeg", needsYtDlp && "yt-dlp"].filter(Boolean)] }];
  }
  if (platform === "linux" && manager === "brew") {
    return [{ command: "brew", args: ["install", ...[needsFfmpeg && "ffmpeg", needsYtDlp && "yt-dlp"].filter(Boolean)] }];
  }
  if (platform === "linux" && manager === "apt-get") {
    return [
      elevated("apt-get", ["update"]),
      elevated("apt-get", ["install", "-y", ...[needsFfmpeg && "ffmpeg", needsYtDlp && "yt-dlp"].filter(Boolean)]),
    ];
  }
  if (platform === "linux" && manager === "dnf") {
    return [elevated("dnf", ["install", "-y", ...[needsFfmpeg && "ffmpeg", needsYtDlp && "yt-dlp"].filter(Boolean)])];
  }
  if (platform === "linux" && manager === "pacman") {
    return [elevated("pacman", ["-S", "--needed", "--noconfirm", ...[needsFfmpeg && "ffmpeg", needsYtDlp && "yt-dlp"].filter(Boolean)])];
  }
  if (platform === "win32" && manager === "winget") {
    const common = ["--exact", "--accept-package-agreements", "--accept-source-agreements"];
    return [
      ...(needsFfmpeg ? [{ command: "winget", args: ["install", "--id", "Gyan.FFmpeg", ...common] }] : []),
      ...(needsYtDlp ? [{ command: "winget", args: ["install", "--id", "yt-dlp.yt-dlp", ...common] }] : []),
    ];
  }
  if (platform === "win32" && manager === "choco") {
    return [{ command: "choco", args: ["install", "-y", ...[needsFfmpeg && "ffmpeg", needsYtDlp && "yt-dlp"].filter(Boolean)] }];
  }
  return [];
}

function findManager(platform) {
  const candidates = platform === "darwin"
    ? ["brew"]
    : platform === "linux"
      ? ["brew", "apt-get", "dnf", "pacman"]
      : platform === "win32"
        ? ["winget", "choco"]
        : [];
  return candidates.find(commandExists);
}

function runStep({ command, args }, dryRun) {
  console.log(`\n› ${command} ${args.join(" ")}`);
  if (dryRun) return;
  const result = spawnSync(command, args, { stdio: "inherit", shell: false });
  if (result.error) throw new Error(`Could not start ${command}: ${result.error.message}`);
  if (result.status !== 0) throw new Error(`${command} exited with status ${result.status}.`);
}

async function ensureEnvironmentFile(dryRun) {
  try {
    await access(".env", constants.F_OK);
    console.log("✓ .env already exists");
  } catch {
    console.log("› copy .env.example .env");
    if (!dryRun) await copyFile(".env.example", ".env", constants.COPYFILE_EXCL);
    console.log(dryRun ? "· Would create .env; add OPENAI_API_KEY before real analysis" : "✓ Created .env; add OPENAI_API_KEY before real analysis");
  }
}

export async function main(args = process.argv.slice(2)) {
  const checkOnly = args.includes("--check");
  const dryRun = args.includes("--dry-run");
  const nodeVersion = process.versions.node;
  if (!versionAtLeast(nodeVersion, requiredNode)) throw new Error(`Node.js ${requiredNode.join(".")} or newer is required; found ${nodeVersion}.`);

  console.log(`Score Shield setup · ${process.platform}/${process.arch}`);
  console.log(`✓ Node.js ${nodeVersion}`);

  if (!checkOnly) runStep({ command: process.platform === "win32" ? "npm.cmd" : "npm", args: ["install", "--no-audit", "--no-fund"] }, dryRun);

  const missing = mediaTools.filter((tool) => !commandExists(tool));
  for (const tool of mediaTools.filter((item) => !missing.includes(item))) console.log(`✓ ${tool} is available`);

  if (missing.length && !checkOnly) {
    const manager = findManager(process.platform);
    if (!manager) {
      const suggestion = process.platform === "darwin"
        ? "Install Homebrew from https://brew.sh, then run this command again."
        : process.platform === "win32"
          ? "Install Winget or Chocolatey, then run this command again."
          : "Install Homebrew, apt, dnf, or pacman, then run this command again.";
      throw new Error(`Missing ${missing.join(", ")} and no supported package manager was found. ${suggestion}`);
    }
    console.log(`\nInstalling ${missing.join(", ")} with ${manager}…`);
    for (const step of getInstallPlan(process.platform, manager, missing)) runStep(step, dryRun);
  }

  if (!checkOnly) await ensureEnvironmentFile(dryRun);
  if (!dryRun) {
    const stillMissing = mediaTools.filter((tool) => !commandExists(tool));
    if (stillMissing.length) {
      const suffix = process.platform === "win32" ? " Restart the terminal so newly installed PATH entries take effect, then run npm run setup:check." : "";
      throw new Error(`Setup finished, but these commands are not yet on PATH: ${stillMissing.join(", ")}.${suffix}`);
    }
  }

  if (checkOnly && missing.length) throw new Error(`Missing required commands: ${missing.join(", ")}. Run npm run setup to install them.`);
  console.log("\n✓ Score Shield is ready. Run npm run dev to start it.");
}

const invokedDirectly = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) main().catch((error) => { console.error(`\nSetup failed: ${error.message}`); process.exitCode = 1; });
