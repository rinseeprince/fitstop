"use client";

import { BookmarkPlus, Loader2 } from "lucide-react";
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
import {
  ASSISTANT_SHEET_BODY_CLASS,
  ASSISTANT_SHEET_CONTENT_CLASS,
  ASSISTANT_SHEET_STILL,
  SheetAssistantButton,
  SheetAssistantPanel,
  useSheetAssistantHost,
} from "./assistant/sheet-assistant-host";
import { countSessionExercises } from "@/utils/exercise-groups";
import { cn } from "@/lib/utils";

// Click-to-edit chrome for one of a day cell's sessions: the editor body in a
// right slide-over. Write-through — "Save program" on the page is the commit
// point, so the footer's Done just closes. "Save as workout" copies the
// session into the standalone session library without touching the draft, so
// it renders in view mode too. (A session is removed from its day on the grid.)
//
// The band at the top is the builder's own hero grammar at sheet scale: it
// carries the session NAME and the calorie SURPLUS, which is why the body is
// mounted with chrome="hero" and renders neither. The body sits on #f4f7f6 with
// borderless cards — a deliberate deviation from the white-bodied sheet recipe,
// because spacing-not-borders outranks it here.
//
// While it is open the sheet hosts the program assistant's panel, in the shape
// every assistant-hosting sheet shares (sheet-assistant-host.tsx): a still
// content holding the panel, the body sliding in beneath it, the Assistant
// button first in the footer. Escape belongs to whatever it was pressed in:
// inside the panel it collapses the panel, anywhere else it closes the sheet.
// The slide-out stays on the content: Radix reads the closing node's animation
// to keep it mounted, and by then the panel is back in the corner.
type SessionEditorSheetProps = Omit<SessionEditorBodyProps, "session" | "chrome"> & {
  // Its own prop, never derived from `session`: a closing sheet keeps
  // rendering the session it showed (CONVENTIONS §7 → "No frame disagrees").
  open: boolean;
  session: SessionDraft | null; // null before the first open, or once the draft drops it
  onClose: () => void;
  onSaveAsWorkout: (sessionUid: string) => void;
  isSavingWorkout: boolean;
};

export function SessionEditorSheet({
  open,
  session,
  mode,
  onClose,
  // Destructured out here — these must never reach the {...bodyProps} spread.
  onSaveAsWorkout,
  isSavingWorkout,
  ...bodyProps
}: SessionEditorSheetProps) {
  const editable = mode === "edit";
  const { panelRef, escapeWasInPanel } = useSheetAssistantHost();

  return (
    <Sheet
      open={open}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <SheetContent
        side="right"
        hideClose
        className={ASSISTANT_SHEET_CONTENT_CLASS}
        style={open ? ASSISTANT_SHEET_STILL : undefined}
        onEscapeKeyDown={(event) => {
          if (escapeWasInPanel(event)) event.preventDefault();
        }}
      >
        <div className={cn(ASSISTANT_SHEET_BODY_CLASS, "bg-[#f4f7f6]")}>
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
              exerciseCount={countSessionExercises(session)}
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

            {/* White footer on the grey body, the Assistant button first. */}
            <div className="flex items-center gap-2 border-t border-[rgba(13,148,136,0.08)] bg-white px-5 py-3">
              <SheetAssistantButton />
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
        </div>

        {/* On `open`, not `session`: a closing sheet keeps its session for its
            slide-out but hands the panel back to the corner in the same commit. */}
        <SheetAssistantPanel hosting={open} panelRef={panelRef} />
      </SheetContent>
    </Sheet>
  );
}
