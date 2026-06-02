import { createNeonDbAdapter } from "../../../src/adapters/neon";
import { createR2Adapter } from "../../../src/adapters/r2";
import {
  generateCloudEditorialBrief,
  getTodayEditorialBrief
} from "../../../src/pipeline/generateCloudEditorialBrief";

export function createCloudBriefServices(env: NodeJS.ProcessEnv = process.env) {
  return {
    db: createNeonDbAdapter(env),
    r2: createR2Adapter(env)
  };
}

export async function generateCloudBriefForToday(env: NodeJS.ProcessEnv = process.env) {
  const services = createCloudBriefServices(env);
  return await generateCloudEditorialBrief({
    db: services.db,
    r2: services.r2,
    env
  });
}

export async function getCloudBriefForToday(env: NodeJS.ProcessEnv = process.env) {
  const services = createCloudBriefServices(env);
  return await getTodayEditorialBrief({
    db: services.db,
    env
  });
}
