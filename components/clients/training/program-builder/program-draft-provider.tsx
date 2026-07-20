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
import { LAST_PLAN_STORAGE_KEY } from "@/lib/programs-nav";
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

// Owns the builder's working tree + mode + save pipeline ABOVE the route
// level: the builder page (children slot) and the create-session slide-over
// (@modal slot) are sibling trees that must mutate the same draft. The
// [savedPlanId] layout renders this with key={savedPlanId}, preserving the
// old page-level remount guarantee (a dynamic-segment layout does NOT remount
// on param change by itself — state would leak across plans without the key).
export type ProgramDraftContextValue = ProgramBuilderState & {
  savedPlanId: string;
  target: BuilderTarget;
  // Client scope for target="client-draft" (null in library mode). Threading it
  // through the provider — not TrainingBuilderProvider — is deliberate:
  // ProgramBuilder is also mounted on /dashboard/programs, where that context
  // is absent, so reading it there would throw.
  clientId: string | null;
  onApplied?: () => void;
  plan: SavedPlan | null;
  isPlanLoading: boolean;
  mutatePlan: () => Promise<unknown>;
  mode: "view" | "edit";
  setMode: (mode: "view" | "edit") => void;
  isSaving: boolean;
  saveProgram: () => Promise<void>;
  // Re-seed the working tree from the last server state (saved plans' Discard
  // changes). Re-seeding regenerates uids, so any open session editor closes
  // itself (its uid no longer resolves).
  discardChanges: () => void;
  editSetSpec: (sessionUid: string, exercise: ExerciseDraft, edit: SetSpecEdit) => void;
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
  savedPlanId: string;
  target: BuilderTarget;
  // Present only for target="client-draft" (the client editor's apply target).
  clientId?: string;
  onApplied?: () => void;
  children: ReactNode;
};

export function ProgramDraftProvider({
  savedPlanId,
  target,
  clientId,
  onApplied,
  children,
}: ProgramDraftProviderProps) {
  const { toast } = useToast();
  const { plan, isLoading: isPlanLoading, mutate: mutatePlan } = useSavedPlan(savedPlanId);
  const state = useProgramBuilderState();
  const { draft, seed, isDirty, getRevision, markSaved, updateExercise } = state;

  const [mode, setMode] = useState<"view" | "edit">("view");
  const { isSaving, save } = useProgramSave({ savedPlanId, plan, mutatePlan });
  const editSetSpec = useSetSpecMutations(updateExercise);

  // The Programs section's Builder item returns to the last opened program.
  // Library only — writing it from the client-draft remount would silently
  // repoint the coach's Programs "Builder" nav to this client's template.
  useEffect(() => {
    if (savedPlanId && target === "library") {
      sessionStorage.setItem(LAST_PLAN_STORAGE_KEY, savedPlanId);
    }
  }, [savedPlanId, target]);

  // Seed the working tree from server state exactly once (the !draft gate
  // makes SWR refreshes no-ops). Cross-plan cleanup is the layout's
  // key={savedPlanId} remount. New drafts open straight into edit mode and
  // stay there until Save program.
  useEffect(() => {
    if (plan && !draft) {
      seed(savedPlanToDraft(plan));
      if (plan.status === "draft") setMode("edit");
    }
  }, [plan, draft, seed]);

  // Refresh/close guard while there are unsaved edits. Library only: a
  // client-draft never "saves" (edits materialize onto the calendar via Apply,
  // they are not persisted here), so isDirty stays true after Apply and this
  // would nag forever; the in-app back + Escape guards cover intentional exit
  // from the client editor.
  useEffect(() => {
    if (!(isDirty && mode === "edit" && target === "library")) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [isDirty, mode, target]);

  const saveProgram = useCallback(async () => {
    const current = draft;
    if (!current || target !== "library") return;
    // Snapshot the mutation counter: the grid stays interactive while the
    // save is in flight, and an edit landing mid-save must NOT be marked
    // clean (it was never serialized — clearing dirty would silently lose it).
    const revision = getRevision();
    const result = await save(current);
    if (result === "saved") {
      const clean = markSaved(revision);
      if (clean) {
        setMode("view");
      } else {
        toast({
          title: "You made edits while saving",
          description: "Save again to include them.",
        });
      }
    }
    // "kept-draft" / "error": stay in edit mode with the draft intact.
  }, [draft, target, getRevision, save, markSaved, toast]);

  const discardChanges = useCallback(() => {
    if (!plan) return;
    seed(savedPlanToDraft(plan));
    setMode("view");
  }, [plan, seed]);

  const value: ProgramDraftContextValue = {
    ...state,
    savedPlanId,
    target,
    clientId: clientId ?? null,
    onApplied,
    plan: plan ?? null,
    isPlanLoading,
    mutatePlan,
    mode,
    setMode,
    isSaving,
    saveProgram,
    discardChanges,
    editSetSpec,
  };

  return (
    <ProgramDraftContext.Provider value={value}>
      {children}
    </ProgramDraftContext.Provider>
  );
}
