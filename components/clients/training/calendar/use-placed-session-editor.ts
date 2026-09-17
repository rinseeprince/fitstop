"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import useSWR from "swr";
import { swrFetcher } from "@/lib/swr-fetcher";
import { toast } from "sonner";
import { useInvalidateNutritionCalendar } from "@/hooks/use-nutrition-calendar-events";
import { useInvalidateTrainingData } from "@/hooks/use-calendar-events";
import { useClearClientOverview } from "@/hooks/use-client-overview";
import { useClearAttentionFeed } from "@/hooks/use-attention-feed";
import { replaceSessionSchema } from "@/lib/validations/training";
import type { TrainingSession } from "@/types/training";
import { useProgramBuilderState } from "@/components/clients/training/program-builder/use-program-builder-state";
import { useSetSpecMutations } from "@/components/clients/training/program-builder/use-set-spec-mutations";
import { makeStandaloneDraft } from "@/components/programs/use-standalone-session-editor";
import {
  sessionDraftToPlacedPayload,
  trainingSessionToDraft,
} from "@/components/clients/training/program-builder/placed-serialize";

// State container for the placed-session tray: the builder's state hook seeded
// with ONE placed session (same one-slot wrapper as the standalone Sessions
// editor), fetched by id so events from coexisting (non-active) plans resolve
// too. Save serializes slot 0 and PUTs the builder-grade replace of the day's
// session.

export type PlacedSessionState = {
  clientId: string;
  planId: string;
  sessionId: string;
  eventId: string;
  date: string;
};

export type SessionEventLink = {
  id: string;
  date: string;
  status: string;
};

type SessionGetResponse = {
  success: boolean;
  session: TrainingSession;
  events: SessionEventLink[];
};

type SessionPutResponse = {
  success: boolean;
  session?: TrainingSession;
  error?: string;
};

/**
 * `state` is the tray's SUBJECT, one object per opening (`useDialogSubject`
 * hands out exactly that): the close leaves it in place, so the fetch, the
 * seeded draft and the in-flight flag all hold through the exit, and the next
 * open's fresh object is what re-seeds and clears them.
 */
