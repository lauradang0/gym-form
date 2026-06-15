import { load as loadMoveNet } from "@tensorflow-models/pose-detection/dist/movenet/detector";
import { SINGLEPOSE_LIGHTNING } from "@tensorflow-models/pose-detection/dist/movenet/constants";
import type { PoseDetector } from "@tensorflow-models/pose-detection/dist/pose_detector";
import type { Keypoint, Pose } from "@tensorflow-models/pose-detection/dist/types";
import "@tensorflow/tfjs-backend-webgl";
import * as tf from "@tensorflow/tfjs-core";
import type { AnalysisResult, FormIssue, FormIssueCode, ProgressUpdate, RepBreakdown } from "./types";

type KeypointName =
  | "left_shoulder"
  | "right_shoulder"
  | "left_hip"
  | "right_hip"
  | "left_knee"
  | "right_knee"
  | "left_ankle"
  | "right_ankle";

type Point = {
  x: number;
  y: number;
  score: number;
};

type FrameSample = {
  time: number;
  confidence: number;
  kneeAngle: number;
  leftKneeAngle: number;
  rightKneeAngle: number;
  depthScore: number;
  torsoLean: number;
  kneeDrift: number;
  visibility: number;
};

const SAMPLE_INTERVAL_SECONDS = 0.16;
const MIN_KEYPOINT_SCORE = 0.25;
const CLEAN_REP_SCORE = 100;

const ISSUE_COPY: Record<FormIssueCode, Omit<FormIssue, "detail">> = {
  depth: {
    code: "depth",
    label: "Depth",
    cue: "Go a little deeper.",
  },
  knee_tracking: {
    code: "knee_tracking",
    label: "Knee tracking",
    cue: "Keep your knees tracking out.",
  },
  torso_lean: {
    code: "torso_lean",
    label: "Torso position",
    cue: "Brace hard and keep your chest tall.",
  },
  asymmetry: {
    code: "asymmetry",
    label: "Side-to-side balance",
    cue: "Push evenly through both feet.",
  },
  visibility: {
    code: "visibility",
    label: "Camera view",
    cue: "Keep your full body in the frame.",
  },
  tempo: {
    code: "tempo",
    label: "Tempo",
    cue: "Control the rep instead of rushing it.",
  },
};

let detectorPromise: Promise<PoseDetector> | undefined;

export async function analyzeLiftingVideo(
  file: File,
  onProgress: (update: ProgressUpdate) => void,
): Promise<AnalysisResult> {
  onProgress({ label: "Loading pose model", percent: 4 });
  const detector = await getDetector();
  const video = await loadVideo(file);

  const duration = Number.isFinite(video.duration) ? video.duration : 0;
  const frameTimes = createFrameTimes(duration);
  const samples: FrameSample[] = [];

  for (let index = 0; index < frameTimes.length; index += 1) {
    const time = frameTimes[index];
    await seekVideo(video, time);
    const poses = await detector.estimatePoses(video, {
      maxPoses: 1,
      flipHorizontal: false,
    });
    const sample = poseToSample(poses[0], time, video.videoHeight);

    if (sample) {
      samples.push(sample);
    }

    const percent = 10 + Math.round(((index + 1) / frameTimes.length) * 70);
    onProgress({ label: "Tracking joints rep by rep", percent });
  }

  URL.revokeObjectURL(video.src);

  onProgress({ label: "Scoring form issues", percent: 88 });
  const result = buildResult(file.name, duration, samples);
  onProgress({ label: "Ready", percent: 100 });

  return result;
}

async function getDetector() {
  if (!detectorPromise) {
    detectorPromise = (async () => {
      await tf.setBackend("webgl");
      await tf.ready();

      return loadMoveNet({
        modelType: SINGLEPOSE_LIGHTNING,
        enableSmoothing: true,
      });
    })();
  }

  return detectorPromise;
}

function loadVideo(file: File) {
  return new Promise<HTMLVideoElement>((resolve, reject) => {
    const video = document.createElement("video");
    video.preload = "metadata";
    video.muted = true;
    video.playsInline = true;
    video.src = URL.createObjectURL(file);

    video.onloadedmetadata = () => resolve(video);
    video.onerror = () => {
      URL.revokeObjectURL(video.src);
      reject(new Error("Could not load the selected video."));
    };
  });
}

function seekVideo(video: HTMLVideoElement, time: number) {
  return new Promise<void>((resolve, reject) => {
    const timeout = window.setTimeout(() => reject(new Error("Video seek timed out.")), 8000);

    video.onseeked = () => {
      window.clearTimeout(timeout);
      resolve();
    };

    video.currentTime = Math.min(time, Math.max(video.duration - 0.05, 0));
  });
}

