export interface EditorialFeedback {
  date: string;
  title: string;
  topic?: string;
  draftMediaId?: string;
  published: boolean;
  views: number;
  likes: number;
  shares: number;
  myRating: number;
  topicQuality: number;
  titleQuality: number;
  coverQuality?: number;
  articleProblems: string[];
  notes: string;
}

export interface FeedbackTemplate extends EditorialFeedback {
  topic: string;
  draftMediaId: string;
  coverQuality: number;
}

export interface FeedbackTemplateResult {
  feedbackDir: string;
  sourceDir: string;
  filePath: string;
  feedback: FeedbackTemplate;
}

export interface LoadedEditorialFeedback extends EditorialFeedback {
  filePath: string;
}

export interface EditorialFeedbackLoadResult {
  feedbackDir: string;
  latest?: LoadedEditorialFeedback;
  feedbackRead: boolean;
  skippedFiles: string[];
}
