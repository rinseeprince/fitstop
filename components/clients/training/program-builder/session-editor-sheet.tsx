"use client";

import { useRef } from "react";
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
import { useAssistant } from "./assistant/assistant-provider";
import { AssistantPanel } from "./assistant/assistant-panel";
import { countSessionExercises } from "@/utils/exercise-groups";

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
// While it is open the sheet hosts the program assistant's panel: the sheet is
// a modal layer, so a panel anywhere else on the page would be given no pointer
// events, bounced out of by the focus trap, hidden from screen readers and
// locked out of wheel scrolling. As a child of the sheet's own content it is
// inside every one of those rules by construction (assistant-panel.tsx; the
// state is the provider's, so the conversation is the one the corner dock
// showed). Escape belongs to whatever it was pressed in: inside the panel it
// collapses the panel, anywhere else it closes the sheet.
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
  const assistant = useAssistant();
  const panelRef = useRef<HTMLDivElement>(null);

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
        className="flex w-full flex-col gap-0 bg-[#f4f7f6] p-0 sm:w-[780px] sm:max-w-full"
        // Radix brings every Escape on the page to the top layer — this sheet.
        // One pressed inside the hosted panel is the panel's to answer (its own
        // key handler collapses it), so the sheet declines it and stays;
        // anywhere else in the sheet, the sheet closes as before.
        onEscapeKeyDown={(event) => {
          if (event.target instanceof Node && panelRef.current?.contains(event.target)) {
            event.preventDefault();
          }
        }}
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

            {/* White footer on the grey body. The assistant's corner chip is
                hidden while this sheet is up, so this button is the way in —
                one row of actions rather than two overlapping sets. */}
            <div className="flex items-center gap-2 border-t border-[rgba(13,148,136,0.08)] bg-white px-5 py-3">
              <Button variant="outline" onClick={() => assistant.setOpen(true)}>
                <Sparkles className="mr-1.5 h-3.5 w-3.5" strokeWidth={1.5} />
                Assistant
              </Button>
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

        {/* The hosted panel, last in the content so the tab order reaches it
            after Done. The content is flush with the viewport's right and
            bottom edges, so bottom-5 right-5 here is the corner the dock uses
            over the grid: the panel lands where it was, over the footer's right
            end. It is part of the content, so it arrives with the sheet —
            during the sheet's slide-in it travels with it — and on `open`, not
            `session`: a closing sheet keeps its session for its slide-out but
            hands the panel back to the corner dock in the same commit, so there
            is one panel on every frame and it never moves on a close. */}
        {open && assistant.open && (
          <AssistantPanel ref={panelRef} className="absolute bottom-5 right-5" />
        )}
      </SheetContent>
    </Sheet>
  );
}
