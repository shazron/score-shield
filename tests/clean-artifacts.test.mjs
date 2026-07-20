import assert from "node:assert/strict";
import { access, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { cleanJobArtifacts } from "../scripts/clean-artifacts.mjs";

test("removes isolated job directories while preserving the YouTube cache", async () => {
  const artifactsRoot = await mkdtemp(path.join(tmpdir(), "score-shield-artifacts-"));
  const jobId = "48e02d2a-9600-471b-942e-81835655836f";
  const cachedSource = path.join(artifactsRoot, "cache", "youtube", "video-key", "source.mp4");
  const unrelatedDirectory = path.join(artifactsRoot, "keep-me");
  try {
    await mkdir(path.join(artifactsRoot, jobId, "frames"), { recursive: true });
    await writeFile(path.join(artifactsRoot, jobId, "manifest.json"), "{}");
    await mkdir(path.dirname(cachedSource), { recursive: true });
    await writeFile(cachedSource, "cached video");
    await mkdir(unrelatedDirectory);

    assert.deepEqual(await cleanJobArtifacts(artifactsRoot), [jobId]);
    await assert.rejects(access(path.join(artifactsRoot, jobId)), { code: "ENOENT" });
    await access(cachedSource);
    await access(unrelatedDirectory);
  } finally {
    await rm(artifactsRoot, { recursive: true, force: true });
  }
});

test("succeeds when the artifacts root does not exist", async () => {
  const missingRoot = path.join(tmpdir(), `score-shield-missing-${crypto.randomUUID()}`);
  assert.deepEqual(await cleanJobArtifacts(missingRoot), []);
});
