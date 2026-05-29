export type WechatDraftMode = "mock";

export type WechatDraftStatus = "draft_saved";

export type WechatDraftActionStatus = "passed" | "blocked";

export interface WechatDraftAction {
  label: string;
  status: WechatDraftActionStatus;
  reason?: string;
}

export interface WechatDraftSafety {
  autoPublishBlocked: true;
  onlyDraftSaved: true;
  requiresHumanConfirmation: true;
  forbiddenActionsChecked: string[];
}

export interface WechatDraftResult {
  mode: WechatDraftMode;
  status: WechatDraftStatus;
  title: string;
  draftId: string;
  previewUrl: string;
  htmlPath: "outputs/wechat.html";
  coverImagePath: string;
  actions: WechatDraftAction[];
  safety: WechatDraftSafety;
  allowedNextStage: false;
  humanActionRequired: "请人工登录微信公众号后台检查草稿预览，确认无误后再手动发布。";
  generatedAt: string;
}

export interface WechatDraftOutputFiles {
  wechatDraftResult: string;
  wechatDraftReport: string;
}

export interface WechatDraftPipelineResult {
  outputDir: string;
  files: WechatDraftOutputFiles;
  result: WechatDraftResult;
  report: string;
}
