import type { SourceReliability } from "./news.js";

export type WechatApiDraftMode = "api_dry_run" | "real_api";

export type WechatApiDraftStatus =
  | "request_preview_generated"
  | "draft_created";

export type WechatApiThumbMediaIdSource = "env" | "uploaded";

export interface WechatApiDraftArticle {
  title: string;
  author: string;
  digest: string;
  content: string;
  content_source_url: string;
  thumb_media_id: string;
  need_open_comment: 0 | 1;
  only_fans_can_comment: 0 | 1;
}

export interface WechatApiDraftAddRequest {
  articles: [WechatApiDraftArticle];
}

export interface WechatApiRequestPreview {
  endpoint: "/cgi-bin/draft/add";
  title: string;
  hasContent: true;
  hasThumbMediaId: boolean;
  contentLength: number;
}

export interface WechatApiDraftSafety {
  draftOnly: true;
  publishApiCalled: false;
  massSendApiCalled: false;
  requiresHumanConfirmation: true;
}

export interface WechatApiDraftDryRunResult {
  mode: "api_dry_run";
  status: "request_preview_generated";
  requestPreview: WechatApiRequestPreview;
  safety: WechatApiDraftSafety;
  generatedAt: string;
}

export interface WechatApiDraftRealResult {
  mode: "real_api";
  status: "draft_created";
  mediaId: string;
  title: string;
  thumbMediaIdSource: WechatApiThumbMediaIdSource;
  htmlPath: "outputs/wechat.html";
  coverImagePath: string;
  safety: WechatApiDraftSafety;
  generatedAt: string;
}

export type WechatApiDraftResult =
  | WechatApiDraftDryRunResult
  | WechatApiDraftRealResult;

export interface WechatApiPreflight {
  mode: WechatApiDraftMode;
  realApiRequested: boolean;
  dryRun: boolean;
  realDraftSwitchEnabled: boolean;
  realApiAllowSwitchEnabled: boolean;
  appIdPresent: boolean;
  appSecretPresent: boolean;
  articleReviewPassed: boolean;
  coverReviewPassed: boolean;
  layoutAllowedNextStage: boolean;
  htmlExists: boolean;
  htmlPath: "outputs/wechat.html";
  coverJsonExists: boolean;
  coverImagePath: string;
  coverImageExists: boolean;
  coverIsMockSvg: boolean;
  coverUploadable: boolean;
  thumbMediaIdFromEnv: boolean;
  sourceReliability: SourceReliability | "unknown";
  sourceReliabilityAllowed: boolean;
  forbidAutoPublishHookEnabled: boolean;
  forbidWechatPublishApiHookEnabled: boolean;
  forbidPublishEnvEnabled: boolean;
  forbidMassSendEnvEnabled: boolean;
  draftOnlyGuardEnabled: boolean;
  publishApiCalled: false;
  massSendApiCalled: false;
  issues: string[];
  passed: boolean;
  generatedAt: string;
}

export interface WechatApiDraftOutputFiles {
  wechatApiDraftResult: string;
  wechatApiDraftReport: string;
  wechatApiPreflight: string;
}

export interface WechatApiDraftPipelineResult {
  outputDir: string;
  files: WechatApiDraftOutputFiles;
  preflight: WechatApiPreflight;
  result: WechatApiDraftResult;
  report: string;
}
