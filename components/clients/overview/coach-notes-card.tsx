"use client";

import { useState } from "react";
import { Loader2, Pin, PinOff, StickyNote, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { RowActions } from "@/components/programs/shared/row-actions";
import { SectionLabel } from "@/components/programs/shared/section-label";
import { formatShortDate } from "@/components/clients/metrics/metrics-format";
import {
  FOCUS_RING,
  MONO_LABEL_CLASS,
  THUMB_CLASS,
} from "@/components/clients/training/program-builder/builder-tokens";
import { OpenTabLink, OverviewCard } from "./overview-primitives";
import type { ClientNote } from "@/types/coach-overview";

type CoachNotesCardProps = {
  notes: ClientNote[];
  /** True until the first fetch resolves — the card must not claim "no notes" before then. */
  isLoading: boolean;
  onAddNote: (body: string) => Promise<void>;
  onTogglePin: (note: ClientNote) => Promise<void>;
  onDeleteNote: (note: ClientNote) => void;
  onOpenNotes: () => void;
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
    <div className="group/row flex items-start gap-3 py-2">
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
        <p className="line-clamp-3 whitespace-pre-wrap text-[13px] text-[#0c1a1e]">{note.body}</p>
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

export function CoachNotesCard({
  notes,
  isLoading,
  onAddNote,
  onTogglePin,
  onDeleteNote,
  onOpenNotes,
}: CoachNotesCardProps) {
  const [draft, setDraft] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [pendingPinId, setPendingPinId] = useState<string | null>(null);
  const { toast } = useToast();

  const pinned = notes.find((note) => note.isPinned) ?? null;
  const latestUnpinned = notes.find((note) => !note.isPinned) ?? null;
  const visible = [pinned, latestUnpinned].filter((note): note is ClientNote => note !== null);

  const handleSave = async () => {
    const body = draft.trim();
    if (!body || isSaving) return;

    setIsSaving(true);
    try {
      await onAddNote(body);
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
      await onTogglePin(note);
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
    // The name rides a rail like every other section on the page. It was an
    // in-card 15px heading, which read as a card TITLE among six sections whose
    // names are all divider labels — the odd one out rather than a hierarchy.
    <div>
      <SectionLabel label="Coach notes" />

      <OverviewCard animationDelay="0.06s">
        {/* Top right, the same corner the two plan cards put "Open Training"
            and "Open Nutrition" in. The card has no title of its own to sit
            beside — that moved to the rail — so the row carries only this. */}
        <div className="flex justify-end px-5 pt-4">
          <OpenTabLink label="Open Notes" onClick={onOpenNotes} />
        </div>

        <div className="px-5 pb-5 pt-3">
          {isLoading && notes.length === 0 ? (
            // The resolved-empty card says nothing at all, so without this the
            // card would look settled and empty while the fetch was still out.
            <div className="space-y-2 py-2">
              <Skeleton className="h-10 w-full rounded-[6px]" />
              <Skeleton className="h-10 w-2/3 rounded-[6px]" />
            </div>
          ) : visible.length > 0 ? (
            <div className="divide-y divide-[rgba(13,148,136,0.06)]">
              {visible.map((note) => (
                <NoteRow
                  key={note.id}
                  note={note}
                  isBusy={pendingPinId === note.id}
                  onTogglePin={() => void handleTogglePin(note)}
                  onDelete={() => onDeleteNote(note)}
                />
              ))}
            </div>
          ) : null}

          <div className="mt-3 flex items-center gap-2">
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
                "h-8 rounded-[6px] border-[rgba(13,148,136,0.08)] text-[13px] placeholder:text-[#93b0b4]"
              )}
            />
            <button
              type="button"
              onClick={() => void handleSave()}
              disabled={draft.trim().length === 0 || isSaving}
              className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-[6px] bg-[#0d9488] px-3 text-[13px] font-medium text-white transition-colors hover:bg-[#0b7f75] disabled:opacity-50"
            >
              {isSaving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              Save
            </button>
          </div>
        </div>
      </OverviewCard>
    </div>
  );
}
