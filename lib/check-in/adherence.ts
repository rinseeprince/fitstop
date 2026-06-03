import type { CheckInSessionCompletion } from "@/types/check-in";

// Per-session training status shown on the prescription panel pills.
export type SessionStatus = "completed" | "partial" | "missed";

export type AdherenceResult = {
  completed: number;
  prescribed: number;
  // null (not 0) when nothing was prescribed, so the UI can show "no data"
  // rather than a misleading 0%.
  pct: number | null;
};

export type SessionSummary = AdherenceResult & {
  full: number;
  partial: number;
  missed: number;
};

/**
 * Canonical training adherence: completed / prescribed. This is the single
 * definition the hero card, the prescription header and the comparison tab all
 * read, so the figure is identical everywhere it appears.
 *
 * `completed` is the numerator the caller has already decided on (full + partial
 * per the product rule below); `prescribed` is every prescribed session in the
 * window.
 */
export function computeAdherence(prescribed: number, completed: number): AdherenceResult {
  const pct = prescribed > 0 ? Math.round((completed / prescribed) * 100) : null;
  return { completed, prescribed, pct };
}

/**
 * Per-session status, logged-quality-wins. The client's logged completion
 * quality is the primary signal; the event-completed flag is only a fallback
 * when the session was never logged.
 * - completion_quality "full"    -> completed
 * - completion_quality "partial" -> partial (overrides a completed flag)
 * - completion_quality "skipped" -> missed
 * - no logged quality: event marked completed -> completed, otherwise missed
 */
export function classifySession(session: CheckInSessionCompletion): SessionStatus {
  switch (session.completionQuality) {
    case "full":
      return "completed";
    case "partial":
      return "partial";
    case "skipped":
      return "missed";
    default:
      return session.completed ? "completed" : "missed";
  }
}

/**
 * Summarise a week's prescribed sessions into adherence counts. A partial
 * session counts towards the numerator (it is still a session done against the
 * prescription); only missed sessions are excluded. The per-session pills keep
 * the three distinct states via classifySession.
 */
export function summariseSessions(sessions: CheckInSessionCompletion[]): SessionSummary {
  let full = 0;
  let partial = 0;
  let missed = 0;
  for (const session of sessions) {
    const status = classifySession(session);
    if (status === "completed") full += 1;
    else if (status === "partial") partial += 1;
    else missed += 1;
  }
  const completed = full + partial;
  return { ...computeAdherence(sessions.length, completed), full, partial, missed };
}
