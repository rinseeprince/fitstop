"use client";

import { useCallback, useState } from "react";
import { useToast } from "@/hooks/use-toast";
import { draftToAmendBody } from "./placed-serialize";
import type { ProgramDraft } from "./program-builder-types";

// "Save changes to plan" flow for the placed-plan target, sibling of
// use-client-apply: request opens the confirm dialog (with the moved-events
// warning), confirm PUTs the whole grid + drift token. A 409 opens the
// reload-vs-keep-editing drift dialog with the draft intact; mid-save edits
// keep the tree dirty for a re-save (mirroring saveProgram), with the token
// refreshed so that re-save doesn't self-409 against our own amendment.

export type AmendPlanApi = {
  isAmending: boolean;
  confirmOpen: boolean;
  setConfirmOpen: (open: boolean) => void;
  driftOpen: boolean;
  setDriftOpen: (open: boolean) => void;
  request: () => void;
  confirm: () => Promise<void>;
  reloadAndDiscard: () => Promise<void>;
};

type UseAmendPlanParams = {
  enabled: boolean;
  clientId: string | null;
  placedPlanId: string | null;
  getDraft: () => ProgramDraft | null;
  getRevision: () => number;
  markSaved: (revision: number) => boolean;
  amendmentToken: string | null;
  reload: () => Promise<void>;
  refreshToken: () => Promise<void>;
  onAmended?: () => void;
};

export function useAmendPlan({
  enabled,
  clientId,
  placedPlanId,
  getDraft,
  getRevision,
  markSaved,
  amendmentToken,
  reload,
  refreshToken,
  onAmended,
}: UseAmendPlanParams): AmendPlanApi {
  const { toast } = useToast();
  const [isAmending, setIsAmending] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [driftOpen, setDriftOpen] = useState(false);

  const request = useCallback(() => {
    if (enabled) setConfirmOpen(true);
  }, [enabled]);

  const confirm = useCallback(async () => {
    const draft = getDraft();
    if (!enabled || !clientId || !placedPlanId || !draft || !amendmentToken) return;
    setIsAmending(true);
    try {
      // Snapshot the mutation counter: the grid stays interactive while the
      // save is in flight — an edit landing mid-save must not be marked clean.
      const revision = getRevision();
      const body = draftToAmendBody(
        draft,
        {
          name: draft.name.slice(0, 100),
          splitType: draft.splitType ? draft.splitType.slice(0, 100) : draft.splitType,
        },
        amendmentToken,
      );
      const res = await fetch(
        `/api/clients/${clientId}/training/${placedPlanId}/amendment`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        },
      );
      if (res.status === 409) {
        setConfirmOpen(false);
        setDriftOpen(true);
        return;
      }
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(data.error ?? "Failed to save plan changes");
      }
      setConfirmOpen(false);
      if (markSaved(revision)) {
        toast({ title: "Plan updated" });
        onAmended?.();
      } else {
        toast({
          title: "You made edits while saving",
          description: "Save again to include them.",
        });
        await refreshToken();
      }
    } catch (err) {
      toast({
        title: "Save failed",
        description:
          err instanceof Error ? err.message : "Failed to save plan changes",
        variant: "destructive",
      });
    } finally {
      setIsAmending(false);
    }
  }, [
    enabled,
    clientId,
    placedPlanId,
    getDraft,
    getRevision,
    markSaved,
    amendmentToken,
    refreshToken,
    onAmended,
    toast,
  ]);

  const reloadAndDiscard = useCallback(async () => {
    setDriftOpen(false);
    await reload();
  }, [reload]);

  return {
    isAmending,
    confirmOpen,
    setConfirmOpen,
    driftOpen,
    setDriftOpen,
    request,
    confirm,
    reloadAndDiscard,
  };
}
