export interface EditorialFeedback {
  date: string;
  title: string;
  published: boolean;
  views: number;
  likes: number;
  shares: number;
  myRating: number;
  topicQuality: number;
  titleQuality: number;
  articleProblems: string[];
  notes: string;
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
