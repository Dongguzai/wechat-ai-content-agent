import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  createBriefCronBlock,
  installBriefCronText,
  readCurrentCrontab,
  writeCurrentCrontab
} from "./scheduler-cron.js";

export async function installBriefCron(): Promise<string> {
  const current = await readCurrentCrontab();
  const next = installBriefCronText(current);
  await writeCurrentCrontab(next);
  return createBriefCronBlock();
}

async function main(): Promise<void> {
  const block = await installBriefCron();
  console.log("[scheduler:install-brief] installed editorial brief cron:");
  console.log(block);
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))
) {
  await main();
}
