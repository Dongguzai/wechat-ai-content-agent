import assert from "node:assert/strict";
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import test from "node:test";
import { archiveRunOutputs } from "../src/pipeline/archiveRun.js";

test("archiveRunOutputs copies core run artifacts into a timestamped runs directory", async () => {
  const root = await mkdtemp(join(tmpdir(), "run-archive-"));
  const outputDir = join(root, "outputs");
  const runsDir = join(root, "runs");

  try {
    await mkdir(join(outputDir, "covers"), { recursive: true });
    await writeFile(join(outputDir, "article.md"), "# title\n", "utf8");
    await writeFile(join(outputDir, "wechat.html"), "<section>ok</section>\n", "utf8");
    await writeFile(join(outputDir, "covers", "cover.svg"), "<svg />\n", "utf8");

    const result = await archiveRunOutputs({
      outputDir,
      runsDir,
      now: new Date(2026, 4, 29, 8, 9, 10),
      relativePaths: ["article.md", "wechat.html", "covers"]
    });

    assert.equal(basename(result.archiveDir), "2026-05-29-080910");
    await access(join(result.archiveDir, "article.md"));
    await access(join(result.archiveDir, "wechat.html"));
    await access(join(result.archiveDir, "covers", "cover.svg"));

    const manifest = JSON.parse(
      await readFile(result.manifestPath, "utf8")
    ) as { entries: unknown[]; missing: string[] };

    assert.equal(manifest.entries.length, 3);
    assert.deepEqual(manifest.missing, []);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
