import { forbidAutoPublish } from "../hooks/forbidAutoPublish.js";
import type {
  ArticleDraft,
  CoverInfo,
  WechatDraftResult,
  WechatHtmlRender
} from "../types/article.js";

export interface SaveWechatDraftInput {
  article: ArticleDraft;
  cover: CoverInfo;
  html: WechatHtmlRender;
}

export async function saveWechatDraft(
  input: SaveWechatDraftInput
): Promise<WechatDraftResult> {
  forbidAutoPublish(`${input.article.title}\n${input.html.html}\n${input.cover.altText}`);

  return {
    mode: "mock",
    draftId: `mock-draft-${Date.now()}`,
    title: input.article.title,
    status: "mock_saved",
    savedAt: new Date().toISOString(),
    note: "Mock only. No WeChat Admin call, no browser automation, no external service request."
  };
}
