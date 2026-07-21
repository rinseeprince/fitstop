"use client";

import { useCallback, useState } from "react";
import { useSWRConfig } from "swr";
import { useToast } from "@/hooks/use-toast";
import { overwriteSavedPlanSchema } from "@/lib/validations/training";
import type { SavedPlan } from "@/types/training";
import type { ProgramDraft } from "./program-builder-types";
import { draftToOverwriteBody } from "./program-builder-serialize";

// "Save program" flow: overwrite (whole tree) → keep programDurationWeeks
// accurate → promote drafts. On ANY failure the local draft is kept and the
// coach is prompted to re-save — overwrite is non-atomic server-side
// (delete-all then row-by-row inserts), so the in-memory draft is the only
// full copy until a save fully succeeds. Never discard it on error.
type SaveResult = "saved" | "kept-draft" | "error";

type UseProgramSaveParams = {
  savedPlanId: string;
  plan: SavedPlan | null;
  mutatePlan: () => Promise<unknown>;
};

export function useProgramSave({ savedPlanId, plan, mutatePlan }: UseProgramSaveParams) {
  const { toast } = useToast();
  const { mutate: globalMutate } = useSWRConfig();
  const [isSaving, setIsSaving] = useState(false);
  const baseUrl = `/api/training/saved-plans/${savedPlanId}`;

  const save = useCallback(
    async (draft: ProgramDraft): Promise<SaveResult> => {
      setIsSaving(true);
      try {
        const body = draftToOverwriteBody(draft);

        // Client-side belt: same schema the route parses, so a rejected save
        // fails here with a readable message instead of a generic 400.
        const parsed = overwriteSavedPlanSchema.safeParse(body);
        if (!parsed.success) {
          const issue = parsed.error.issues[0];
          toast({
            title: "Can't save program",
            // Include the path — "Number must be ≤ 100" alone doesn't tell the
            // coach which of dozens of set inputs to fix.
            description: issue
              ? `${issue.message}${issue.path.length ? ` (${issue.path.join(".")})` : ""}`
              : "Invalid program structure",
            variant: "destructive",
          });
          return "error";
        }

        const res = await fetch(`${baseUrl}/overwrite`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        if (!res.ok) {
          const data = (await res.json().catch(() => ({}))) as { error?: string };
          throw new Error(data.error ?? "Failed to save program");
        }

        // Keep programDurationWeeks truthful — overwrite never writes it.
        // Fires on every successful save where the count changed (not
        // promote-gated); non-fatal, the next save retries it.
        if (plan?.programDurationWeeks !== draft.weeks.length) {
          try {
            await fetch(baseUrl, {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ programDurationWeeks: draft.weeks.length }),
            });
          } catch {
            // Metadata only — the structure is already committed.
          }
        }

        if (draft.status === "draft") {
          // No saveSessionsIndividually flag: default false = pure status
          // flip (true would spawn name-deduped standalone session copies).
          const promoteRes = await fetch(`${baseUrl}/promote`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: "{}",
          });
          if (promoteRes.status === 409) {
            // The overwrite above already committed — the program content IS
            // saved, it just stays a draft until renamed. Wording matters:
            // never imply nothing was saved.
            await mutatePlan();
            toast({
              title: "Saved as draft",
              description:
                "A program with this name already exists — rename it and save again to publish.",
              variant: "destructive",
            });
            return "kept-draft";
          }
          if (!promoteRes.ok) throw new Error("Failed to publish program");
        }

        // Refresh the SWR cache BEFORE the caller clears local edit state, so
        // any reseed reads the committed save (ordering inherited from the
        // retired draft-editor, deleted in S5).
        await mutatePlan();
        await globalMutate("/api/training/saved-plans");
        toast({ title: "Program saved" });
        return "saved";
      } catch (error) {
        toast({
          title: "Error",
          description: `${
            error instanceof Error ? error.message : "Failed to save program"
          } — your changes are still here, try saving again.`,
          variant: "destructive",
        });
        return "error";
      } finally {
        setIsSaving(false);
      }
    },
    [baseUrl, plan, mutatePlan, globalMutate, toast],
  );

  return { isSaving, save };
}
