import { useEffect, useMemo, useState } from "react";
import { analyzeLiftingVideo } from "./formAnalysis";
import { clearSessions, loadSessions, saveSession } from "./sessionStorage";
import type { AnalysisResult, ProgressUpdate, SavedSession } from "./types";

function App() {
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string>("");
  const [progress, setProgress] = useState<ProgressUpdate | null>(null);
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const [sessions, setSessions] = useState<SavedSession[]>(() => loadSessions());
  const [error, setError] = useState<string>("");
  const [isAnalyzing, setIsAnalyzing] = useState(false);

  useEffect(() => {
    if (!selectedFile) {
      setPreviewUrl("");
      return;
    }

    const objectUrl = URL.createObjectURL(selectedFile);
    setPreviewUrl(objectUrl);

    return () => URL.revokeObjectURL(objectUrl);
  }, [selectedFile]);

  const trend = useMemo(() => {
    const newest = sessions[0]?.metrics.score;
    const previous = sessions[1]?.metrics.score;

    if (newest === undefined || previous === undefined) {
      return null;
    }

    return newest - previous;
  }, [sessions]);

  async function handleAnalyze() {
    if (!selectedFile) {
      setError("Pick a short set video first.");
      return;
    }

    setIsAnalyzing(true);
    setError("");
    setResult(null);

    try {
      const analysis = await analyzeLiftingVideo(selectedFile, setProgress);
      const savedSession = saveSession(analysis);
      setResult(analysis);
      setSessions((currentSessions) => [savedSession, ...currentSessions].slice(0, 20));
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : "Analysis failed. Try another video.");
    } finally {
      setIsAnalyzing(false);
    }
  }

  function handleClearHistory() {
    clearSessions();
    setSessions([]);
  }

  return (
    <main className="app-shell">
      <section className="hero card">
        <div>
          <p className="eyebrow">Between-set form check</p>
          <h1>Upload a set. Get simple cues before the next one.</h1>
          <p className="hero-copy">
            Pose detection tracks shoulders, hips, knees, and ankles to score each squat rep for depth,
            knee tracking, torso position, balance, and tempo.
          </p>
        </div>
        <div className="hero-metric" aria-label="Latest form score">
          <span>{sessions[0]?.metrics.score ?? "--"}</span>
          <small>latest score</small>
        </div>
      </section>

      <section className="grid">
        <section className="card upload-card">
          <div className="section-heading">
            <div>
              <p className="eyebrow">Step 1</p>
              <h2>Record and upload</h2>
            </div>
            <span className="pill">Squat check</span>
          </div>

          <label className="drop-zone">
            <input
              type="file"
              accept="video/*"
              onChange={(event) => {
                setSelectedFile(event.target.files?.[0] ?? null);
                setResult(null);
                setError("");
                setProgress(null);
              }}
            />
            <strong>{selectedFile ? selectedFile.name : "Choose a short set video"}</strong>
            <span>Best from a side or 45-degree angle with your full body visible.</span>
          </label>

          {previewUrl ? (
            <video className="video-preview" src={previewUrl} controls muted playsInline />
          ) : (
            <div className="preview-placeholder">Video preview appears here.</div>
          )}

          <button className="primary-button" disabled={isAnalyzing || !selectedFile} onClick={handleAnalyze}>
            {isAnalyzing ? "Analyzing..." : "Analyze form"}
          </button>

          {progress ? (
            <div className="progress-block" aria-live="polite">
              <div className="progress-label">
                <span>{progress.label}</span>
                <span>{progress.percent}%</span>
              </div>
              <div className="progress-track">
                <div style={{ width: `${progress.percent}%` }} />
              </div>
            </div>
          ) : null}

          {error ? <p className="error-message">{error}</p> : null}
        </section>

        <ResultsPanel result={result} />
      </section>

      <HistoryPanel sessions={sessions} trend={trend} onClearHistory={handleClearHistory} />
    </main>
  );
}

type ResultsPanelProps = {
  result: AnalysisResult | null;
};

