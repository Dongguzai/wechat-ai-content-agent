import type { ResolvedPolicy } from "../config/policyRegistry.js";
import type { TopicContentMode, TopicEventType, TopicPrimaryDomain } from "./topicProfile.js";

export interface EditorialPlanSection {
  id: string;
  role: "context" | "facts" | "analysis" | "impact" | "risks" | "next_steps";
  heading: string;
  purpose: string;
  allowedClaimIds: string[];
  requiredEvidenceIds: string[];
  keyQuestions: string[];
  writingInstructions: string[];
  riskControls: string[];
}

export interface EditorialPlan {
  schemaVersion: "1.0";
  id: string;
  topicId: string;
  primaryDomain: TopicPrimaryDomain;
  eventTypes: TopicEventType[];
  contentMode: TopicContentMode;
  audience: string[];
  thesis: string;
  tone: string;
  structure: string[];
  sections: EditorialPlanSection[];
  requiredThemes: string[];
  forbiddenWording: string[];
  riskControls: string[];
  policyRefs: Array<{
    id: string;
    version: string;
    scope: ResolvedPolicy["scope"];
    sourcePath: string;
    matchReasons: string[];
  }>;
  generatedAt: string;
}

export interface EditorialPlanOutputFiles {
  editorialPlanJson: string;
  editorialPlanReport: string;
}

export interface EditorialPlanResult {
  outputDir: string;
  files: EditorialPlanOutputFiles;
  plan: EditorialPlan;
  report: string;
}
