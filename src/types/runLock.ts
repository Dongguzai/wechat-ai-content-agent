export interface WechatDraftRunLock {
  version: 1;
  date: string;
  createdAt: string;
  mediaId: string;
  title: string;
  forced: boolean;
  source: "wechat_official_api";
}

export interface WechatDraftRunLockState {
  date: string;
  lockFile: string;
  locked: boolean;
  lock?: WechatDraftRunLock;
  invalidReason?: string;
}
