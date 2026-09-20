"use client";

import { useCallback } from "react";
import { useSWRConfig } from "swr";
import { trainingAreaKeyPrefix } from "./use-calendar-events";

// The exercise-history reads' keys, built here and nowhere else (CONVENTIONS
// section 7): the coach's Journey Training pane and the client's Performance
// view each read a list, a progression and the PRs through them.

type ExerciseHistoryQuery =
  | { metric: "list" }
  | {
      metric: "progression";
      exerciseId?: string | null;
      exerciseName?: string | null;
      /** Omitted for the whole history the route allows; the RPC floors an unwindowed read at 12. */
      sessionCount?: number;
    }
  | { metric: "prs"; exerciseId?: string | null; exerciseName?: string | null };

function exerciseHistoryParams(query: ExerciseHistoryQuery): string {
  const params = new URLSearchParams();
  params.set("metric", query.metric);
  if (query.metric !== "list") {
    if (query.exerciseId) params.set("exerciseId", query.exerciseId);
    else if (query.exerciseName) params.set("exerciseName", query.exerciseName);
    if (query.metric === "progression" && query.sessionCount != null) {
      params.set("sessionCount", String(query.sessionCount));
    }
  }
  return params.toString();
}

/**
 * The coach's read of a client's exercise history. It sits inside the training
 * area, so `useInvalidateTrainingData` reaches it with the calendar; no coach
 * write changes it on its own.
 */
export function coachExerciseHistoryKey(clientId: string, query: ExerciseHistoryQuery): string {
  return `${trainingAreaKeyPrefix(clientId)}/exercise-history?${exerciseHistoryParams(query)}`;
}

const CLIENT_EXERCISE_HISTORY_PREFIX = "/api/client/training/exercise-history";

/** The client's read of their own exercise history. */
export function clientExerciseHistoryKey(query: ExerciseHistoryQuery): string {
  return `${CLIENT_EXERCISE_HISTORY_PREFIX}?${exerciseHistoryParams(query)}`;
}

/**
 * Drops every exercise-history read the client holds: the workout save and
 * Clear log call it, since a logged set is what the charts and the PRs are
 * built from.
 */
export function useInvalidateClientExerciseHistory() {
  const { mutate } = useSWRConfig();
  return useCallback(
    () =>
      mutate(
        (key) => typeof key === "string" && key.startsWith(CLIENT_EXERCISE_HISTORY_PREFIX),
      ),
    [mutate],
  );
}
