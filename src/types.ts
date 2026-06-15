export type FormIssueCode =
  | "depth"
  | "knee_tracking"
  | "torso_lean"
  | "asymmetry"
  | "visibility"
  | "tempo";

export type FormIssue = {
  code: FormIssueCode;
  label: string;
  cue: string;
  detail: string;
};

export type RepBreakdown = {
  repNumber: number;
  startTime: number;
  endTime: number;
  duration: number;
  minKneeAngle: number;
  depthScore: number;
  issues: FormIssue[];
};

export type AnalysisMetrics = {
  trackedFrames: number;
  confidence: number;
  cleanReps: number;
  issueCount: number;
  score: number;
};

export type AnalysisResult = {
  videoName: string;
  analyzedAt: string;
  duration: number;
  reps: RepBreakdown[];
  cues: string[];
  metrics: AnalysisMetrics;
};

export type SavedSession = AnalysisResult & {
  id: string;
};

export type ProgressUpdate = {
  label: string;
  percent: number;
};
