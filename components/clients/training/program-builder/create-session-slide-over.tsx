"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Loader2 } from "lucide-react";
import { useSWRConfig } from "swr";
import {
  Sheet,
  SheetCloseButton,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { createStandaloneSessionSchema } from "@/lib/validations/training";
import { useProgramDraft } from "./program-draft-provider";
import { sessionDraftToStandalonePayload } from "./program-builder-serialize";
import { findSession } from "./program-builder-model";
import { SessionEditorBody } from "./session-editor-body";
import { MONO_LABEL_CLASS } from "./builder-tokens";
import {
  ASSISTANT_SHEET_BODY_CLASS,
  ASSISTANT_SHEET_CONTENT_CLASS,
  ASSISTANT_SHEET_STILL,
  SheetAssistantButton,
  SheetAssistantPanel,
  useSheetAssistantHost,
} from "./assistant/sheet-assistant-host";
import { cn } from "@/lib/utils";

// The routed create-blank-session slide-over (@modal intercepted route).
// Single-owner lifecycle: THIS component creates the optimistic "Untitled
// session" card on the target day on mount — after any sessions the day
// already holds — so every close path can safely discard it: Cancel/Escape/
// overlay call router.back(), and the unmount cleanup (which browser-back also
// hits) removes that one session unless Save succeeded, leaving the day's
// others as they were. Slot context travels as positional ?w=&d= (uids
// regenerate on every seed, so they can't be trusted in a URL). "Save session"
// persists a standalone library session AND keeps the copy in the day; the
// program itself still only persists via Save program (locked decision).
//
// The session is the program's, on its day, so the sheet hosts the program
// assistant the way the session sheet does (sheet-assistant-host.tsx): the
// Assistant button first in the footer, the panel in the still content's
// corner, Escape inside the panel collapsing it. The sheet is open exactly
// while its address is, which is also what steps the corner dock aside
// (create-session-route.ts), so the two hosts trade the panel in one commit.
// Its close is drawn in the sliding body, so it arrives with the sheet.
export function CreateSessionSlideOver() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { mutate: globalMutate } = useSWRConfig();
  const {
    draft,
    mode,
    setMode,
    addSessionToSlot,
    removeSession,
    getDirty,
    restoreDirty,
    updateSession,
    addExercise,
    removeExercise,
    updateExercise,
    linkExercises,
    unlinkGroup,
    moveExercise,
    moveGroup,
    updateGroup,
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
  const { panelRef, escapeWasInPanel } = useSheetAssistantHost();
  const savedRef = useRef(false);
  // The session this flow created — its identity, so the flow edits and
  // discards that one session and never the day's others.
  const createdUidRef = useRef<string | null>(null);
  const baselineDirtyRef = useRef(false);

  // TWO lifecycle refs with deliberately DIFFERENT StrictMode semantics — do
  // not merge them back into one flag (that latch deadlocked the slide-over:
  // StrictMode runs setup→cleanup→setup with refs persisting, so a one-way
  // "closed" latch set in cleanup froze the remounted instance).
  //
  // navigatedRef — "this instance already fired its router.back()". One-shot
  // and NEVER reset: a second back() would pop past the builder and drop the
  // provider (and the dirty tree). Surviving the simulated remount is
  // correct — if mount #1 navigated, mount #2 must not navigate again.
  const navigatedRef = useRef(false);
  // unmountedRef — "past the FINAL unmount". Symmetric setup/cleanup (armed
  // false on every effect setup, true in cleanup), so it reads false again
  // after a StrictMode remount and only stays true once the component is
  // really gone. Consulted by the in-flight save's continuation.
  const unmountedRef = useRef(false);

  // Idempotent close: several paths can request it (Cancel, Escape, overlay,
  // post-save) and each maps to ONE history entry. push (from the popover) +
  // back keeps history balanced — replacing to the builder root would leave
  // the intercepted entry in the stack and "back" from the builder would
  // reopen a dead modal.
  const close = useCallback(() => {
    if (navigatedRef.current) return;
    navigatedRef.current = true;
    router.back();
  }, [router]);

  // Resolve the target slot positionally on every render — weeks can't
  // reorder while the overlay is up, so the indices are stable for the
  // flow's lifetime.
  const slot = hasTarget ? draft?.weeks[w]?.days[d] : undefined;
  // The session this flow edits: the one it created on that day.
  const session = findSession(draft, createdUidRef.current);

  // Ensure-effect: force edit mode and create the optimistic card once the
  // draft is ready. Re-runs on draft changes but only acts while this flow has
  // created nothing and nothing was saved — StrictMode-safe: the simulated-
  // unmount cleanup below discards the card, and this re-run recreates it
  // (guarded by navigatedRef, which only trips when the flow genuinely left).
  useEffect(() => {
    if (!draft || navigatedRef.current) return;
    if (!hasTarget || !slot) {
      // Invalid target → back out of the intercepted entry (the modal only
      // mounts via soft nav, so a previous entry exists).
      close();
      return;
    }
    if (mode !== "edit") setMode("edit");
    if (createdUidRef.current === null && !savedRef.current) {
      // Snapshot the dirty flag BEFORE the optimistic card dirties the tree,
      // so a full unwind (cancel) can restore it — a previously-clean saved
      // program must not stay flagged dirty by a cancelled create.
      baselineDirtyRef.current = getDirty();
      const uid = addSessionToSlot(slot.uid, "Untitled session");
      // A full day takes no more — nothing was created, so leave.
      if (!uid) {
        close();
        return;
      }
      createdUidRef.current = uid;
    }
  }, [draft, hasTarget, slot, mode, setMode, addSessionToSlot, getDirty, close]);

  // Unmount cleanup — the ONE hook that catches every close path, including
  // browser back (which unmounts the modal slot without any event we can
  // intercept). Only discards the session this flow created. Under StrictMode
  // the cleanup also runs on the simulated unmount; the discard is undone by
  // the ensure-effect's re-run, and the setup re-arms unmountedRef.
  useEffect(() => {
    unmountedRef.current = false;
    return () => {
      unmountedRef.current = true;
      const created = createdUidRef.current;
      if (!savedRef.current && created) {
        removeSession(created);
        restoreDirty(baselineDirtyRef.current);
        createdUidRef.current = null;
      }
    };
  }, [removeSession, restoreDirty]);

  const handleSave = async () => {
    if (!session) return;
    setIsSaving(true);
    try {
      const payload = sessionDraftToStandalonePayload(session);
      // Client-side belt: readable message instead of a generic 400.
      const parsed = createStandaloneSessionSchema.safeParse(payload);
      if (!parsed.success) {
        const issue = parsed.error.issues[0];
        toast.error("Can't save session", {
          description: issue
            ? `${issue.message}${issue.path.length ? ` (${issue.path.join(".")})` : ""}`
            : "Invalid session",
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
      if (unmountedRef.current || navigatedRef.current) {
        // Dismissed (browser back) while the POST was in flight — the
        // optimistic card may already be discarded, but the session did
        // reach the library. Never claim it landed on the day, and never
        // fire a second router.back().
        toast.success(`"${session.name}" saved`, {
          description: "Added to your session library.",
        });
      } else {
        toast.success(`"${session.name}" saved`, {
          description: `Added to Week ${w + 1} · Day ${d + 1} and your session library.`,
        });
        close();
      }
    } catch (error) {
      toast.error("Error", {
        description: error instanceof Error ? error.message : "Failed to save session",
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
        hideClose
        className={ASSISTANT_SHEET_CONTENT_CLASS}
        style={ASSISTANT_SHEET_STILL}
        // Mid-save nothing closes it; an Escape pressed inside the hosted panel
        // is the panel's to answer.
        onEscapeKeyDown={(e) => {
          if (isSaving || escapeWasInPanel(e)) e.preventDefault();
        }}
        onInteractOutside={(e) => {
          if (isSaving) e.preventDefault();
        }}
      >
        <div className={cn(ASSISTANT_SHEET_BODY_CLASS, "bg-white")}>
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
                onLinkExercises={linkExercises}
                onUnlinkGroup={unlinkGroup}
                onMoveExercise={moveExercise}
                onMoveGroup={moveGroup}
                onUpdateGroup={updateGroup}
                onSpecEdit={editSetSpec}
              />
            ) : (
              <div className="flex flex-1 items-center justify-center">
                <Loader2 className="h-5 w-5 animate-spin text-[#93b0b4]" />
              </div>
            )}
          </div>

          <div className="flex items-center gap-2 border-t border-[rgba(13,148,136,0.08)] px-5 py-3">
            <SheetAssistantButton />
            <div className="flex-1" />
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
          {/* Last in the body, as the content's own close was last in it, so
              the first focus stays on the session's name. */}
          <SheetCloseButton />
        </div>
        {/* Mounted only while the address is the sheet's, so it hosts for as
            long as it is on the page. */}
        <SheetAssistantPanel hosting panelRef={panelRef} />
      </SheetContent>
    </Sheet>
  );
}
