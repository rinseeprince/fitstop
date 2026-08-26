"use client";

import { useState } from "react";
import { format } from "date-fns";
import { Dumbbell, Loader2, Lock, MoreVertical, Save } from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { SessionEditorBody } from "@/components/clients/training/program-builder/session-editor-body";
import {
  MONO_LABEL_CLASS,
  THUMB_CLASS,
} from "@/components/clients/training/program-builder/builder-tokens";
import {
  usePlacedSessionEditor,
  type PlacedSessionState,
  type SaveScope,
} from "./use-placed-session-editor";

// Builder-grade tray for one PLACED session, opened from the calendar. Hosts
// the shared session-editor-body (per-set specs, drop sets, video, identity —
// placed identity is editable, renames land on future scheduled events only)
// against a local draft with explicit Save/Cancel. Replaces the legacy
// session-detail-drawer.
type PlacedSessionEditorProps = {
  state: PlacedSessionState | null; // null = closed
  onClose: () => void;
  onUpdate: () => void;
  mutateCalendar: () => Promise<unknown>;
  onSelectSession?: (sessionId: string, eventId: string) => void;
};

const DANGER_OUTLINE_BUTTON =
  "border border-[rgba(192,96,96,0.3)] text-[#c06060] hover:bg-[rgba(192,96,96,0.08)] hover:text-[#c06060]";

// The sentence the server sends back on a 409 (`assertSessionUnlogged`), down
// to the date format, so the standing state and the race toast cannot render
// one day two ways. **Both spell `EEE, MMM d` because that is the app-wide
// convention** — this panel's own header does too — not because either is
// matching the other; if the convention moves, both move
// (`training-event-occupancy.ts` -> formatDay).
//
// Naming the day matters: the lock is on the SESSION, so a coach can open a day
// whose own event is still scheduled and find it locked by an occurrence they
// logged. Plain sans, dates included (docs/newdesignsystem.md: mono never
// inside a sentence).
const loggedLockMessage = (date: string) =>
  `The client logged this session on ${format(new Date(date + "T00:00:00"), "EEE, MMM d")}, so it can no longer be edited.`;

