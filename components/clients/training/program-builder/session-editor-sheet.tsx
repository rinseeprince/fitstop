"use client";

import { BookmarkPlus, Loader2, Moon } from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import type { SessionDraft } from "./program-builder-types";
import { SessionEditorBody, type SessionEditorBodyProps } from "./session-editor-body";

// Click-to-edit chrome for one day cell's session: the editor body in a
// right slide-over (replaces the old centered Dialog — one editor surface,
// same treatment as the routed create-blank slide-over). Write-through: the
// only footer action is Done (+ Make-rest in edit mode); "Save program" on
// the page is the commit point. "Save as workout" copies the day into the
// standalone session library without touching the draft, so it renders in
// view mode too.
type SessionEditorSheetProps = Omit<SessionEditorBodyProps, "session"> & {
  session: SessionDraft | null; // null = closed
  onClose: () => void;
  onClearToRest: (sessionUid: string) => void;
  onSaveAsWorkout: (sessionUid: string) => void;
  isSavingWorkout: boolean;
};

export function SessionEditorSheet({
  session,
  mode,
  onClose,
  onClearToRest,
  // Destructured out here — these must never reach the {...bodyProps} spread.
  onSaveAsWorkout,
  isSavingWorkout,
  ...bodyProps
}: SessionEditorSheetProps) {
  const editable = mode === "edit";

  return (
    <Sheet
      open={session != null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <SheetContent
        side="right"
        className="flex w-full flex-col gap-0 bg-white p-0 sm:w-[780px] sm:max-w-full"
      >
        {session && (
          <>
            <SheetHeader className="border-b border-[rgba(13,148,136,0.08)] px-5 py-3.5">
              <SheetTitle className="pr-8 text-[15px] font-semibold text-[#0c1a1e]">
                {editable ? "Edit session" : session.name}
              </SheetTitle>
              <SheetDescription className="sr-only">
                Session editor for {session.name}
              </SheetDescription>
            </SheetHeader>

            <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-5 py-4">
              <SessionEditorBody session={session} mode={mode} {...bodyProps} />
            </div>

            <div className="flex items-center justify-between gap-2 border-t border-[rgba(13,148,136,0.08)] px-5 py-3">
              {editable ? (
                <Button
                  variant="ghost"
                  className="text-destructive hover:bg-red-50 hover:text-destructive"
                  onClick={() => {
                    onClearToRest(session.uid);
                    onClose();
                  }}
                >
                  <Moon className="mr-1.5 h-3.5 w-3.5" strokeWidth={1.5} />
                  Make this a rest day
                </Button>
              ) : (
                <span />
              )}
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  disabled={isSavingWorkout}
                  onClick={() => onSaveAsWorkout(session.uid)}
                >
                  {isSavingWorkout ? (
                    <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <BookmarkPlus className="mr-1.5 h-3.5 w-3.5" strokeWidth={1.5} />
                  )}
                  Save as workout
                </Button>
                <Button
                  className="bg-[#0d9488] text-white hover:bg-[#0b7f75]"
                  onClick={onClose}
                >
                  Done
                </Button>
              </div>
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
