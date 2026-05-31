import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { readCurrentCrontab, showProjectCronText } from "./scheduler-cron.js";

export async function showProjectCron(): Promise<string> {
  const current = await readCurrentCrontab();
  return showProjectCronText(current);
}

async function main(): Promise<void> {
  const projectCron = await showProjectCron();

  if (!projectCron) {
    console.log("[scheduler:show] no project cron installed.");
    return;
  }

  console.log(projectCron);
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))
) {
  await main();
}
