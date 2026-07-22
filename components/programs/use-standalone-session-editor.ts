"use client";

import { useEffect, useRef, useState } from "react";
import { useSWRConfig } from "swr";
import { useToast } from "@/hooks/use-toast";
import { createStandaloneSessionSchema } from "@/lib/validations/training";
import type { SavedSession } from "@/types/training";
import {
  makeRestWeek,
  newUid,
  type ProgramDraft,
  type SessionDraft,
} from "@/components/clients/training/program-builder/program-builder-types";
import { useProgramBuilderState } from "@/components/clients/training/program-builder/use-program-builder-state";
import { useSetSpecMutations } from "@/components/clients/training/program-builder/use-set-spec-mutations";
import {
  savedSessionToDraft,
  sessionDraftToStandalonePayload,
} from "@/components/clients/training/program-builder/program-builder-serialize";

// State container for the Sessions-page editor: a LOCAL draft with explicit
// Save/Cancel — there is no program tree to write through to. The builder's
// state hook is reused wholesale by seeding a synthetic one-slot program
// whose only session is the one being edited; the editor body's mutators map
// 1:1 onto the hook's. Save serializes slot 0 and POSTs create or overwrite;
// Cancel simply discards the local draft. The row the edit seeded from may
// be refreshed underneath mid-edit — save is last-write-wins (repo norm).
export type SessionEditorState =
  | { mode: "create" }
  | { mode: "edit"; session: SavedSession };

function blankSessionDraft(): SessionDraft {
  return {
    uid: newUid("sess"),
    // The slide-over's seed name (addSessionToSlot's own default is "Day N",
    // which only makes sense inside a program grid).
    name: "Untitled session",
    focus: null,
    estimatedDurationMinutes: null,
    calorieSurplusPercentage: null,
    notes: null,
    sessionType: "training",
    exercises: [],
  };
}

// Save persists at most 100 name chars (the library-wide cap). Legacy rows
// created before the from-calendar path was capped can carry longer names —
// clamp at seed so the input shows exactly what a save will persist, instead
// of silently renaming on the way out.
function clampName(session: SessionDraft): SessionDraft {
  return session.name.length > 100
    ? { ...session, name: session.name.slice(0, 100) }
    : session;
}

// One-week wrapper so normalizeDraft's invariants (min 1 week, 7 slots) hold.
// The session goes into slot 0 BEFORE seed() — seed clears the dirty flag, so
// placing it afterwards would mark a freshly-opened editor dirty. Exported for
// the placed-session tray, which wraps a placed session the same way.
export function makeStandaloneDraft(session: SessionDraft): ProgramDraft {
  const week = makeRestWeek(0);
  week.days[0] = { ...week.days[0], isRest: false, session };
  return {
    id: "standalone",
    name: "Standalone session",
    description: null,
    status: "draft",
    splitType: null,
    programDurationWeeks: null,
    defaultSurplusPercentage: null,
    weeks: [week],
  };
}

export function useStandaloneSessionEditor(
  state: SessionEditorState | null,
  onClose: () => void,
) {
  const { toast } = useToast();
  const { mutate: globalMutate } = useSWRConfig();
  const builder = useProgramBuilderState();
  const editSetSpec = useSetSpecMutations(builder.updateExercise);

  const identity =
    state == null
      ? null
      : state.mode === "edit"
        ? `edit:${state.session.id}`
        : "create";

  // Which open this draft was seeded for. Reset on close so re-opening the
  // same identity re-seeds fresh (fresh uids remount the body's uncontrolled
  // inputs); guarded so StrictMode's double effect-run seeds only once. The
  // draft is deliberately NOT cleared on close — the Sheet's exit animation
  // still shows it.
  const seededForRef = useRef<string | null>(null);
  const { seed } = builder;
  useEffect(() => {
    if (state == null || identity == null) {
      seededForRef.current = null;
      return;
    }
    if (seededForRef.current === identity) return;
    const session =
      state.mode === "edit"
        ? clampName(savedSessionToDraft(state.session))
        : blankSessionDraft();
    seed(makeStandaloneDraft(session));
    seededForRef.current = identity;
  }, [state, identity, seed]);

  const session = builder.draft?.weeks[0]?.days[0]?.session ?? null;

  const [isSaving, setIsSaving] = useState(false);
  // setState is async — the ref is the authoritative double-fire gate.
  const inFlightRef = useRef(false);

  const handleSave = async (): Promise<void> => {
    if (!session || state == null || inFlightRef.current) return;
    inFlightRef.current = true;
    setIsSaving(true);
    try {
      const payload = sessionDraftToStandalonePayload(session);
      // Client-side belt: readable message instead of a generic 400. The
      // create schema validates both bodies (overwrite is the same shape).
      const parsed = createStandaloneSessionSchema.safeParse(payload);
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
      const url =
        state.mode === "edit"
          ? `/api/training/saved-sessions/${state.session.id}/overwrite`
          : "/api/training/saved-sessions";
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(data.error ?? "Failed to save session");
      }
      // One shared key refreshes the table, stat band, builder drawer,
      // popover, and calendar panel.
      await globalMutate("/api/training/saved-sessions");
      toast(
        state.mode === "edit"
          ? {
              title: `"${session.name}" updated`,
              description:
                "Programs that already use a copy of this session are unchanged.",
            }
          : {
              title: `"${session.name}" saved`,
              description: "Added to your session library.",
            },
      );
      onClose();
    } catch (error) {
      toast({
        title: "Error",
        description:
          error instanceof Error ? error.message : "Failed to save session",
        variant: "destructive",
      });
    } finally {
      inFlightRef.current = false;
      setIsSaving(false);
    }
  };

  return {
    session,
    isSaving,
    handleSave,
    updateSession: builder.updateSession,
    addExercise: builder.addExercise,
    removeExercise: builder.removeExercise,
    updateExercise: builder.updateExercise,
    reorderExercise: builder.reorderExercise,
    editSetSpec,
  };
}
