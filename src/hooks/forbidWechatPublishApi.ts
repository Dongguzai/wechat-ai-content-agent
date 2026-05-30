import { forbidAutoPublish } from "./forbidAutoPublish.js";

export const FORBIDDEN_WECHAT_PUBLISH_API_TERMS = [
  "freepublish",
  "mass",
  "sendall",
  "publish",
  "群发",
  "发布",
  "确认发送",
  "立即发送"
] as const;

export interface WechatPublishApiGuardInput {
  url?: string;
  actionName?: string;
}

export function forbidWechatPublishApi(input: WechatPublishApiGuardInput): void {
  const url = input.url ?? "";
  const actionName = input.actionName ?? "";

  if (actionName) {
    forbidAutoPublish(actionName);
  }

  const target = `${url} ${actionName}`.toLowerCase();
  const matchedTerm = FORBIDDEN_WECHAT_PUBLISH_API_TERMS.find((term) =>
    target.includes(term.toLowerCase())
  );

  if (matchedTerm) {
    throw new Error(`Forbidden WeChat publish API operation detected: ${matchedTerm}`);
  }
}

export function verifyWechatDraftOnlyApiGuard(): boolean {
  const forbiddenChecks = FORBIDDEN_WECHAT_PUBLISH_API_TERMS.every((term) => {
    try {
      forbidWechatPublishApi({ actionName: term });
      return false;
    } catch {
      return true;
    }
  });

  const allowedChecks = [
    { url: "/cgi-bin/draft/add", actionName: "创建草稿" },
    { url: "/cgi-bin/token", actionName: "token" },
    { url: "/cgi-bin/material/add_material", actionName: "上传封面素材" },
    { url: "/cgi-bin/media/uploadimg", actionName: "上传封面图片" },
    { actionName: "保存草稿" },
    { actionName: "创建草稿" }
  ].every((check) => {
    try {
      forbidWechatPublishApi(check);
      return true;
    } catch {
      return false;
    }
  });

  return forbiddenChecks && allowedChecks;
}
