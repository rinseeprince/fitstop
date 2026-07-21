"use client";

import { useState } from "react";
import { useDraggable } from "@dnd-kit/core";
import { Dumbbell, GripVertical, Pencil, Plus, Search, Trash2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import { useStandaloneSessions } from "@/hooks/use-standalone-sessions";
import { StandaloneSessionEditor } from "@/components/programs/standalone-session-editor";
import type { SessionEditorState } from "@/components/programs/use-standalone-session-editor";
import { RowActions } from "@/components/programs/shared/row-actions";
import type { SavedSession } from "@/types/training";
import type { LibrarySessionDragData } from "./use-program-dnd";
import {
  CHIP_NEUTRAL_CLASS,
  FOCUS_RING,
  MONO_LABEL_CLASS,
  TEXT_MUTED,
  TEXT_PRIMARY,
  THUMB_CLASS,
  TRAINING_CARD_BORDER,
} from "./builder-tokens";

// Sessions tab of the builder library panel (S4.5). Grew out of the old
// Evolved from the retired session-library-drawer (S4.5): same grip-only
// draggable card that inserts a
// clone into a REST day-cell, now with full library CRUD reachable per card
// (edit/duplicate/delete) plus a "New session" affordance — the standalone
// Sessions page is retired, so this is the ONLY session-authoring surface.
// The whole card is the draggable node; only the grip carries the pointer
// listeners so RowActions + the click never start a drag.
function LibrarySessionCard({
  session,
  editable,
  onEdit,
  onDelete,
}: {
  session: SavedSession;
  editable: boolean;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const dragData: LibrarySessionDragData = { type: "library-session", session };
  const { setNodeRef, attributes, listeners, isDragging } = useDraggable({
    id: `lib-${session.id}`,
    data: dragData,
    // Drops mutate the program — a grid interaction that only lands in edit
    // mode. CRUD below stays reachable in both modes.
    disabled: !editable,
  });

  return (
    <div
      ref={setNodeRef}
      className={cn(
        "group/row flex items-center gap-2 rounded-[6px] bg-white p-2 pl-1.5 transition-all",
        TRAINING_CARD_BORDER,
        isDragging && "opacity-40",
        "hover:-translate-y-px hover:shadow-[0_6px_20px_rgba(13,148,136,0.08)]",
      )}
    >
      <button
        type="button"
        aria-label={`Drag ${session.name}`}
        className={cn(
          "shrink-0 rounded",
          editable ? "cursor-grab active:cursor-grabbing" : "cursor-default",
          TEXT_MUTED,
        )}
        {...attributes}
        {...listeners}
      >
        <GripVertical className="h-3.5 w-3.5" strokeWidth={1.5} />
      </button>
      <span className={cn(THUMB_CLASS, "h-[30px] w-[30px]")}>
        <Dumbbell className="h-[15px] w-[15px]" strokeWidth={1.5} />
      </span>
      <div className="min-w-0 flex-1">
        <div className={cn("truncate text-xs font-semibold", TEXT_PRIMARY)}>
          {session.name}
        </div>
        <div className={cn("mt-0.5", MONO_LABEL_CLASS, "normal-case tracking-normal")}>
          {session.exercises.length} exercises
          {session.estimatedDurationMinutes != null &&
            ` · ${session.estimatedDurationMinutes} min`}
        </div>
        {session.focus && (
          <span className={cn("mt-1 inline-block", CHIP_NEUTRAL_CLASS)}>
            {session.focus}
          </span>
        )}
      </div>
      <RowActions
        actions={[
          { label: "Edit", icon: Pencil, onClick: onEdit },
          { label: "Delete", icon: Trash2, danger: true, onClick: onDelete },
        ]}
      />
    </div>
  );
}

export function LibrarySessionList({ editable }: { editable: boolean }) {
  const { toast } = useToast();
  const { sessions, isLoading, mutate } = useStandaloneSessions();
  const [query, setQuery] = useState("");
  const [editorState, setEditorState] = useState<SessionEditorState | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<SavedSession | null>(null);

  const handleDelete = async (session: SavedSession) => {
    try {
      const res = await fetch(`/api/training/saved-sessions/${session.id}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error();
      toast({ title: "Session deleted" });
      await mutate();
    } catch {
      toast({
        title: "Error",
        description: "Failed to delete session",
        variant: "destructive",
      });
    }
  };

  const q = query.trim().toLowerCase();
  const filtered = q
    ? sessions.filter(
        (s) =>
          s.name.toLowerCase().includes(q) ||
          (s.focus ?? "").toLowerCase().includes(q),
      )
    : sessions;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="mb-2 px-[18px]">
        <div className="relative">
          <Search
            className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[#93b0b4]"
            strokeWidth={1.5}
          />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search sessions"
            aria-label="Search sessions"
            className={cn("h-8 pl-8 text-xs", FOCUS_RING)}
          />
        </div>
      </div>

      {editable && (
        <div className={cn("px-[18px] pb-1.5", MONO_LABEL_CLASS)}>
          Drag a session onto a day
        </div>
      )}

      <div className="min-h-0 flex-1 space-y-2 overflow-y-auto px-[14px] pb-2">
        {isLoading ? (
          <p className={cn("py-4 text-center text-xs", TEXT_MUTED)}>Loading…</p>
        ) : filtered.length === 0 ? (
          <p className={cn("px-1 py-4 text-center text-xs", TEXT_MUTED)}>
            {sessions.length === 0
              ? "No saved sessions yet — create one below or from any rest day."
              : "No sessions match your search."}
          </p>
        ) : (
          filtered.map((session) => (
            <LibrarySessionCard
              key={session.id}
              session={session}
              editable={editable}
              onEdit={() => setEditorState({ mode: "edit", session })}
              onDelete={() => setDeleteTarget(session)}
            />
          ))
        )}
      </div>

      <div className="border-t border-[rgba(13,148,136,0.08)] px-[18px] py-3">
        <button
          type="button"
          className="flex h-8 w-full items-center justify-center gap-1.5 rounded-[6px] border border-dashed border-[rgba(13,148,136,0.25)] text-xs font-medium text-[#5a7d82] transition-colors hover:border-[#0d9488] hover:bg-[rgba(13,148,136,0.05)] hover:text-[#0a5c55]"
          onClick={() => setEditorState({ mode: "create" })}
        >
          <Plus className="h-3.5 w-3.5" strokeWidth={1.5} /> New session
        </button>
      </div>

      <StandaloneSessionEditor
        state={editorState}
        onClose={() => setEditorState(null)}
      />

      <ConfirmDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null);
        }}
        title="Delete this session?"
        description={`"${deleteTarget?.name ?? ""}" will be removed from your session library. Programs that already contain a copy of it are unaffected.`}
        confirmLabel="Delete session"
        destructive
        onConfirm={() => {
          if (deleteTarget) void handleDelete(deleteTarget);
          setDeleteTarget(null);
        }}
      />
    </div>
  );
}
