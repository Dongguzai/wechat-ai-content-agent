import assert from "node:assert/strict";
import test from "node:test";
import { projectRoot } from "../src/config/env.js";
import {
  createProjectCronBlock,
  installProjectCronText,
  removeProjectCronBlocks,
  showProjectCronText
} from "../scripts/scheduler-cron.js";

test("scheduler:install generates the daily 8 AM project cron block", () => {
  const installed = installProjectCronText("15 9 * * * echo keep-me\n");

  assert.match(installed, /# wechat-ai-content-agent daily auto start/);
  assert.match(installed, /# wechat-ai-content-agent daily auto end/);
  assert.match(
    installed,
    new RegExp(
      `0 8 \\* \\* \\* cd ${projectRoot.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")} && pnpm run:daily:auto >> logs/daily-auto\\.log 2>&1`
    )
  );
  assert.match(installed, /15 9 \* \* \* echo keep-me/);
});

test("scheduler:uninstall only removes the current project cron block", () => {
  const otherCron = "30 7 * * * echo keep-me";
  const projectCron = createProjectCronBlock();
  const removed = removeProjectCronBlocks(`${otherCron}\n${projectCron}\n`);

  assert.equal(removed, otherCron);
});

test("scheduler:show displays only project-related cron entries", () => {
  const otherCron = "30 7 * * * echo keep-me";
  const projectCron = createProjectCronBlock();
  const shown = showProjectCronText(`${otherCron}\n${projectCron}\n`);

  assert.match(shown, /wechat-ai-content-agent daily auto start/);
  assert.match(shown, /pnpm run:daily:auto/);
  assert.doesNotMatch(shown, /echo keep-me/);
});