export function usePlacedSessionEditor(
  state: PlacedSessionState | null,
  opts: {
    onClose: () => void;
  },
) {
  const invalidateNutritionCalendar = useInvalidateNutritionCalendar();
  const invalidateTrainingData = useInvalidateTrainingData();
  const clearClientOverview = useClearClientOverview();
  const clearAttentionFeed = useClearAttentionFeed();
  const builder = useProgramBuilderState();
  const editSetSpec = useSetSpecMutations(builder.updateExercise);

  const sessionKey = state
    ? `/api/clients/${state.clientId}/training/${state.planId}/sessions/${state.sessionId}`
    : null;
  const {
    data,
    isLoading,
    error: loadError,
    mutate: mutateSession,
  } = useSWR<SessionGetResponse>(sessionKey, swrFetcher, {
    revalidateOnFocus: false,
    // The key outlives a close (the subject does), so every training write
    // still revalidates it: a session deleted meanwhile must not retry forever
    // (CONVENTIONS §7's SWR config).
    errorRetryCount: 3,
    errorRetryInterval: 1000,
  });

  // Seed once per opening, only after the fetch lands (no event-snapshot
  // pre-seed: a snapshot has no exercises, and seeding twice would clobber
  // edits made while the full session was still loading). Keyed on the subject
  // object, so re-opening the same day re-seeds fresh while a close — which
  // leaves the subject — keeps the seeded body through the slide-out
  // (CONVENTIONS §7 → "No frame disagrees"). Guarded against StrictMode's
  // double effect-run.
  const seededForRef = useRef<PlacedSessionState | null>(null);
  const { seed } = builder;
  useEffect(() => {
    if (state == null || seededForRef.current === state) return;
    if (!data?.session) return;
    const { draft } = trainingSessionToDraft(data.session);
    seed(makeStandaloneDraft(draft));
    seededForRef.current = state;
  }, [state, data, seed]);

  const session = builder.draft?.weeks[0]?.days[0]?.session ?? null;
  // Seeded for THIS opening — until then the draft still holds the previous
  // opening's session and must not render.
  const isSeeded = state != null && seededForRef.current === state;

  // The lock: a session whose calendar has left `scheduled` anywhere can no
  // longer be edited, because the save rewrites the exercise rows the client's
  // logs point at. Server-enforced in `assertSessionUnlogged`
  // (services/training-event-occupancy.ts); this is the same predicate so the
  // coach sees a locked panel instead of a save that 409s. Two places spell
  // it — that assertion and here — and it cannot be shared: that module
  // reaches supabaseAdmin.
  // Links arrive date-ascending, so this is the EARLIEST logged occurrence.
  const loggedEvent = useMemo(
    () => data?.events.find((e) => e.status !== "scheduled") ?? null,
    [data],
  );

  // The in-flight flag belongs to one opening. A successful save closes the
  // tray with it still set, so the sliding-out footer keeps its pending
  // frame, and the next open's fresh subject reads it as false. A failure
  // clears it, because the tray stays open.
  const [savingFor, setSavingFor] = useState<PlacedSessionState | null>(null);
  const isSaving = state != null && savingFor === state;
  // setState is async — the ref is the authoritative double-fire gate.
  const inFlightRef = useRef(false);

  const handleSave = async (): Promise<void> => {
    if (!session || !state || inFlightRef.current) return;
    inFlightRef.current = true;
    setSavingFor(state);
    try {
      const payload = sessionDraftToPlacedPayload(session);
      // Client-side belt: readable message instead of a generic 400.
      const parsed = replaceSessionSchema.safeParse(payload);
      if (!parsed.success) {
        const issue = parsed.error.issues[0];
        toast.error("Can't save session", {
          description: issue
            ? `${issue.message}${issue.path.length ? ` (${issue.path.join(".")})` : ""}`
            : "Invalid session",
        });
        setSavingFor(null);
        return;
      }

      const res = await fetch(
        `/api/clients/${state.clientId}/training/${state.planId}/sessions/${state.sessionId}`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        },
      );
      const resData = (await res.json().catch(() => ({}))) as SessionPutResponse;
      if (!res.ok || !resData.session) {
        throw new Error(resData.error ?? "Failed to save session");
      }

      // The editor fills once per opening from this read, so the saved session
      // goes into it now, from the save's own response. Left to the refresh
      // below, a reopen before that refetch lands fills from the session as it
      // was before the save and keeps it for the whole opening.
      const saved = resData.session;
      await mutateSession((current) => current && { ...current, session: saved }, {
        revalidate: false,
      });
      // The whole training area — the calendar, the Plans hero and this read —
      // before the close, so the calendar the tray reveals already shows it.
      await invalidateTrainingData(state.clientId);
      void invalidateNutritionCalendar(state.clientId);
      void clearClientOverview(state.clientId);
      void clearAttentionFeed();
      toast.success("Session saved");
      opts.onClose();
    } catch (error) {
      toast.error("Save failed", {
        description: error instanceof Error ? error.message : "Failed to save session",
      });
      setSavingFor(null);
    } finally {
      inFlightRef.current = false;
    }
  };

  // Save to library persists the SERVER version of the session (the
  // from-calendar copy endpoint reads by id) — gate it on a clean draft so
  // the coach can't think they saved unsynced edits.
  const [isSavingToLibrary, setIsSavingToLibrary] = useState(false);
  const handleSaveToLibrary = async (name: string): Promise<boolean> => {
    if (!state || isSavingToLibrary) return false;
    const trimmed = name.trim().slice(0, 100);
    if (!trimmed) return false;
    setIsSavingToLibrary(true);
    try {
      const res = await fetch("/api/training/saved-sessions/from-calendar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sourceSessionId: state.sessionId, name: trimmed }),
      });
      if (!res.ok) {
        const resData = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(resData.error ?? "Failed to save");
      }
      toast.success("Saved to library", {
        description: `"${trimmed}" saved as a standalone session`,
      });
      return true;
    } catch (error) {
      toast.error("Save failed", {
        description: error instanceof Error ? error.message : "Failed to save session",
      });
      return false;
    } finally {
      setIsSavingToLibrary(false);
    }
  };

  return {
    session,
    isSeeded,
    isLoading,
    loadError,
    isDirty: builder.isDirty,
    loggedEvent,
    isSaving,
    handleSave,
    isSavingToLibrary,
    handleSaveToLibrary,
    updateSession: builder.updateSession,
    addExercise: builder.addExercise,
    removeExercise: builder.removeExercise,
    updateExercise: builder.updateExercise,
    linkExercises: builder.linkExercises,
    unlinkGroup: builder.unlinkGroup,
    moveExercise: builder.moveExercise,
    moveGroup: builder.moveGroup,
    updateGroup: builder.updateGroup,
    editSetSpec,
  };
}
