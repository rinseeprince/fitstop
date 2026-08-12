"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { useToast } from "@/hooks/use-toast";
import { useSavedPlan } from "@/hooks/use-saved-plan";
import type { SavedPlan } from "@/types/training";
import type {
  BuilderTarget,
  ExerciseDraft,
} from "./program-builder-types";
import { savedPlanToDraft } from "./program-builder-serialize";
import {
  useProgramBuilderState,
  type ProgramBuilderState,
} from "./use-program-builder-state";
import { useSetSpecMutations, type SetSpecEdit } from "./use-set-spec-mutations";
import { useProgramSave } from "./use-program-save";
import { usePlacedPlanSource } from "./use-placed-plan-source";
import { useLockedMutators } from "./use-locked-mutators";
import { useAmendPlan, type AmendPlanApi } from "./use-amend-plan";

// Owns the builder's working tree + mode + save pipeline ABOVE the route
// level: the builder page (children slot) and the create-session slide-over
// (@modal slot) are sibling trees that must mutate the same draft. The
// [savedPlanId] layout renders this with key={savedPlanId}, preserving the
// old page-level remount guarantee (a dynamic-segment layout does NOT remount
// on param change by itself — state would leak across plans without the key).
//
// Three targets, three sources: "library"/"client-draft" seed from the saved
// plan; "placed-plan" seeds from the amendment GET (a client's live placed
// program — past slots locked, saves go through the amend PUT). For the placed
// target the context's mutators are the LOCKED wrappers, so every UI path
// refuses history at one choke point.
export type ProgramDraftContextValue = ProgramBuilderState & {
  savedPlanId: string | null;
  placedPlanId: string | null;
  target: BuilderTarget;
  // Client scope for target="client-draft"/"placed-plan" (null in library
  // mode). Threading it through the provider — not TrainingBuilderProvider —
  // is deliberate: ProgramBuilder is also mounted on /dashboard/programs,
  // where that context is absent, so reading it there would throw.
  clientId: string | null;
  clientName: string | null;
  // Device-synced client timezone — anchors the apply dialog's start-date
  // floor to the CLIENT's local today (the server guard's anchor).
  clientTimezone: string | null;
  onApplied?: () => void;
  plan: SavedPlan | null;
  isPlanLoading: boolean;
  mutatePlan: () => Promise<unknown>;
  mode: "view" | "edit";
  setMode: (mode: "view" | "edit") => void;
  isSaving: boolean;
  // "saved" only when the whole tree persisted cleanly (the caller navigates
  // back to the programs list on that); "kept-draft"/"error" stay in the
  // builder; "skipped" = not a library save (client-draft applies instead).
  saveProgram: () => Promise<"saved" | "kept-draft" | "error" | "skipped">;
  // Re-seed the working tree from the last server state (saved plans' Discard
  // changes; the placed target re-seeds from the amendment read). Re-seeding
  // regenerates uids, so any open session editor closes itself (its uid no
  // longer resolves).
  discardChanges: () => void;
  editSetSpec: (sessionUid: string, exercise: ExerciseDraft, edit: SetSpecEdit) => void;
  // True while an AI-assistant turn is in flight. Soft-lock only: the grid
  // stays editable (ops compose with manual edits), but Save/Apply and the
  // chat send are disabled so a save can't interleave with an op replay.
  assistantBusy: boolean;
  setAssistantBusy: (busy: boolean) => void;
  // --- placed-plan (amendment) surface ---
  // Slots whose calendar day is history (empty set for other targets). The
  // grid renders them inert, dnd excludes them, the locked mutators and the
  // assistant's ops ctx refuse them.
  lockedSlotUids: ReadonlySet<string>;
  movedPastSlotUids: ReadonlySet<string>;
  fullyLocked: boolean;
  sessionIdByUid: ReadonlyMap<string, string>;
  futureModifiedEvents: Array<{ id: string; date: string; sessionName: string }>;
  placedLoadError: string | null;
  amend: AmendPlanApi;
  isAmending: boolean;
  amendPlan: () => void;
};

const ProgramDraftContext = createContext<ProgramDraftContextValue | null>(null);

export function useProgramDraft(): ProgramDraftContextValue {
  const value = useContext(ProgramDraftContext);
  if (!value) {
    throw new Error("useProgramDraft must be used inside ProgramDraftProvider");
  }
  return value;
}

type ProgramDraftProviderProps = {
  // The library template id — required for "library"/"client-draft" targets.
  savedPlanId?: string;
  // The client-side training_plans id — required for target="placed-plan".
  placedPlanId?: string;
  target: BuilderTarget;
  // Present for target="client-draft" (apply) and "placed-plan" (amend).
  clientId?: string;
  clientName?: string;
  clientTimezone?: string;
  onApplied?: () => void;
  // Fired after a clean amendment save (the overlay refreshes the calendar
  // caches and closes).
  onAmended?: () => void;
  children: ReactNode;
};

