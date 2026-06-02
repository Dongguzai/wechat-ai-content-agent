import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  readCurrentCrontab,
  removeBriefCronBlocks,
  writeCurrentCrontab
} from "./scheduler-cron.js";

export async function uninstallBriefCron(): Promise<void> {
  const current = await readCurrentCrontab();
  const next = removeBriefCronBlocks(current);
  await writeCurrentCrontab(next ? `${next}\n` : "");
}

async function main(): Promise<void> {
  await uninstallBriefCron();
  console.log("[scheduler:uninstall-brief] removed editorial brief cron block.");
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))
) {
  await main();
}
