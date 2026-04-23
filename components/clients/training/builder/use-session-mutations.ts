import { useCallback } from "react";
import type { SavedPlan, SavedSession, SavedExercise } from "@/types/training";

/**
 * Session + exercise mutation cluster for the draft editor. Handles the
 * working-copy-vs-draft branch for each mutation: saved plans edit an
 * in-memory working copy (committed later via "Save and Update Plan");
 * drafts hit the server immediately so progress survives a refresh.
 *
 * Caller owns the shared helpers (`apiCall`, `mutateWorking`) and the
 * working-copy / baseUrl state — this hook only wraps the four session-
 * level mutations so the parent render file doesn't need to understand
 * the branch logic.
 */
export function useSessionMutations(args: {
  baseUrl: string;
  isWorkingCopy: boolean;
  apiCall: (
    url: string,
    options: RequestInit,
    errorMessage: string,
  ) => Promise<void>;
  mutateWorking: (updater: (current: SavedPlan | null) => SavedPlan | null) => void;
}) {
  const { baseUrl, isWorkingCopy, apiCall, mutateWorking } = args;

  const patchSession = useCallback(
    async (sessionId: string, updates: Partial<SavedSession>) => {
      if (isWorkingCopy) {
        mutateWorking((current) => {
          if (!current) return current;
          return {
            ...current,
            sessions: current.sessions.map((s) =>
              s.id === sessionId ? { ...s, ...updates } : s,
            ),
          };
        });
        return;
      }
      await apiCall(
        `${baseUrl}/sessions/${sessionId}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(updates),
        },
        "Failed to update session",
      );
    },
    [isWorkingCopy, baseUrl, apiCall, mutateWorking],
  );

  const patchExercise = useCallback(
    async (
      sessionId: string,
      exerciseId: string,
      updates: Partial<SavedExercise>,
    ) => {
      if (isWorkingCopy) {
        mutateWorking((current) => {
          if (!current) return current;
          return {
            ...current,
            sessions: current.sessions.map((s) =>
              s.id === sessionId
                ? {
                    ...s,
                    exercises: s.exercises.map((e) =>
                      e.id === exerciseId ? { ...e, ...updates } : e,
                    ),
                  }
                : s,
            ),
          };
        });
        return;
      }
      await apiCall(
        `${baseUrl}/sessions/${sessionId}/exercises/${exerciseId}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(updates),
        },
        "Failed to update exercise",
      );
    },
    [isWorkingCopy, baseUrl, apiCall, mutateWorking],
  );

  const removeSession = useCallback(
    async (sessionId: string) => {
      if (isWorkingCopy) {
        mutateWorking((current) => {
          if (!current) return current;
          // Also recompute orderIndex so restPattern stays derivable downstream.
          const next = current.sessions
            .filter((s) => s.id !== sessionId)
            .map((s, i) => ({ ...s, orderIndex: i }));
          return { ...current, sessions: next };
        });
        return;
      }
      await apiCall(
        `${baseUrl}/sessions/${sessionId}`,
        { method: "DELETE" },
        "Failed to remove session",
      );
    },
    [isWorkingCopy, baseUrl, apiCall, mutateWorking],
  );

  const removeExercise = useCallback(
    async (sessionId: string, exerciseId: string) => {
      if (isWorkingCopy) {
        mutateWorking((current) => {
          if (!current) return current;
          return {
            ...current,
            sessions: current.sessions.map((s) =>
              s.id === sessionId
                ? {
                    ...s,
                    exercises: s.exercises
                      .filter((e) => e.id !== exerciseId)
                      .map((e, i) => ({ ...e, orderIndex: i })),
                  }
                : s,
            ),
          };
        });
        return;
      }
      await apiCall(
        `${baseUrl}/sessions/${sessionId}/exercises/${exerciseId}`,
        { method: "DELETE" },
        "Failed to remove exercise",
      );
    },
    [isWorkingCopy, baseUrl, apiCall, mutateWorking],
  );

  return { patchSession, patchExercise, removeSession, removeExercise };
}