function createFrameTimes(duration: number) {
  if (!duration || duration <= 0) {
    return [0];
  }

  const times: number[] = [];
  for (let time = 0; time < duration; time += SAMPLE_INTERVAL_SECONDS) {
    times.push(time);
  }

  if (times[times.length - 1] !== duration) {
    times.push(Math.max(duration - 0.05, 0));
  }

  return times;
}

function poseToSample(
  pose: Pose | undefined,
  time: number,
  videoHeight: number,
): FrameSample | undefined {
  if (!pose?.keypoints?.length) {
    return undefined;
  }

  const points = keypointsByName(pose.keypoints);
  const required: KeypointName[] = [
    "left_shoulder",
    "right_shoulder",
    "left_hip",
    "right_hip",
    "left_knee",
    "right_knee",
    "left_ankle",
    "right_ankle",
  ];
  const visiblePoints = required.map((name) => points[name]).filter(Boolean);
  const visibility = visiblePoints.filter((point) => point.score >= MIN_KEYPOINT_SCORE).length / required.length;

  if (visiblePoints.length < required.length || visibility < 0.65) {
    return undefined;
  }

  const leftKneeAngle = angle(points.left_hip, points.left_knee, points.left_ankle);
  const rightKneeAngle = angle(points.right_hip, points.right_knee, points.right_ankle);
  const hipY = average(points.left_hip.y, points.right_hip.y);
  const kneeY = average(points.left_knee.y, points.right_knee.y);
  const shoulder = midpoint(points.left_shoulder, points.right_shoulder);
  const hip = midpoint(points.left_hip, points.right_hip);
  const torsoLean = degrees(Math.atan2(Math.abs(shoulder.x - hip.x), Math.abs(shoulder.y - hip.y)));
  const kneeDrift = Math.max(
    normalizedDistanceToLine(points.left_knee, points.left_hip, points.left_ankle),
    normalizedDistanceToLine(points.right_knee, points.right_hip, points.right_ankle),
  );
  const confidence = average(...required.map((name) => points[name].score));

  return {
    time,
    confidence,
    kneeAngle: average(leftKneeAngle, rightKneeAngle),
    leftKneeAngle,
    rightKneeAngle,
    depthScore: (hipY - kneeY) / Math.max(videoHeight, 1),
    torsoLean,
    kneeDrift,
    visibility,
  };
}

function keypointsByName(keypoints: Keypoint[]) {
  return keypoints.reduce<Partial<Record<KeypointName, Point>>>((accumulator, keypoint) => {
    if (typeof keypoint.name === "string" && isTrackedKeypoint(keypoint.name)) {
      accumulator[keypoint.name] = {
        x: keypoint.x,
        y: keypoint.y,
        score: keypoint.score ?? 0,
      };
    }

    return accumulator;
  }, {}) as Record<KeypointName, Point>;
}

function isTrackedKeypoint(name: string): name is KeypointName {
  return [
    "left_shoulder",
    "right_shoulder",
    "left_hip",
    "right_hip",
    "left_knee",
    "right_knee",
    "left_ankle",
    "right_ankle",
  ].includes(name);
}

function buildResult(videoName: string, duration: number, samples: FrameSample[]): AnalysisResult {
  const reps = segmentReps(samples).map((repSamples, index) => scoreRep(repSamples, index + 1));
  const issueCount = reps.reduce((total, rep) => total + rep.issues.length, 0);
  const cleanReps = reps.filter((rep) => rep.issues.length === 0).length;
  const score = reps.length ? Math.round((cleanReps / reps.length) * CLEAN_REP_SCORE) : 0;
  const confidence = samples.length
    ? Math.round(average(...samples.map((sample) => sample.confidence)) * CLEAN_REP_SCORE)
    : 0;
  const cues = buildCues(reps);

  if (!cues.length && reps.length) {
    cues.push("Keep the same controlled positions next set.");
  }

  if (!reps.length) {
    cues.push("Film from farther back so the app can see a full rep.");
  }

  return {
    videoName,
    analyzedAt: new Date().toISOString(),
    duration,
    reps,
    cues,
    metrics: {
      trackedFrames: samples.length,
      confidence,
      cleanReps,
      issueCount,
      score,
    },
  };
}

