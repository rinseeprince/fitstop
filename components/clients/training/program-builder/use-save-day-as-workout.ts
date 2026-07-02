"use client";

import { useRef, useState } from "react";
import { useSWRConfig } from "swr";
import { useToast } from "@/hooks/use-toast";
import { createStandaloneSessionSchema } from "@/lib/validations/training";
import type { ProgramDraft } from "./program-builder-types";
import { findSession } from "./program-builder-model";
import { sessionDraftToStandalonePayload } from "./program-builder-serialize";

// "Save as workout": copy one day-slot's session (the CURRENT draft state,
// saved or not) into the standalone session library. Never mutates the
// draft, so it works in view mode too. The server dedupes the name with
// " (copy N)" — the coach never typed it here — and returns the final name
// for the toast.
export function useSaveDayAsWorkout(draft: ProgramDraft | null) {
  const { toast } = useToast();
  const { mutate: globalMutate } = useSWRConfig();
  const [isSavingWorkout, setIsSavingWorkout] = useState(false);
  // setState is async — a double-click inside one tick could double-fire
  // before the disabled prop lands, so the ref is the authoritative gate.
  const inFlightRef = useRef(false);

  const saveDayAsWorkout = async (sessionUid: string): Promise<void> => {
    if (inFlightRef.current) return;
    const session = findSession(draft, sessionUid);
    if (!session) return;
    inFlightRef.current = true;
    setIsSavingWorkout(true);
    try {
      const payload = sessionDraftToStandalonePayload(session);
      // Client-side belt: readable message instead of a generic 400.
      const parsed = createStandaloneSessionSchema.safeParse(payload);
      if (!parsed.success) {
        const issue = parsed.error.issues[0];
        toast({
          title: "Can't save workout",
          description: issue
            ? `${issue.message}${issue.path.length ? ` (${issue.path.join(".")})` : ""}`
            : "Invalid session",
          variant: "destructive",
        });
        return;
      }
      const res = await fetch("/api/training/saved-sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...payload, dedupeName: true }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(data.error ?? "Failed to save workout");
      }
      const data = (await res.json().catch(() => ({}))) as { name?: string };
      // Refresh the session library everywhere (drawer, popover, Sessions
      // page, calendar panel — shared SWR key).
      await globalMutate("/api/training/saved-sessions");
      toast({
        title: `Saved to your library as "${data.name ?? payload.name}"`,
        description: "Find it under Programs → Sessions.",
      });
    } catch (error) {
      toast({
        title: "Error",
        description:
          error instanceof Error ? error.message : "Failed to save workout",
        variant: "destructive",
      });
    } finally {
      inFlightRef.current = false;
      setIsSavingWorkout(false);
    }
  };

  return { isSavingWorkout, saveDayAsWorkout };
}
