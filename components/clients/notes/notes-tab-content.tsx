"use client";

import { useState } from "react";
import { Loader2, Pin, PinOff, StickyNote, Trash2 } from "lucide-react";
import { RowActions } from "@/components/programs/shared/row-actions";
import { DeleteNoteDialog } from "./delete-note-dialog";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { SectionLabel } from "@/components/programs/shared/section-label";
import { useToast } from "@/hooks/use-toast";
import { useClientNotes } from "@/hooks/use-client-notes";
import { formatShortDate } from "@/components/clients/metrics/metrics-format";
import {
  FOCUS_RING,
  MONO_LABEL_CLASS,
  THUMB_CLASS,
} from "@/components/clients/training/program-builder/builder-tokens";
import { pluralize } from "@/components/clients/overview/overview-format";
import type { ClientNote } from "@/types/coach-overview";

type NotesTabContentProps = {
  client: { id: string };
};

function NoteRow({
  note,
  onTogglePin,
  onDelete,
  isBusy,
}: {
  note: ClientNote;
  onTogglePin: () => void;
  onDelete: () => void;
  isBusy: boolean;
}) {
  return (
    <div className="group/row flex items-start gap-3 px-5 py-4">
      <span
        className={cn(
          "grid h-8 w-8 shrink-0 place-items-center rounded-[6px]",
          note.isPinned ? THUMB_CLASS : "bg-[#f0f5f4] text-[#5a7d82]"
        )}
      >
        {note.isPinned ? (
          <Pin className="h-4 w-4" strokeWidth={1.5} />
        ) : (
          <StickyNote className="h-4 w-4" strokeWidth={1.5} />
        )}
      </span>
      <div className="min-w-0 flex-1">
        <p className="whitespace-pre-wrap text-[13px] text-[#0c1a1e]">{note.body}</p>
        <p className={cn(MONO_LABEL_CLASS, "mt-1 text-[10px] normal-case tracking-normal")}>
          {note.isPinned ? "Pinned · " : ""}
          {formatShortDate(note.createdAt)}
        </p>
      </div>
      {isBusy ? (
        <span className="grid h-7 w-7 shrink-0 place-items-center text-[#93b0b4]">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
        </span>
      ) : (
        <div className="shrink-0">
          <RowActions
            actions={[
              {
                label: note.isPinned ? "Unpin note" : "Pin note to the Overview",
                icon: note.isPinned ? PinOff : Pin,
                onClick: onTogglePin,
              },
              { label: "Delete note", icon: Trash2, onClick: onDelete, danger: true },
            ]}
          />
        </div>
      )}
    </div>
  );
}

export function NotesTabContent({ client }: NotesTabContentProps) {
  const { notes, isLoading, isError, addNote, setPinned, deleteNote } = useClientNotes(client.id);
  const [draft, setDraft] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [pendingPinId, setPendingPinId] = useState<string | null>(null);
  const [notePendingDelete, setNotePendingDelete] = useState<ClientNote | null>(null);
  const { toast } = useToast();

  const handleSave = async () => {
    const body = draft.trim();
    if (!body || isSaving) return;

    setIsSaving(true);
    try {
      await addNote(body);
      setDraft("");
      toast({ title: "Note saved" });
    } catch (error) {
      toast({
        title: "Save failed",
        description: error instanceof Error ? error.message : "Something went wrong",
        variant: "destructive",
      });
    } finally {
      setIsSaving(false);
    }
  };

  const handleTogglePin = async (note: ClientNote) => {
    setPendingPinId(note.id);
    try {
      await setPinned(note.id, !note.isPinned);
      toast({ title: note.isPinned ? "Note unpinned" : "Note pinned" });
    } catch (error) {
      toast({
        title: "Update failed",
        description: error instanceof Error ? error.message : "Something went wrong",
        variant: "destructive",
      });
    } finally {
      setPendingPinId(null);
    }
  };

  return (
    <div>
      <SectionLabel
        label="Coach notes"
        meta={notes.length > 0 ? pluralize(notes.length, "note") : undefined}
      />

      <div className="mb-4 flex items-center gap-2">
        <Input
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") void handleSave();
          }}
          maxLength={5000}
          placeholder="Add a note about this client"
          aria-label="Add a note about this client"
          className={cn(
            FOCUS_RING,
            "h-9 rounded-[6px] border-[rgba(13,148,136,0.08)] bg-white text-[13px] placeholder:text-[#93b0b4]"
          )}
        />
        <button
          type="button"
          onClick={() => void handleSave()}
          disabled={draft.trim().length === 0 || isSaving}
          className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-[6px] bg-[#0d9488] px-4 text-[13px] font-medium text-white transition-colors hover:bg-[#0b7f75] disabled:opacity-50"
        >
          {isSaving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
          Save note
        </button>
      </div>

      {isError ? (
        <p className="py-12 text-center text-[13px] text-[#93b0b4]">Failed to load notes.</p>
      ) : isLoading && notes.length === 0 ? (
        <Skeleton className="h-[140px] w-full rounded-[6px]" />
      ) : notes.length === 0 ? (
        <div className="rounded-[6px] bg-white px-5 py-12 text-center">
          <StickyNote className="mx-auto h-8 w-8 text-[#93b0b4] opacity-50" strokeWidth={1.5} />
          <p className="mt-2 text-sm text-[#5a7d82]">No notes about this client yet</p>
          <p className="mt-1 text-xs text-[#93b0b4]">
            Use the field above — the pinned note also shows on the Overview.
          </p>
        </div>
      ) : (
        <div className="divide-y divide-[rgba(13,148,136,0.06)] rounded-[6px] bg-white">
          {notes.map((note) => (
            <NoteRow
              key={note.id}
              note={note}
              isBusy={pendingPinId === note.id}
              onTogglePin={() => void handleTogglePin(note)}
              onDelete={() => setNotePendingDelete(note)}
            />
          ))}
        </div>
      )}

      <DeleteNoteDialog
        note={notePendingDelete}
        onOpenChange={(open) => {
          if (!open) setNotePendingDelete(null);
        }}
        onConfirm={deleteNote}
      />
    </div>
  );
}
