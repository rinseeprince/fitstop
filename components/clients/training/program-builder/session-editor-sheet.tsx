"use client";

import { BookmarkPlus, Loader2, Sparkles } from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetTitle,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import type { SessionDraft } from "./program-builder-types";
import { SessionEditorBody, type SessionEditorBodyProps } from "./session-editor-body";
import { SessionHero } from "./session-hero";

// Click-to-edit chrome for one day cell's session: the editor body in a right
// slide-over. Write-through — "Save program" on the page is the commit point,
// so the footer's Done just closes. "Save as workout" copies the day into the
// standalone session library without touching the draft, so it renders in view
// mode too. (A day is made rest by clearing its session from the grid.)
//
// The band at the top is the builder's own hero grammar at sheet scale: it
// carries the session NAME and the calorie SURPLUS, which is why the body is
// mounted with chrome="hero" and renders neither. The body sits on #f4f7f6 with
// borderless cards — a deliberate deviation from the white-bodied sheet recipe,
// because spacing-not-borders outranks it here.
type SessionEditorSheetProps = Omit<SessionEditorBodyProps, "session" | "chrome"> & {
  session: SessionDraft | null; // null = closed
  onClose: () => void;
  onSaveAsWorkout: (sessionUid: string) => void;
  isSavingWorkout: boolean;
  // Opens the program assistant. Optional because only the builder mounts one;
  // without it the footer's left slot is simply empty.
  onOpenAssistant?: () => void;
};

export function SessionEditorSheet({
  session,
  mode,
  onClose,
  // Destructured out here — these must never reach the {...bodyProps} spread.
  onSaveAsWorkout,
  isSavingWorkout,
  onOpenAssistant,
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
        hideClose
        className="flex w-full flex-col gap-0 bg-[#f4f7f6] p-0 sm:w-[780px] sm:max-w-full"
      >
        {session && (
          <>
            {/* The visible title is the hero's inline-edit input, which has no
                accessible name of its own for the dialog. */}
            <SheetTitle className="sr-only">{session.name}</SheetTitle>
            <SheetDescription className="sr-only">
              Edit this session&apos;s focus, duration and exercises.
            </SheetDescription>

            <SessionHero
              sessionUid={session.uid}
              name={session.name}
              focus={session.focus}
              exerciseCount={session.exercises.length}
              durationMinutes={session.estimatedDurationMinutes}
              calorieSurplusPercentage={session.calorieSurplusPercentage}
              defaultSurplusPercentage={bodyProps.defaultSurplusPercentage}
              editable={editable}
              identityEditable={bodyProps.identityEditable ?? true}
              onRename={(name) =>
                bodyProps.onUpdateSession(session.uid, { name })
              }
              onSurplusChange={(calorieSurplusPercentage) =>
                bodyProps.onUpdateSession(session.uid, { calorieSurplusPercentage })
              }
              onClose={onClose}
            />

            <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-5 py-4">
              <SessionEditorBody
                session={session}
                mode={mode}
                chrome="hero"
                {...bodyProps}
              />
            </div>

            {/* White footer on the grey body. The Assistant used to float over
                this corner as a fixed launcher; it lives here now so there is
                one row of actions rather than two overlapping sets. */}
            <div className="flex items-center gap-2 border-t border-[rgba(13,148,136,0.08)] bg-white px-5 py-3">
              {onOpenAssistant && (
                <Button variant="outline" onClick={onOpenAssistant}>
                  <Sparkles className="mr-1.5 h-3.5 w-3.5" strokeWidth={1.5} />
                  Assistant
                </Button>
              )}
              <div className="flex-1" />
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
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
