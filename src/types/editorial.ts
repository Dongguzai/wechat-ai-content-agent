export interface EditorialStyleLoadResult {
  path: string;
  content: string;
  loaded: boolean;
}

export interface ManualTopicLoadResult {
  filePath: string;
  used: boolean;
  content: string;
  title?: string;
  sourceUrl?: string;
  sourceName?: string;
  angle?: string;
  thesis?: string;
}
