"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Loader2 } from "lucide-react";
import { useSWRConfig } from "swr";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { createStandaloneSessionSchema } from "@/lib/validations/training";
import { useProgramDraft } from "./program-draft-provider";
import { sessionDraftToStandalonePayload } from "./program-builder-serialize";
import { SessionEditorBody } from "./session-editor-body";
import { MONO_LABEL_CLASS } from "./builder-tokens";

// The routed create-blank-session slide-over (@modal intercepted route).
// Single-owner lifecycle: THIS component creates the optimistic "Untitled
// session" card in the target slot on mount, so every close path can safely
// discard it — Cancel/Escape/overlay call router.back(), and the unmount
// cleanup (which browser-back also hits) clears the slot unless Save
// succeeded. Slot context travels as positional ?w=&d= (uids regenerate on
// every seed, so they can't be trusted in a URL). "Save session" persists a
// standalone library session AND keeps the copy in the day; the program
// itself still only persists via Save program (locked decision).
export function CreateSessionSlideOver() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { toast } = useToast();
  const { mutate: globalMutate } = useSWRConfig();
  const {
    draft,
    mode,
    setMode,
    addSessionToSlot,
    clearSlot,
    getDirty,
    restoreDirty,
    updateSession,
    addExercise,
    removeExercise,
    updateExercise,
    reorderExercise,
    editSetSpec,
  } = useProgramDraft();

  // Read the raw params first: Number(null) is 0, so a missing param would
  // otherwise silently target Week 1 · Day 1 and inject a phantom session.
  const wRaw = searchParams.get("w");
  const dRaw = searchParams.get("d");
  const w = wRaw ? Number(wRaw) : NaN;
  const d = dRaw ? Number(dRaw) : NaN;
  const hasTarget = Number.isInteger(w) && Number.isInteger(d) && w >= 0 && d >= 0;

  const [isSaving, setIsSaving] = useState(false);
  const savedRef = useRef(false);
  const createdHereRef = useRef(false);
  const closingRef = useRef(false);
  const baselineDirtyRef = useRef(false);
  const slotUidRef = useRef<string | null>(null);

  // Idempotent close: several paths can request it (Cancel, Escape, overlay,
  // post-save) and each maps to ONE history entry — a second router.back()
  // would pop past the builder and drop the provider (and the dirty tree).
  // push (from the popover) + back keeps history balanced — replacing to the
  // builder root would leave the intercepted entry in the stack and "back"
  // from the builder would reopen a dead modal.
  const close = useCallback(() => {
    if (closingRef.current) return;
    closingRef.current = true;
    router.back();
  }, [router]);

  // Resolve the target slot positionally on every render — weeks can't
  // reorder while the overlay is up, so the indices are stable for the
  // flow's lifetime.
  const slot = hasTarget ? draft?.weeks[w]?.days[d] : undefined;
  const session = slot?.session ?? null;

  // Ensure-effect: force edit mode and create the optimistic card once the
  // draft is ready. Re-runs on draft changes but only acts while the slot is
  // empty and nothing was saved — which also makes it StrictMode-safe (the
  // dev-only unmount cleanup clears the card, this recreates it).
  useEffect(() => {
    if (!draft || closingRef.current) return;
    if (!hasTarget || !slot) {
      // Invalid target → back out of the intercepted entry (the modal only
      // mounts via soft nav, so a previous entry exists).
      close();
      return;
    }
    slotUidRef.current = slot.uid;
    if (mode !== "edit") setMode("edit");
    if (!slot.session && !savedRef.current) {
      // Snapshot the dirty flag BEFORE the optimistic card dirties the tree,
      // so a full unwind (cancel) can restore it — a previously-clean saved
      // program must not stay flagged dirty by a cancelled create.
      baselineDirtyRef.current = getDirty();
      addSessionToSlot(slot.uid, "Untitled session");
      createdHereRef.current = true;
    }
  }, [draft, hasTarget, slot, mode, setMode, addSessionToSlot, getDirty, close]);

  // Unmount cleanup — the ONE hook that catches every close path, including
  // browser back (which unmounts the modal slot without any event we can
  // intercept). Only discards what this flow created.
  useEffect(() => {
    return () => {
      closingRef.current = true;
      if (!savedRef.current && createdHereRef.current && slotUidRef.current) {
        clearSlot(slotUidRef.current);
        restoreDirty(baselineDirtyRef.current);
      }
    };
  }, [clearSlot, restoreDirty]);

  const handleSave = async () => {
    if (!session) return;
    setIsSaving(true);
    try {
      const payload = sessionDraftToStandalonePayload(session);
      // Client-side belt: readable message instead of a generic 400.
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
      const res = await fetch("/api/training/saved-sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(data.error ?? "Failed to save session");
      }
      savedRef.current = true;
      // Refresh the session library everywhere (drawer, popover, Sessions
      // page, calendar panel — shared SWR key).
      await globalMutate("/api/training/saved-sessions");
      if (closingRef.current) {
        // Dismissed (browser back) while the POST was in flight — the
        // optimistic card may already be discarded, but the session did
        // reach the library. Never claim it landed on the day, and never
        // fire a second router.back().
        toast({
          title: `"${session.name}" saved`,
          description: "Added to your session library.",
        });
      } else {
        toast({
          title: `"${session.name}" saved`,
          description: `Added to Week ${w + 1} · Day ${d + 1} and your session library.`,
        });
        close();
      }
    } catch (error) {
      toast({
        title: "Error",
        description:
          error instanceof Error ? error.message : "Failed to save session",
        variant: "destructive",
      });
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Sheet
      open
      onOpenChange={(open) => {
        // Mid-save the flow is committed — Escape/overlay/the built-in X
        // must not race the POST (a dismissal here would discard the card
        // AND double-navigate when the save's close() lands).
        if (!open && !isSaving) close();
      }}
    >
      <SheetContent
        side="right"
        className="flex w-full flex-col gap-0 bg-white p-0 sm:w-[600px] sm:max-w-[600px]"
        onEscapeKeyDown={(e) => {
          if (isSaving) e.preventDefault();
        }}
        onInteractOutside={(e) => {
          if (isSaving) e.preventDefault();
        }}
      >
        <SheetHeader className="border-b border-[rgba(13,148,136,0.08)] px-5 py-3.5">
          <SheetTitle className="pr-8 text-[15px] font-semibold text-[#0c1a1e]">
            New session
          </SheetTitle>
          <SheetDescription asChild>
            <span className={MONO_LABEL_CLASS}>
              Adding to Week {w + 1} · Day {d + 1}
            </span>
          </SheetDescription>
        </SheetHeader>

        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-5 py-4">
          {session ? (
            <SessionEditorBody
              session={session}
              mode="edit"
              defaultSurplusPercentage={draft?.defaultSurplusPercentage ?? null}
              onUpdateSession={updateSession}
              onAddExercise={addExercise}
              onRemoveExercise={removeExercise}
              onEditExercise={updateExercise}
              onReorderExercise={reorderExercise}
              onSpecEdit={editSetSpec}
            />
          ) : (
            <div className="flex flex-1 items-center justify-center">
              <Loader2 className="h-5 w-5 animate-spin text-[#93b0b4]" />
            </div>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-[rgba(13,148,136,0.08)] px-5 py-3">
          <Button variant="ghost" disabled={isSaving} onClick={close}>
            Cancel
          </Button>
          <Button
            className="bg-[#0d9488] text-white hover:bg-[#0b7f75]"
            disabled={isSaving || !session}
            onClick={() => void handleSave()}
          >
            {isSaving && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
            Save session
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
