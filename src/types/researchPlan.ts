import type { ResolvedPolicy } from "../config/policyRegistry.js";
import type { TopicEventType, TopicPrimaryDomain } from "./topicProfile.js";

export type ResearchTaskPriority = "high" | "medium" | "low";

export interface ResearchTask {
  id: string;
  question: string;
  expectedEvidence: string[];
  priority: ResearchTaskPriority;
  relatedEventTypes: TopicEventType[];
  relatedRiskDimensions: string[];
  policyIds: string[];
}

export interface ResearchPlan {
  schemaVersion: "1.0";
  id: string;
  topicId: string;
  primaryDomain: TopicPrimaryDomain;
  eventTypes: TopicEventType[];
  riskDimensions: string[];
  policyRefs: Array<{
    id: string;
    version: string;
    scope: ResolvedPolicy["scope"];
    sourcePath: string;
    matchReasons: string[];
  }>;
  tasks: ResearchTask[];
  sourcePriorities: string[];
  stopConditions: string[];
  generatedAt: string;
}

export interface ResearchPlanOutputFiles {
  researchPlanJson: string;
  researchPlanReport: string;
}

export interface ResearchPlanResult {
  outputDir: string;
  files: ResearchPlanOutputFiles;
  plan: ResearchPlan;
  report: string;
}
