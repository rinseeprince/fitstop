"use client";

import { useCallback, useState } from "react";
import type { SavedPlan } from "@/types/training";
import type { InlinePlanBody } from "@/lib/validations/training";
import type { ProgramDraft } from "./program-builder-types";
import { draftToInlinePlanBody } from "./program-builder-serialize";

// Owns the client-draft "Apply to client" flow (Phase 5): a reapply
// confirmation gate → the shared ApplyToClientDialog. Extracted from the
// ProgramBuilder orchestrator (already over the file-size budget) so the
// pristine→type:"plan" / dirty→type:"inline" branch is unit-testable on its
// own. Library-mode mounts never call requestApply (canApply is false without a
// clientId), so this is inert on /dashboard/programs.

type UseClientApplyParams = {
  draft: ProgramDraft | null;
  isDirty: boolean;
  clientId: string | null;
  plan: SavedPlan | null;
};

type UseClientApply = {
  canApply: boolean;
  confirmOpen: boolean;
  setConfirmOpen: (open: boolean) => void;
  dialogOpen: boolean;
  setDialogOpen: (open: boolean) => void;
  // Opens the reapply confirmation (the confirm precedes the dialog because
  // start-date/repeat are picked INSIDE the dialog — the confirm can't name
  // dates it doesn't know yet).
  requestApply: () => void;
  // Confirm → close the confirmation, open the apply dialog.
  confirmApply: () => void;
  // Dirty → the edited working copy is placed inline (saved_plan_id = NULL, the
  // template untouched). Clean → undefined, so the dialog places the pristine
  // template by id (type:"plan", provenance preserved). Computed only while the
  // dialog is open (the modal freezes the grid, so the draft can't change).
  inlinePlan: InlinePlanBody | undefined;
};

export function useClientApply({
  draft,
  isDirty,
  clientId,
  plan,
}: UseClientApplyParams): UseClientApply {
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);

  const canApply = clientId != null && plan != null && draft != null;

  const requestApply = useCallback(() => {
    if (canApply) setConfirmOpen(true);
  }, [canApply]);

  const confirmApply = useCallback(() => {
    setConfirmOpen(false);
    setDialogOpen(true);
  }, []);

  const inlinePlan =
    dialogOpen && isDirty && draft ? draftToInlinePlanBody(draft) : undefined;

  return {
    canApply,
    confirmOpen,
    setConfirmOpen,
    dialogOpen,
    setDialogOpen,
    requestApply,
    confirmApply,
    inlinePlan,
  };
}