function segmentReps(samples: FrameSample[]) {
  if (samples.length < 4) {
    return samples.length ? [samples] : [];
  }

  const reps: FrameSample[][] = [];
  let startIndex: number | undefined;
  let bottomAngle = 180;
  let bottomIndex = 0;

  samples.forEach((sample, index) => {
    if (startIndex === undefined && sample.kneeAngle < 145) {
      startIndex = Math.max(index - 2, 0);
      bottomAngle = sample.kneeAngle;
      bottomIndex = index;
      return;
    }

    if (startIndex !== undefined) {
      if (sample.kneeAngle < bottomAngle) {
        bottomAngle = sample.kneeAngle;
        bottomIndex = index;
      }

      const hasHitBottom = bottomAngle < 132;
      const returnedToTop = sample.kneeAngle > 154;
      const hasEnoughSamples = index - startIndex >= 4;

      if (hasHitBottom && returnedToTop && hasEnoughSamples && index > bottomIndex) {
        reps.push(samples.slice(startIndex, index + 1));
        startIndex = undefined;
        bottomAngle = 180;
      }
    }
  });

  if (startIndex !== undefined && samples.length - startIndex >= 4) {
    reps.push(samples.slice(startIndex));
  }

  if (!reps.length && samples.length >= 4) {
    reps.push(samples);
  }

  return reps;
}

function scoreRep(samples: FrameSample[], repNumber: number): RepBreakdown {
  const start = samples[0];
  const end = samples[samples.length - 1];
  const minKneeAngle = Math.min(...samples.map((sample) => sample.kneeAngle));
  const depthScore = Math.max(...samples.map((sample) => sample.depthScore));
  const maxTorsoLean = Math.max(...samples.map((sample) => sample.torsoLean));
  const maxKneeDrift = Math.max(...samples.map((sample) => sample.kneeDrift));
  const maxAsymmetry = Math.max(
    ...samples.map((sample) => Math.abs(sample.leftKneeAngle - sample.rightKneeAngle)),
  );
  const lowestVisibility = Math.min(...samples.map((sample) => sample.visibility));
  const duration = end.time - start.time;
  const issues: FormIssue[] = [];

  if (depthScore < -0.015 || minKneeAngle > 112) {
    issues.push(issue("depth", `Bottom position stopped at ${Math.round(minKneeAngle)} degrees.`));
  }

  if (maxKneeDrift > 0.18) {
    issues.push(issue("knee_tracking", `Knee drift peaked at ${Math.round(maxKneeDrift * 100)}%.`));
  }

  if (maxTorsoLean > 38) {
    issues.push(issue("torso_lean", `Torso lean peaked near ${Math.round(maxTorsoLean)} degrees.`));
  }

  if (maxAsymmetry > 18) {
    issues.push(issue("asymmetry", `Left and right knee angles differed by ${Math.round(maxAsymmetry)} degrees.`));
  }

  if (lowestVisibility < 0.75) {
    issues.push(issue("visibility", "One or more tracked joints briefly left the clean camera view."));
  }

  if (duration > 0 && duration < 0.9) {
    issues.push(issue("tempo", `Rep took ${duration.toFixed(1)} seconds.`));
  }

  return {
    repNumber,
    startTime: start.time,
    endTime: end.time,
    duration,
    minKneeAngle,
    depthScore,
    issues,
  };
}

function issue(code: FormIssueCode, detail: string): FormIssue {
  return {
    ...ISSUE_COPY[code],
    detail,
  };
}

function buildCues(reps: RepBreakdown[]) {
  const issueFrequency = reps.reduce<Partial<Record<FormIssueCode, number>>>((accumulator, rep) => {
    rep.issues.forEach((repIssue) => {
      accumulator[repIssue.code] = (accumulator[repIssue.code] ?? 0) + 1;
    });

    return accumulator;
  }, {});

  return Object.entries(issueFrequency)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 3)
    .map(([code]) => ISSUE_COPY[code as FormIssueCode].cue);
}

function angle(a: Point, b: Point, c: Point) {
  const ab = { x: a.x - b.x, y: a.y - b.y };
  const cb = { x: c.x - b.x, y: c.y - b.y };
  const dot = ab.x * cb.x + ab.y * cb.y;
  const abMagnitude = Math.hypot(ab.x, ab.y);
  const cbMagnitude = Math.hypot(cb.x, cb.y);
  const cosine = dot / Math.max(abMagnitude * cbMagnitude, Number.EPSILON);

  return degrees(Math.acos(clamp(cosine, -1, 1)));
}

function normalizedDistanceToLine(point: Point, lineStart: Point, lineEnd: Point) {
  const numerator = Math.abs(
    (lineEnd.y - lineStart.y) * point.x -
      (lineEnd.x - lineStart.x) * point.y +
      lineEnd.x * lineStart.y -
      lineEnd.y * lineStart.x,
  );
  const denominator = Math.hypot(lineEnd.y - lineStart.y, lineEnd.x - lineStart.x);

  return numerator / Math.max(denominator, 1);
}

function midpoint(a: Point, b: Point): Point {
  return {
    x: average(a.x, b.x),
    y: average(a.y, b.y),
    score: average(a.score, b.score),
  };
}

function average(...values: number[]) {
  return values.reduce((total, value) => total + value, 0) / Math.max(values.length, 1);
}

function degrees(radians: number) {
  return (radians * 180) / Math.PI;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}
