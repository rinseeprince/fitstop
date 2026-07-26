"use client";

import { useState } from "react";
import { Loader2, Pin, StickyNote } from "lucide-react";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { formatShortDate } from "@/components/clients/metrics/metrics-format";
import {
  FOCUS_RING,
  MONO_LABEL_CLASS,
  THUMB_CLASS,
} from "@/components/clients/training/program-builder/builder-tokens";
import { CardHeader, OpenTabLink, OverviewCard } from "./overview-primitives";
import type { ClientNote } from "@/types/coach-overview";

type CoachNotesCardProps = {
  notes: ClientNote[];
  onAddNote: (body: string) => Promise<void>;
  onOpenNotes: () => void;
};

function NoteRow({ note }: { note: ClientNote }) {
  return (
    <div className="flex items-start gap-3 py-2">
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
    </div>
  );
}

export function CoachNotesCard({ notes, onAddNote, onOpenNotes }: CoachNotesCardProps) {
  const [draft, setDraft] = useState("");
  const [isSaving, setIsSaving] = useState(false);
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

  return (
    <OverviewCard animationDelay="0.06s">
      <CardHeader
        title="Coach notes"
        right={<OpenTabLink label="Open Notes" onClick={onOpenNotes} />}
      />

      <div className="px-5 pb-5">
        {visible.length > 0 ? (
          <div className="divide-y divide-[rgba(13,148,136,0.06)]">
            {visible.map((note) => (
              <NoteRow key={note.id} note={note} />
            ))}
          </div>
        ) : (
          <div className="py-3">
            <p className="text-sm text-[#5a7d82]">No notes about this client yet</p>
            <p className="mt-1 text-xs text-[#93b0b4]">
              Add one below so the context travels with them.
            </p>
          </div>
        )}

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
  );
}
