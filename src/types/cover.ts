export type CoverImageProvider = "apimart";

export type CoverGenerationMode = "mock" | "real";

export type CoverImageSize = "900x383";

export interface CoverVisualRequirements {
  style: "3D animated movie quality, not specific studio imitation";
  size: CoverImageSize;
  quality: "2K render quality";
  language: "Chinese";
  mainTextRequired: true;
  visualCenterRequired: true;
}

export interface CoverReviewSummary {
  passed: boolean;
  issues: string[];
  riskNotes: string[];
}

export interface CoverResult {
  provider: CoverImageProvider;
  mode: CoverGenerationMode;
  title: string;
  coverText: string;
  imagePrompt: string;
  negativePrompt: string;
  imageSize: CoverImageSize;
  imagePath: string;
  visualRequirements: CoverVisualRequirements;
  review: CoverReviewSummary;
  generatedAt: string;
}

export interface CoverReviewChecks {
  providerIsApimart: boolean;
  coverTextIsChinese: boolean;
  imageSizeIs900x383: boolean;
  declares2KQuality: boolean;
  usesSafeAnimatedMovieStyle: boolean;
  mentionsChineseHeadline: boolean;
  mentionsSafeMargins: boolean;
  hasVisualCenter: boolean;
  doesNotRequestRealBrandMarks: boolean;
  doesNotRequestOfficialMarks: boolean;
  doesNotIncludeSpecificPrice: boolean;
  doesNotIncludeFreeSubstituteSlogan: boolean;
  doesNotIncludeAbsoluteSubstituteClaim: boolean;
  doesNotNameSpecificStudios: boolean;
  realApiModeProducesRealCover: boolean;
  realApiModeDoesNotReturnMockSvg: boolean;
  imagePathAvailable: boolean;
  embeddedReviewPassed: boolean;
}

export interface CoverReviewResult extends CoverReviewSummary {
  provider: CoverImageProvider | string;
  mode: CoverGenerationMode;
  imageSize: string;
  imagePath: string;
  checks: CoverReviewChecks;
  generatedAt: string;
}

export interface CoverOutputFiles {
  cover: string;
  coverPrompt: string;
  coverReview: string;
  coverImageDir: string;
}

export interface CoverPipelineResult {
  outputDir: string;
  files: CoverOutputFiles;
  cover: CoverResult;
  review: CoverReviewResult;
  promptMarkdown: string;
}