export function PlacedSessionEditor({
  state,
  onClose,
  onUpdate,
  mutateCalendar,
  onSelectSession,
}: PlacedSessionEditorProps) {
  const {
    session,
    isSeeded,
    isLoading,
    loadError,
    isDirty,
    futureScheduledCount,
    loggedEvent,
    savingScope,
    isSaving,
    handleSave,
    isSavingToLibrary,
    handleSaveToLibrary,
    updateSession,
    addExercise,
    removeExercise,
    updateExercise,
    reorderExercise,
    editSetSpec,
  } = usePlacedSessionEditor(state, {
    onClose,
    onUpdate,
    mutateCalendar,
    onSelectSession,
  });

  const [scopeDialogOpen, setScopeDialogOpen] = useState(false);
  const [discardDialogOpen, setDiscardDialogOpen] = useState(false);
  const [libraryDialogOpen, setLibraryDialogOpen] = useState(false);
  const [libraryName, setLibraryName] = useState("");

  // Latch the header meta: `state` nulls synchronously on close but the Sheet
  // stays mounted through its exit animation — deriving from live `state`
  // would blank the date mid-slide.
  const [displayDate, setDisplayDate] = useState<string | null>(null);
  if (state && state.date !== displayDate) {
    setDisplayDate(state.date);
  }

  const requestClose = () => {
    if (isSaving) return;
    if (isDirty) {
      setDiscardDialogOpen(true);
      return;
    }
    onClose();
  };

  const requestSave = () => {
    if (isSaving || !session) return;
    if (futureScheduledCount > 1) {
      setScopeDialogOpen(true);
      return;
    }
    void handleSave("all");
  };

  const saveWithScope = (scope: SaveScope) => {
    setScopeDialogOpen(false);
    void handleSave(scope);
  };

  const showBody = isSeeded && session != null;
  const isLocked = loggedEvent != null;
  const dateLabel = displayDate
    ? format(new Date(displayDate + "T00:00:00"), "EEE, MMM d")
    : "";

  return (
    <>
      <Sheet open={state != null} onOpenChange={(open) => !open && requestClose()}>
        <SheetContent
          side="right"
          className="flex w-full flex-col gap-0 bg-white p-0 sm:w-[780px] sm:max-w-full"
          onEscapeKeyDown={(e) => {
            if (isSaving) e.preventDefault();
          }}
          onInteractOutside={(e) => {
            if (isSaving) e.preventDefault();
          }}
        >
          <SheetHeader className="flex-row items-center gap-3 space-y-0 border-b border-[rgba(13,148,136,0.08)] px-5 py-3.5">
            <div className={cn(THUMB_CLASS, "h-8 w-8")}>
              <Dumbbell className="h-4 w-4" strokeWidth={1.5} />
            </div>
            <div className="min-w-0 flex-1">
              <SheetTitle className="truncate text-[15px] font-semibold text-[#0c1a1e]">
                {session?.name ?? "Session"}
              </SheetTitle>
              <SheetDescription
                className={cn(MONO_LABEL_CLASS, "normal-case tracking-normal")}
              >
                {dateLabel}
                {futureScheduledCount > 1
                  ? ` · on ${futureScheduledCount} upcoming days`
                  : ""}
              </SheetDescription>
            </div>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  aria-label="Session actions"
                  className="mr-7 rounded p-1 text-[#93b0b4] transition-colors hover:text-[#0d9488]"
                >
                  <MoreVertical className="h-3.5 w-3.5" strokeWidth={1.5} />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-52">
                <DropdownMenuItem
                  disabled={isDirty || isSavingToLibrary || !session}
                  onSelect={() => {
                    setLibraryName(session?.name ?? "");
                    setLibraryDialogOpen(true);
                  }}
                >
                  <Save className="h-3.5 w-3.5" strokeWidth={1.5} />
                  {isDirty ? "Save to library (save changes first)" : "Save to library"}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </SheetHeader>

          <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-5 py-4">
            {showBody ? (
              <SessionEditorBody
                session={session}
                // A logged day opens READ-ONLY, the same way the plan builder
                // opens a locked slot (program-builder.tsx:514-522). Every
                // input disables, the exercise picker goes, drag is off.
                mode={isLocked ? "view" : "edit"}
                identityEditable
                defaultSurplusPercentage={null}
                surplusHelpText="Leave blank for no surplus"
                onUpdateSession={updateSession}
                onAddExercise={addExercise}
                onRemoveExercise={removeExercise}
                onEditExercise={updateExercise}
                onReorderExercise={reorderExercise}
                onSpecEdit={editSetSpec}
              />
            ) : loadError && !isLoading ? (
              <div className="flex flex-1 items-center justify-center text-sm text-[#5a7d82]">
                Failed to load this session — close and try again.
              </div>
            ) : (
              <div className="flex flex-1 items-center justify-center">
                <Loader2 className="h-5 w-5 animate-spin text-[#93b0b4]" />
              </div>
            )}
          </div>

          <div className="flex items-center justify-end gap-2 border-t border-[rgba(13,148,136,0.08)] px-5 py-3">
            {isLocked ? (
              <>
                {/* Save is HIDDEN, not disabled: this is structural, and a
                    permanently dead button is worse than none (the call Phase 2
                    made for the prescribed-row delete). */}
                <span className="mr-auto flex items-center gap-1.5 text-[12px] text-[#5a7d82]">
                  <Lock className="h-3 w-3 shrink-0" strokeWidth={1.5} />
                  {loggedLockMessage(loggedEvent.date)}
                </span>
                <Button variant="ghost" onClick={onClose}>
                  Close
                </Button>
              </>
            ) : (
              <>
                <Button variant="ghost" disabled={isSaving} onClick={requestClose}>
                  Cancel
                </Button>
                <Button
                  className="bg-[#0d9488] text-white hover:bg-[#0b7f75]"
                  disabled={isSaving || !showBody}
                  onClick={requestSave}
                >
                  {isSaving && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
                  Save
                </Button>
              </>
            )}
          </div>
        </SheetContent>
      </Sheet>

      {/* Scope dialog — the session repeats on future days */}
      <Dialog open={scopeDialogOpen} onOpenChange={setScopeDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Save changes</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-[#5a7d82]">
            This session repeats across the calendar. Where should these changes
            apply?
          </p>
          <div className="space-y-2 py-1">
            <button
              className="flex w-full cursor-pointer items-center gap-3 rounded-[6px] border border-[rgba(13,148,136,0.08)] p-3 text-left transition-colors hover:bg-[rgba(13,148,136,0.03)]"
              onClick={() => saveWithScope("day")}
              disabled={isSaving}
            >
              {savingScope === "day" ? (
                <Loader2 className="h-4 w-4 shrink-0 animate-spin text-[#0d9488]" />
              ) : (
                <div className="h-4 w-4 shrink-0 rounded-full border-2 border-[#0d9488]" />
              )}
              <div>
                <p className="text-sm font-medium text-[#0c1a1e]">Just this day</p>
                <p className="text-[11px] text-[#93b0b4]">
                  Create a copy with your changes for this date only
                </p>
              </div>
            </button>
            <button
              className="flex w-full cursor-pointer items-center gap-3 rounded-[6px] border border-[rgba(13,148,136,0.08)] p-3 text-left transition-colors hover:bg-[rgba(13,148,136,0.03)]"
              onClick={() => saveWithScope("all")}
              disabled={isSaving}
            >
              {savingScope === "all" ? (
                <Loader2 className="h-4 w-4 shrink-0 animate-spin text-[#0d9488]" />
              ) : (
                <div className="h-4 w-4 shrink-0 rounded-full border-2 border-[#93b0b4]" />
              )}
              <div>
                <p className="text-sm font-medium text-[#0c1a1e]">All occurrences</p>
                <p className="text-[11px] text-[#93b0b4]">
                  Apply changes to every future scheduled day
                </p>
              </div>
            </button>
          </div>
          <DialogFooter>
            <Button
              variant="ghost"
              onClick={() => setScopeDialogOpen(false)}
              disabled={isSaving}
            >
              Cancel
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Discard-confirm on dirty cancel */}
      <Dialog open={discardDialogOpen} onOpenChange={setDiscardDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Discard changes?</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-[#5a7d82]">
            Your edits to this session haven&apos;t been saved.
          </p>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setDiscardDialogOpen(false)}>
              Keep editing
            </Button>
            <Button
              variant="outline"
              className={DANGER_OUTLINE_BUTTON}
              onClick={() => {
                setDiscardDialogOpen(false);
                onClose();
              }}
            >
              Discard changes
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Save-to-library name dialog */}
      <Dialog open={libraryDialogOpen} onOpenChange={setLibraryDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Save to library</DialogTitle>
          </DialogHeader>
          <div className="space-y-1.5 py-1">
            <Label htmlFor="library-session-name">Session name</Label>
            <Input
              id="library-session-name"
              value={libraryName}
              maxLength={100}
              onChange={(e) => setLibraryName(e.target.value)}
              placeholder="Session name"
            />
            <p className="text-[11px] text-[#93b0b4]">
              Saved as a standalone session in your library.
            </p>
          </div>
          <DialogFooter>
            <Button
              variant="ghost"
              onClick={() => setLibraryDialogOpen(false)}
              disabled={isSavingToLibrary}
            >
              Cancel
            </Button>
            <Button
              className="bg-[#0d9488] text-white hover:bg-[#0b7f75]"
              disabled={isSavingToLibrary || !libraryName.trim()}
              onClick={() => {
                void handleSaveToLibrary(libraryName).then((ok) => {
                  if (ok) setLibraryDialogOpen(false);
                });
              }}
            >
              {isSavingToLibrary && (
                <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
              )}
              Save to library
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
