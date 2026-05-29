export type WechatLayoutStyle = "stripe-inspired";

export interface WechatHtmlChecks {
  hasInlineStyles: boolean;
  hasNoExternalCss: boolean;
  hasNoJavascript: boolean;
  hasNoIframe: boolean;
  hasNoForbiddenPublishText: boolean;
  hasTitle: boolean;
  hasCoverImage: boolean;
  hasHeadings: boolean;
  mobileReadable: boolean;
}

export interface WechatLayoutResult {
  title: string;
  digest: string;
  htmlPath: "outputs/wechat.html" | string;
  coverImagePath: string;
  style: WechatLayoutStyle;
  compatibleWithWechat: boolean;
  htmlChecks: WechatHtmlChecks;
  warnings: string[];
  generatedAt: string;
  allowedNextStage: boolean;
}

export interface WechatLayoutOutputFiles {
  wechatHtml: string;
  wechatLayout: string;
  wechatLayoutReport: string;
}

export interface WechatLayoutPipelineResult {
  outputDir: string;
  files: WechatLayoutOutputFiles;
  layout: WechatLayoutResult;
  html: string;
  report: string;
}
