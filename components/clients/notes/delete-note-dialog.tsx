"use client";

import { useState } from "react";
import { Loader2, Trash2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import type { ClientNote } from "@/types/coach-overview";

type DeleteNoteDialogProps = {
  /** The note awaiting confirmation; null closes the dialog. */
  note: ClientNote | null;
  onOpenChange: (open: boolean) => void;
  onConfirm: (noteId: string) => Promise<void>;
};

/**
 * Destructive confirm for a note (docs/newdesignsystem.md → Destructive confirm
 * dialog). Deleting a note is permanent — it is a hard delete — so the sentence
 * says so rather than softening it.
 */
export function DeleteNoteDialog({ note, onOpenChange, onConfirm }: DeleteNoteDialogProps) {
  const [isDeleting, setIsDeleting] = useState(false);
  const { toast } = useToast();

  const handleConfirm = async () => {
    if (!note) return;
    setIsDeleting(true);
    try {
      await onConfirm(note.id);
      onOpenChange(false);
      toast({ title: "Note deleted" });
    } catch (error) {
      toast({
        title: "Delete failed",
        description: error instanceof Error ? error.message : "Something went wrong",
        variant: "destructive",
      });
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <Dialog open={note !== null} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <div className="flex items-center gap-3">
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-[6px] bg-[rgba(192,96,96,0.08)]">
              <Trash2 className="h-4 w-4 text-[#c06060]" strokeWidth={1.5} />
            </span>
            <DialogTitle>Delete note</DialogTitle>
          </div>
        </DialogHeader>

        <p className="text-sm text-[#5a7d82]">
          Removes this note permanently. It is not kept anywhere and cannot be restored.
        </p>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={isDeleting}>
            Cancel
          </Button>
          <Button
            variant="outline"
            onClick={() => void handleConfirm()}
            disabled={isDeleting}
            className="border-[rgba(192,96,96,0.3)] text-[#c06060] hover:bg-[rgba(192,96,96,0.08)] hover:text-[#c06060]"
          >
            {isDeleting && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
            Delete note
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
