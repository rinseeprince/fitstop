"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import useSWR from "swr";
import { swrFetcher } from "@/lib/swr-fetcher";
import { useToast } from "@/hooks/use-toast";
import { useInvalidateNutritionCalendar } from "@/hooks/use-nutrition-calendar-events";
import { useInvalidateTrainingData } from "@/hooks/use-calendar-events";
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
// too. Save serializes slot 0: "all" PUTs the builder-grade replace on the
// session; "day" first repoints this event to a fresh clone (the existing
// clone route), then PUTs the SAME payload on the clone — so day-scope saves
// get identical semantics (meta + rename snapshot + surplus cascade) instead
// of the old drawer's exercises-only clone.

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
  isModified: boolean;
};

type SessionGetResponse = {
  success: boolean;
  session: TrainingSession;
  events: SessionEventLink[];
  clientToday: string;
};

export type SaveScope = "day" | "all";

export function usePlacedSessionEditor(
  state: PlacedSessionState | null,
  opts: {
    onClose: () => void;
    /** Upstream plan refresh (the Plans tab's fetchPlan). */
    onUpdate: () => void;
    /** The calendar's bound SWR mutate. */
    mutateCalendar: () => Promise<unknown>;
    onSelectSession?: (sessionId: string, eventId: string) => void;
  },
) {
  const { toast } = useToast();
  const invalidateNutritionCalendar = useInvalidateNutritionCalendar();
  const invalidateTrainingData = useInvalidateTrainingData();
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
  });

  const identity = state ? `${state.sessionId}:${state.eventId}` : null;

  // Seed once per identity, only after the fetch lands (no event-snapshot
  // pre-seed: a snapshot has no exercises, and seeding twice would clobber
  // edits made while the full session was still loading). Reset on close so
  // re-opening re-seeds fresh; guarded against StrictMode's double effect-run.
  const seededForRef = useRef<string | null>(null);
  const { seed } = builder;
  useEffect(() => {
    if (state == null || identity == null) {
      seededForRef.current = null;
      return;
    }
    if (seededForRef.current === identity) return;
    if (!data?.session) return;
    const { draft } = trainingSessionToDraft(data.session);
    seed(makeStandaloneDraft(draft));
    seededForRef.current = identity;
  }, [state, identity, data, seed]);

  const session = builder.draft?.weeks[0]?.days[0]?.session ?? null;
  // Seeded for the CURRENT identity — before then the draft still holds the
  // previous session (kept for the exit animation) and must not render.
  const isSeeded = identity != null && seededForRef.current === identity;

  // Scope dialog trigger: >1 FUTURE SCHEDULED occurrence means an "all" save
  // touches other days. Past/logged events keep their snapshots either way.
  const futureScheduledCount = useMemo(() => {
    if (!data) return 0;
    return data.events.filter(
      (e) => e.status === "scheduled" && e.date >= data.clientToday,
    ).length;
  }, [data]);

  const [savingScope, setSavingScope] = useState<SaveScope | null>(null);
  const isSaving = savingScope !== null;
  // setState is async — the ref is the authoritative double-fire gate.
  const inFlightRef = useRef(false);

  const handleSave = async (scope: SaveScope): Promise<void> => {
    if (!session || !state || inFlightRef.current) return;
    inFlightRef.current = true;
    setSavingScope(scope);
    try {
      const payload = sessionDraftToPlacedPayload(session);
      // Client-side belt: readable message instead of a generic 400.
      const parsed = replaceSessionSchema.safeParse(payload);
      if (!parsed.success) {
        const issue = parsed.error.issues[0];
        toast({
          title: "Can't save session",
          description: issue
            ? `${issue.message}${issue.path.length ? ` (${issue.path.join(".")})` : ""}`
            : "Invalid session",
          variant: "destructive",
        });
        return;
      }

      let targetSessionId = state.sessionId;
      if (scope === "day") {
        const cloneRes = await fetch(
          `/api/clients/${state.clientId}/training/${state.planId}/sessions/${state.sessionId}/clone`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ eventId: state.eventId, exercises: payload.exercises }),
          },
        );
        if (!cloneRes.ok) {
          const cloneData = (await cloneRes.json().catch(() => ({}))) as {
            error?: string;
          };
          throw new Error(cloneData.error ?? "Failed to save for this day");
        }
        const { newSessionId } = (await cloneRes.json()) as { newSessionId: string };
        targetSessionId = newSessionId;
      }

      // The builder-grade write. For "day" this runs on the fresh clone —
      // the clone already carries the exercises, so this pass lands the meta
      // (name/focus/duration/notes/surplus), re-snapshots the event and fires
      // the surplus cascade; a retried save repairs any partial.
      const res = await fetch(
        `/api/clients/${state.clientId}/training/${state.planId}/sessions/${targetSessionId}`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        },
      );
      if (!res.ok) {
        const resData = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(resData.error ?? "Failed to save session");
      }

      toast(
        scope === "day"
          ? { title: "Saved for this day only" }
          : { title: "Session saved" },
      );
      await opts.mutateCalendar();
      // The whole training area, not just the calendar. A "this day only" save
      // CLONES the session and repoints the event at the clone, so a plan
      // editor still holding the pre-save read is not merely showing stale
      // text — its slot maps to a session id the event no longer references,
      // and an amendment saved from that seed reasons about the wrong row.
      void invalidateTrainingData(state.clientId);
      void invalidateNutritionCalendar(state.clientId);
      void mutateSession();
      opts.onUpdate();
      if (scope === "day" && targetSessionId !== state.sessionId) {
        opts.onSelectSession?.(targetSessionId, state.eventId);
      }
      opts.onClose();
    } catch (error) {
      toast({
        title: "Save failed",
        description:
          error instanceof Error ? error.message : "Failed to save session",
        variant: "destructive",
      });
    } finally {
      inFlightRef.current = false;
      setSavingScope(null);
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
      toast({
        title: "Saved to library",
        description: `"${trimmed}" saved as a standalone session`,
      });
      return true;
    } catch (error) {
      toast({
        title: "Save failed",
        description:
          error instanceof Error ? error.message : "Failed to save session",
        variant: "destructive",
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
    futureScheduledCount,
    savingScope,
    isSaving,
    handleSave,
    isSavingToLibrary,
    handleSaveToLibrary,
    updateSession: builder.updateSession,
    addExercise: builder.addExercise,
    removeExercise: builder.removeExercise,
    updateExercise: builder.updateExercise,
    reorderExercise: builder.reorderExercise,
    editSetSpec,
  };
}
