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
    /** Upstream plan refresh (the Plans tab's refresh). */
    onUpdate: () => void;
    /** The calendar's bound SWR mutate. */
    mutateCalendar: () => Promise<unknown>;
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

  // Scope dialog trigger: >1 FUTURE SCHEDULED occurrence means an "all" save
  // touches other days. Past/logged events keep their snapshots either way.
  // Under placement every placed day owns its own session row (migration 121),
  // so this is normally 1 — it exceeds 1 only after a per-event DUPLICATE
  // (`duplicateEvent` copies `training_session_id`), and that is when the
  // dialog opens. Live, not vestigial: placed-session-editor.test.tsx covers it.
  const futureScheduledCount = useMemo(() => {
    if (!data) return 0;
    return data.events.filter(
      (e) => e.status === "scheduled" && e.date >= data.clientToday,
    ).length;
  }, [data]);

  // The lock: a session whose calendar has left `scheduled` anywhere can no
  // longer be edited, because both save paths rewrite the exercise rows the
  // client's logs point at. Server-enforced in `assertSessionUnlogged`
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

  const handleSave = async (scope: SaveScope): Promise<void> => {
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

      toast.success(scope === "day" ? "Saved for this day only" : "Session saved");
      await opts.mutateCalendar();
      // The whole training area, not just the calendar. A "this day only" save
      // CLONES the session and repoints the event at the clone, so every read
      // of the day — the plan editor's included — must see the new row.
      void invalidateTrainingData(state.clientId);
      void invalidateNutritionCalendar(state.clientId);
      void clearClientOverview(state.clientId);
      void clearAttentionFeed();
      void mutateSession();
      opts.onUpdate();
      // The close keeps this subject even after a "day" save repointed the
      // event at the clone: the next open reads the clone off the refreshed
      // calendar.
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
    futureScheduledCount,
    loggedEvent,
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