function ResultsPanel({ result }: ResultsPanelProps) {
  if (!result) {
    return (
      <section className="card results-card empty-state">
        <p className="eyebrow">Step 2</p>
        <h2>Coaching tips</h2>
        <p>Run an analysis to see one-sentence cues and a rep-by-rep issue list.</p>
      </section>
    );
  }

  return (
    <section className="card results-card">
      <div className="section-heading">
        <div>
          <p className="eyebrow">Step 2</p>
          <h2>Coaching tips</h2>
        </div>
        <span className="score-badge">{result.metrics.score}%</span>
      </div>

      <div className="quick-stats">
        <Stat label="reps" value={result.reps.length} />
        <Stat label="clean" value={result.metrics.cleanReps} />
        <Stat label="issues" value={result.metrics.issueCount} />
        <Stat label="confidence" value={`${result.metrics.confidence}%`} />
      </div>

      <div className="cue-list">
        {result.cues.map((cue) => (
          <div className="cue-card" key={cue}>
            {cue}
          </div>
        ))}
      </div>

      <div className="rep-list">
        <h3>Rep-by-rep breakdown</h3>
        {result.reps.length ? (
          result.reps.map((rep) => (
            <article className="rep-card" key={rep.repNumber}>
              <div className="rep-summary">
                <strong>Rep {rep.repNumber}</strong>
                <span className={rep.issues.length ? "issue-pill" : "clean-pill"}>
                  {rep.issues.length ? `${rep.issues.length} issue${rep.issues.length > 1 ? "s" : ""}` : "clean"}
                </span>
              </div>
              <p>
                {formatTime(rep.startTime)}-{formatTime(rep.endTime)} · {rep.duration.toFixed(1)}s · bottom angle{" "}
                {Math.round(rep.minKneeAngle)}°
              </p>
              {rep.issues.length ? (
                <ul>
                  {rep.issues.map((issue) => (
                    <li key={issue.code}>
                      <strong>{issue.label}:</strong> {issue.cue} <span>{issue.detail}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="clean-note">No major issue detected on this rep.</p>
              )}
            </article>
          ))
        ) : (
          <p className="empty-copy">No full reps detected. Try a clearer angle with the whole lift in frame.</p>
        )}
      </div>
    </section>
  );
}

type HistoryPanelProps = {
  sessions: SavedSession[];
  trend: number | null;
  onClearHistory: () => void;
};

function HistoryPanel({ sessions, trend, onClearHistory }: HistoryPanelProps) {
  return (
    <section className="card history-card">
      <div className="section-heading">
        <div>
          <p className="eyebrow">Saved sessions</p>
          <h2>Track improvement</h2>
        </div>
        {sessions.length ? (
          <button className="ghost-button" onClick={onClearHistory}>
            Clear
          </button>
        ) : null}
      </div>

      {sessions.length ? (
        <>
          <div className="trend-line">
            <strong>{trend === null ? "First saved set" : `${trend >= 0 ? "+" : ""}${trend}% vs last set`}</strong>
            <span>{sessions.length} saved session{sessions.length > 1 ? "s" : ""}</span>
          </div>
          <div className="session-list">
            {sessions.map((session) => (
              <article className="session-row" key={session.id}>
                <div>
                  <strong>{session.videoName}</strong>
                  <span>{formatDate(session.analyzedAt)}</span>
                </div>
                <div className="session-score">
                  <div className="mini-track" aria-hidden="true">
                    <div style={{ width: `${session.metrics.score}%` }} />
                  </div>
                  <span>{session.metrics.score}%</span>
                </div>
              </article>
            ))}
          </div>
        </>
      ) : (
        <p className="empty-copy">Analyzed sessions are saved on this device so you can compare scores over time.</p>
      )}
    </section>
  );
}

type StatProps = {
  label: string;
  value: string | number;
};

function Stat({ label, value }: StatProps) {
  return (
    <div className="stat-card">
      <strong>{value}</strong>
      <span>{label}</span>
    </div>
  );
}

function formatTime(seconds: number) {
  return `${seconds.toFixed(1)}s`;
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

export default App;
