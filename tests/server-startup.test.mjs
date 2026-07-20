import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { validateProcessorEnvironment } from "../server/startup.mjs";

test("processor startup rejects a missing or blank OpenAI API key", () => {
  assert.throws(() => validateProcessorEnvironment({}), /OPENAI_API_KEY is missing/);
  assert.throws(() => validateProcessorEnvironment({ OPENAI_API_KEY: "   " }), /OPENAI_API_KEY is missing/);
});

test("processor startup accepts a configured OpenAI API key", () => {
  assert.doesNotThrow(() => validateProcessorEnvironment({ OPENAI_API_KEY: "test-placeholder" }));
});

test("processor exits with actionable output before listening when the key is absent", () => {
  const serverPath = fileURLToPath(new URL("../server/index.mjs", import.meta.url));
  const result = spawnSync(process.execPath, [serverPath], {
    encoding: "utf8",
    env: { ...process.env, OPENAI_API_KEY: "" },
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Processor startup failed/);
  assert.match(result.stderr, /Add OPENAI_API_KEY=your_key_here to \.env/);
  assert.doesNotMatch(result.stdout, /Processor listening/);
});
