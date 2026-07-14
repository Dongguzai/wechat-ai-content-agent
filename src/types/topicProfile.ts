import type { LlmRunMetadata } from "./llm.js";

export type TopicPrimaryDomain =
  | "model"
  | "product"
  | "tooling"
  | "research"
  | "business"
  | "policy"
  | "application"
  | "creator"
  | "security"
  | "other";

export type TopicEventType =
  | "launch"
  | "update"
  | "benchmark"
  | "pricing"
  | "funding"
  | "acquisition"
  | "regulation"
  | "case_study"
  | "incident"
  | "opinion"
  | "tutorial"
  | "research_release";

export type TopicContentMode =
  | "news_analysis"
  | "comparison"
  | "explainer"
  | "trend_analysis"
  | "case_review"
  | "practical_guide";

export interface TopicEntity {
  name: string;
  type: string;
}

export interface TopicProfile {
  schemaVersion: "1.0";
  id: string;
  topicId: string;
  primaryDomain: TopicPrimaryDomain;
  secondaryDomains: string[];
  eventTypes: TopicEventType[];
  entities: TopicEntity[];
  targetAudiences: string[];
  readerQuestions: string[];
  evidenceNeeds: string[];
  riskDimensions: string[];
  recommendedContentMode: TopicContentMode;
  confidence: number;
  classificationReason: string;
  generatedAt: string;
}

export interface TopicProfileOutputFiles {
  topicProfileJson: string;
  topicProfileReport: string;
}

export interface TopicProfileResult {
  outputDir: string;
  files: TopicProfileOutputFiles;
  profile: TopicProfile;
  report: string;
  llm?: LlmRunMetadata;
}
