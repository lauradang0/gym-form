import type { AnalysisResult, SavedSession } from "./types";

const STORAGE_KEY = "gym-form.sessions.v1";
const MAX_SESSIONS = 20;

export function loadSessions(): SavedSession[] {
  try {
    const rawValue = window.localStorage.getItem(STORAGE_KEY);
    if (!rawValue) {
      return [];
    }

    const parsed = JSON.parse(rawValue);
    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed;
  } catch {
    return [];
  }
}

export function saveSession(result: AnalysisResult): SavedSession {
  const session: SavedSession = {
    ...result,
    id: crypto.randomUUID(),
  };
  const sessions = [session, ...loadSessions()].slice(0, MAX_SESSIONS);
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(sessions));

  return session;
}

export function clearSessions() {
  window.localStorage.removeItem(STORAGE_KEY);
}
