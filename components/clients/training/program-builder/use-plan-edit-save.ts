"use client";

import { useCallback, useState } from "react";
import { toast } from "sonner";
import { draftToPlanEditBody } from "./placed-serialize";
import type { ProgramDraft } from "./program-builder-types";

// The plan editor's save, sibling of use-client-apply: `request` opens the
// confirm; `confirm` PUTs the whole grid with the read's version. A 409 — the
// calendar changed since the editor opened — opens the refusal dialog with
// the draft intact. Edits landing during the save keep the tree dirty for a
// second save, with the version refreshed so that save isn't refused for the
// change the first one made.

export type PlanEditSaveApi = {
  isSaving: boolean;
  confirmOpen: boolean;
  setConfirmOpen: (open: boolean) => void;
  staleOpen: boolean;
  setStaleOpen: (open: boolean) => void;
  request: () => void;
  confirm: () => Promise<void>;
  reloadAndDiscard: () => Promise<void>;
};

type UsePlanEditSaveParams = {
  enabled: boolean;
  clientId: string | null;
  planId: string | null;
  getDraft: () => ProgramDraft | null;
  getRevision: () => number;
  markSaved: (revision: number) => boolean;
  version: string | null;
  reload: () => Promise<void>;
  refreshVersion: () => Promise<void>;
  onSaved?: () => Promise<void> | void;
};

export function usePlanEditSave({
  enabled,
  clientId,
  planId,
  getDraft,
  getRevision,
  markSaved,
  version,
  reload,
  refreshVersion,
  onSaved,
}: UsePlanEditSaveParams): PlanEditSaveApi {
  const [isSaving, setIsSaving] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [staleOpen, setStaleOpen] = useState(false);

  const request = useCallback(() => {
    if (enabled) setConfirmOpen(true);
  }, [enabled]);

  const confirm = useCallback(async () => {
    const draft = getDraft();
    if (!enabled || !clientId || !planId || !draft || !version) return;
    setIsSaving(true);
    try {
      // Snapshot the mutation counter: an edit landing mid-save must not be
      // marked clean.
      const revision = getRevision();
      const res = await fetch(`/api/clients/${clientId}/training/${planId}/edit`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(draftToPlanEditBody(draft, version)),
      });
      if (res.status === 409) {
        // One state update: the confirm closes as the refusal opens.
        setConfirmOpen(false);
        setStaleOpen(true);
        return;
      }
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(data.error ?? "Failed to save plan changes");
      }
      if (markSaved(revision)) {
        toast.success("Plan updated");
        // The confirm keeps spinning until the calendar has the saved plan,
        // and the host then closes the editor with the confirm still on it,
        // so the first frame after the editor goes is the saved calendar.
        if (onSaved) await onSaved();
        else setConfirmOpen(false);
      } else {
        setConfirmOpen(false);
        toast("You made edits while saving", {
          description: "Save again to include them.",
        });
        await refreshVersion();
      }
    } catch (err) {
      toast.error("Save failed", {
        description: err instanceof Error ? err.message : "Failed to save plan changes",
      });
    } finally {
      setIsSaving(false);
    }
  }, [
    enabled,
    clientId,
    planId,
    getDraft,
    getRevision,
    markSaved,
    version,
    refreshVersion,
    onSaved,
  ]);

  const reloadAndDiscard = useCallback(async () => {
    await reload();
    setStaleOpen(false);
  }, [reload]);

  return {
    isSaving,
    confirmOpen,
    setConfirmOpen,
    staleOpen,
    setStaleOpen,
    request,
    confirm,
    reloadAndDiscard,
  };
}
