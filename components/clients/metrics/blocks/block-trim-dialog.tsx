"use client";

import { AlertTriangle, Loader2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { formatBlockDate, formatBlockRange } from "@/lib/blocks/block-format";
import type { BlockPlanTrim } from "@/types/client-blocks";

// The one question a block save asks when it draws or shortens a block over
// days that already hold a plan: what will change, before it saves. Saying yes
// re-sends the same save and trims the plans to fit; Cancel leaves the form
// open behind it with nothing saved.
//
// The design system's destructive confirm in its non-delete variant: nothing
// is deleted by the block itself, but the plans it trims can't be put back, so
// AlertTriangle in the danger thumb, a danger-outline CTA repeating the verb,
// and plain sans sentences — one per plan, the plan's name in ink.

const DANGER_CTA =
  "border border-[rgba(192,96,96,0.3)] text-[#c06060] hover:bg-[rgba(192,96,96,0.08)] hover:text-[#c06060]";

/** What the question names: the block, the verb and the trims. */
export interface BlockTrimQuestion {
  kind: "add" | "save";
  blockName: string;
  trims: BlockPlanTrim[];
}

const subject = (text: string) => (
  <span className="font-semibold text-[#0c1a1e]">{text}</span>
);

/** One sentence per plan: track × ends / is removed. */
function describeTrim(trim: BlockPlanTrim): React.ReactNode {
  const range = formatBlockRange(trim.startsOn, trim.endsOn);
  if (trim.track === "training") {
    const name = trim.name ?? "A program";
    return trim.newEndsOn
      ? <>{subject(name)} ends {formatBlockDate(trim.newEndsOn)}. Its sessions after that are removed.</>
      : <>{subject(name)}, {range}, is removed.</>;
  }
  return trim.newEndsOn
    ? <>The nutrition targets running {subject(range)} end {formatBlockDate(trim.newEndsOn)}.</>
    : <>The nutrition targets for {subject(range)} are removed.</>;
}

type BlockTrimDialogProps = {
  open: boolean;
  /** What the card says. It outlives the close: Radix re-renders a closing
   *  card from live props, so the fading card still lists its plans
   *  (CONVENTIONS §7 → "No frame disagrees"). Null only before the first open. */
  question: BlockTrimQuestion | null;
  isSaving: boolean;
  /** Cancel, the X, Escape or a click outside — nothing is saved. */
  onCancel: () => void;
  onConfirm: () => void;
};

export function BlockTrimDialog({
  open,
  question,
  isSaving,
  onCancel,
  onConfirm,
}: BlockTrimDialogProps) {
  const cta = question?.kind === "add" ? "Add block" : "Save block";
  return (
    <Dialog open={open} onOpenChange={(next) => !next && !isSaving && onCancel()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <div className="flex items-center gap-3">
            <div className="grid h-9 w-9 shrink-0 place-items-center rounded-[6px] bg-[rgba(192,96,96,0.08)]">
              <AlertTriangle className="h-4 w-4 text-[#c06060]" strokeWidth={1.5} />
            </div>
            <DialogTitle>
              {`${question?.kind === "add" ? "Add" : "Save"} "${question?.blockName ?? ""}"?`}
            </DialogTitle>
          </div>
        </DialogHeader>
        <div className="space-y-2 text-sm text-[#5a7d82]">
          <p>Saving it changes these plans:</p>
          <ul className="space-y-1.5">
            {question?.trims.map((trim) => (
              <li key={`${trim.track}-${trim.id}`}>{describeTrim(trim)}</li>
            ))}
          </ul>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onCancel} disabled={isSaving}>
            Cancel
          </Button>
          <Button
            variant="outline"
            className={DANGER_CTA}
            disabled={isSaving || !question}
            onClick={onConfirm}
          >
            {isSaving && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
            {cta}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
