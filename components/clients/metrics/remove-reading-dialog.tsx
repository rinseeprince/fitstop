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
import { formatLogDate } from "./metrics-format";
import type { LogRow } from "./metrics-view-types";

type RemoveReadingDialogProps = {
  /** The reading awaiting confirmation; null closes the dialog. */
  row: LogRow | null;
  clientName: string;
  onOpenChange: (open: boolean) => void;
  onConfirm: (row: LogRow) => Promise<void>;
};

/** "91 kg weight" / "18.5% body fat" — the subject of the sentence. */
function readingPhrase(row: LogRow): string {
  const unit = row.unit === "%" ? "%" : ` ${row.unit}`;
  return `${row.value}${unit} ${row.metricName.toLowerCase()}`;
}

/**
 * Removing the reading a figure is built on moves that figure to the next
 * reading; an accidental removal is caught before the click, not after.
 */
function roleSentence(row: LogRow): string | null {
  if (row.isCurrent && row.isBaseline) {
    return "This is the current reading and the reading the since-start figures use.";
  }
  if (row.isCurrent) return "This is the current reading.";
  if (row.isBaseline) return "This is the reading the since-start figures use.";
  return null;
}

/**
 * Destructive confirm for a reading (docs/newdesignsystem.md → Destructive
 * confirm dialog). A removal is a void, never a delete: the sentence names
 * the survivor — the reading stays in the log and can be restored — because
 * that is the part a coach would not assume.
 */
export function RemoveReadingDialog({
  row,
  clientName,
  onOpenChange,
  onConfirm,
}: RemoveReadingDialogProps) {
  const [isRemoving, setIsRemoving] = useState(false);
  const { toast } = useToast();

  const handleConfirm = async () => {
    if (!row) return;
    setIsRemoving(true);
    try {
      await onConfirm(row);
      onOpenChange(false);
      toast({ title: "Reading removed" });
    } catch (error) {
      toast({
        title: "Remove failed",
        description: error instanceof Error ? error.message : "Something went wrong",
        variant: "destructive",
      });
    } finally {
      setIsRemoving(false);
    }
  };

  const role = row ? roleSentence(row) : null;

  return (
    <Dialog open={row !== null} onOpenChange={(open) => !isRemoving && onOpenChange(open)}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <div className="flex items-center gap-3">
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-[6px] bg-[rgba(192,96,96,0.08)]">
              <Trash2 className="h-4 w-4 text-[#c06060]" strokeWidth={1.5} />
            </span>
            <DialogTitle>Remove reading?</DialogTitle>
          </div>
        </DialogHeader>

        {row && (
          <p className="text-sm text-[#5a7d82]">
            Removes the{" "}
            <span className="font-semibold text-[#0c1a1e]">{readingPhrase(row)}</span> reading
            of {formatLogDate(row.date)} from every figure and from {clientName}&rsquo;s app. It
            stays in the log and can be restored.
            {role && ` ${role}`}
          </p>
        )}

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={isRemoving}>
            Cancel
          </Button>
          <Button
            variant="outline"
            onClick={() => void handleConfirm()}
            disabled={isRemoving || !row}
            className="border-[rgba(192,96,96,0.3)] text-[#c06060] hover:bg-[rgba(192,96,96,0.08)] hover:text-[#c06060]"
          >
            {isRemoving && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
            Remove reading
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
