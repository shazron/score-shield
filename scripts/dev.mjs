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