export function ProgramDraftProvider({
  savedPlanId,
  placedPlanId,
  target,
  clientId,
  clientName,
  clientTimezone,
  onApplied,
  onAmended,
  children,
}: ProgramDraftProviderProps) {
  const { toast } = useToast();
  const isPlaced = target === "placed-plan";
  const { plan, isLoading: isPlanLoading, mutate: mutatePlan } = useSavedPlan(
    isPlaced ? null : savedPlanId ?? null,
  );
  const state = useProgramBuilderState();
  const { draft, seed, isDirty, getDraft, getRevision, markSaved, updateExercise } = state;

  const [mode, setMode] = useState<"view" | "edit">("view");
  const [assistantBusy, setAssistantBusy] = useState(false);
  const { isSaving, save } = useProgramSave({
    savedPlanId: savedPlanId ?? "",
    plan,
    mutatePlan,
  });
  const editSetSpec = useSetSpecMutations(updateExercise);

  const placed = usePlacedPlanSource({
    enabled: isPlaced,
    clientId: clientId ?? null,
    placedPlanId: placedPlanId ?? null,
    state,
    setMode,
  });
  const lockedMutators = useLockedMutators({
    enabled: isPlaced,
    lockedSlotUids: placed.lockedSlotUids,
    state,
    editSetSpec,
  });
  const amend = useAmendPlan({
    enabled: isPlaced,
    clientId: clientId ?? null,
    placedPlanId: placedPlanId ?? null,
    getDraft,
    getRevision,
    markSaved,
    amendmentToken: placed.amendmentToken,
    reload: placed.reload,
    refreshToken: placed.refreshToken,
    onAmended,
  });

  // Seed the working tree from server state exactly once (the !draft gate
  // makes SWR refreshes no-ops; the placed target seeds inside its source
  // hook). Cross-plan cleanup is the layout's key={savedPlanId} remount.
  // New drafts open straight into edit mode and stay there until Save program.
  useEffect(() => {
    if (!isPlaced && plan && !draft) {
      seed(savedPlanToDraft(plan));
      if (plan.status === "draft") setMode("edit");
    }
  }, [isPlaced, plan, draft, seed]);

  // Refresh/close guard while there are unsaved edits. Library + placed (both
  // have a real save that clears dirty); a client-draft never "saves" (edits
  // materialize onto the calendar via Apply), so isDirty stays true after
  // Apply and this would nag forever — its in-app back + Escape guards cover
  // intentional exit.
  useEffect(() => {
    const guarded = target === "library" || target === "placed-plan";
    if (!(isDirty && mode === "edit" && guarded)) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [isDirty, mode, target]);

  const saveProgram = useCallback(async (): Promise<
    "saved" | "kept-draft" | "error" | "skipped"
  > => {
    const current = draft;
    if (!current || target !== "library") return "skipped";
    // Snapshot the mutation counter: the grid stays interactive while the
    // save is in flight, and an edit landing mid-save must NOT be marked
    // clean (it was never serialized — clearing dirty would silently lose it).
    const revision = getRevision();
    const result = await save(current);
    if (result === "saved") {
      const clean = markSaved(revision);
      if (clean) {
        setMode("view");
        return "saved";
      }
      // Edits landed mid-save — stay so the coach can re-save (don't navigate).
      toast({
        title: "You made edits while saving",
        description: "Save again to include them.",
      });
      return "kept-draft";
    }
    // "kept-draft" / "error": stay in edit mode with the draft intact.
    return result;
  }, [draft, target, getRevision, save, markSaved, toast]);

  const discardChanges = useCallback(() => {
    if (isPlaced) {
      // Re-seed from the last amendment read; the placed surface stays in
      // edit mode (it opened there).
      placed.discard();
      return;
    }
    if (!plan) return;
    seed(savedPlanToDraft(plan));
    setMode("view");
  }, [isPlaced, placed, plan, seed]);

  const value: ProgramDraftContextValue = {
    ...state,
    // Locked wrappers (identity pass-through for non-placed targets) — the
    // single manual-edit choke point for the amendment surface.
    ...lockedMutators,
    savedPlanId: savedPlanId ?? null,
    placedPlanId: placedPlanId ?? null,
    target,
    clientId: clientId ?? null,
    clientName: clientName ?? null,
    clientTimezone: clientTimezone ?? null,
    onApplied,
    plan: plan ?? null,
    isPlanLoading: isPlaced ? placed.isLoading : isPlanLoading,
    mutatePlan,
    mode,
    setMode,
    isSaving,
    saveProgram,
    discardChanges,
    editSetSpec: lockedMutators.editSetSpec,
    assistantBusy,
    setAssistantBusy,
    lockedSlotUids: placed.lockedSlotUids,
    movedPastSlotUids: placed.movedPastSlotUids,
    fullyLocked: placed.fullyLocked,
    sessionIdByUid: placed.sessionIdByUid,
    futureModifiedEvents: placed.futureModifiedEvents,
    placedLoadError: placed.loadError,
    amend,
    isAmending: amend.isAmending,
    amendPlan: amend.request,
  };

  return (
    <ProgramDraftContext.Provider value={value}>
      {children}
    </ProgramDraftContext.Provider>
  );
}
