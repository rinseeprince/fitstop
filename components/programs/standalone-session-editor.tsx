"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { SessionEditorBody } from "@/components/clients/training/program-builder/session-editor-body";
import {
  useStandaloneSessionEditor,
  type SessionEditorState,
} from "./use-standalone-session-editor";

// Sheet chrome for creating/editing a STANDALONE library session on the
// Sessions page. Hosts the shared session-editor-body against a local draft
// with explicit Save/Cancel (unlike the builder's write-through sheet).
// components/programs ↔ program-builder already import in both directions
// (program-builder.tsx uses programs/shared/, programs-topbar links back) —
// this adds no file-level cycle.
type StandaloneSessionEditorProps = {
  state: SessionEditorState | null; // null = closed
  onClose: () => void;
};

export function StandaloneSessionEditor({
  state,
  onClose,
}: StandaloneSessionEditorProps) {
  const {
    session,
    isSaving,
    handleSave,
    updateSession,
    addExercise,
    removeExercise,
    updateExercise,
    reorderExercise,
    editSetSpec,
  } = useStandaloneSessionEditor(state, onClose);

  // Latch the mode for rendering: `state` nulls synchronously on close but
  // the Sheet stays mounted through its exit animation (and the hook retains
  // the draft for the same reason) — deriving chrome from the live `state`
  // would flip an edit sheet's title/footer to create-mode text mid-slide.
  // Render-phase adjustment (not an effect) so the first open never flashes
  // the previous mode.
  const [displayMode, setDisplayMode] = useState<"create" | "edit">("create");
  if (state && state.mode !== displayMode) {
    setDisplayMode(state.mode);
  }
  const isEdit = displayMode === "edit";

  return (
    <Sheet
      open={state != null}
      onOpenChange={(open) => {
        // Mid-save the flow is committed — dismissal must not race the POST.
        if (!open && !isSaving) onClose();
      }}
    >
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
        <SheetHeader className="border-b border-[rgba(13,148,136,0.08)] px-5 py-3.5">
          <SheetTitle className="pr-8 text-[15px] font-semibold text-[#0c1a1e]">
            {isEdit ? "Edit session" : "New session"}
          </SheetTitle>
          <SheetDescription className="text-xs text-[#5a7d82]">
            {isEdit
              ? "Edits apply to your library copy only — programs that already include this session keep their own copy."
              : "A reusable session for your library — insert it into any program from the builder."}
          </SheetDescription>
        </SheetHeader>

        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-5 py-4">
          {session ? (
            <SessionEditorBody
              session={session}
              mode="edit"
              defaultSurplusPercentage={null}
              surplusHelpText="Optional — applies when this session is used in a program"
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
          <Button variant="ghost" disabled={isSaving} onClick={onClose}>
            Cancel
          </Button>
          <Button
            className="bg-[#0d9488] text-white hover:bg-[#0b7f75]"
            disabled={isSaving || !session}
            onClick={() => void handleSave()}
          >
            {isSaving && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
            {isEdit ? "Save changes" : "Save session"}
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
