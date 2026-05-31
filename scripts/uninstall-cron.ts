import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  readCurrentCrontab,
  removeProjectCronBlocks,
  writeCurrentCrontab
} from "./scheduler-cron.js";

export async function uninstallProjectCron(): Promise<void> {
  const current = await readCurrentCrontab();
  const next = removeProjectCronBlocks(current);
  await writeCurrentCrontab(next ? `${next}\n` : "");
}

async function main(): Promise<void> {
  await uninstallProjectCron();
  console.log("[scheduler:uninstall] removed project cron block.");
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))
) {
  await main();
}
