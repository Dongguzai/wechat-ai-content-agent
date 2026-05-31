import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  createProjectCronBlock,
  installProjectCronText,
  readCurrentCrontab,
  writeCurrentCrontab
} from "./scheduler-cron.js";

export async function installProjectCron(): Promise<string> {
  const current = await readCurrentCrontab();
  const next = installProjectCronText(current);
  await writeCurrentCrontab(next);
  return createProjectCronBlock();
}

async function main(): Promise<void> {
  const block = await installProjectCron();
  console.log("[scheduler:install] installed project cron:");
  console.log(block);
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))
) {
  await main();
}
