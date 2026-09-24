"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { useUnits } from "@/contexts/units-context";
import { useCanonicalInput } from "@/hooks/use-unit-inputs";
import { cn } from "@/lib/utils";
import {
  FOCUS_RING,
  LABEL_CLASS,
  MONO,
  MONO_INPUT_CLASS,
} from "@/components/clients/training/program-builder/builder-tokens";
import { MEASUREMENT_CONVERSION, MEASUREMENT_VALUE_RANGES } from "@/lib/measurements/bounds";
import type { MeasurementKey } from "@/lib/measurements/keys";
import { formatLogDate, SOURCE_LABELS } from "./metrics-format";
import type { LogRow } from "./metrics-view-types";

type EditReadingDialogProps = {
  open: boolean;
  /** The reading the card edits. It outlives the close: Radix re-renders a
   *  closing card from live props, so the fading card keeps its reading
   *  (CONVENTIONS §7 → "No frame disagrees"). Null only before the first open.
   *  The host keys the card by the opening, so the field and the pending flag
   *  start fresh on each open and are never reset by a close. */
  row: LogRow | null;
  onOpenChange: (open: boolean) => void;
  /** The new value, canonical: the hook converted it from the viewer's unit. */
  onConfirm: (row: LogRow, valueCanonical: number) => Promise<void>;
};

/**
 * Edit one reading in place (docs/MEASUREMENT-LOG-PLAN.md commit 8): one field
 * in the viewer's unit, seeded from the CANONICAL value so an untouched field
 * writes nothing (`useCanonicalInput`'s pristine guard), and refused while it
 * is untouched — an edit that changes nothing is not an edit.
 */
export function EditReadingDialog({ open, row, onOpenChange, onConfirm }: EditReadingDialogProps) {
  const { preference } = useUnits();
  const [isSaving, setIsSaving] = useState(false);

  const conversion = row
    ? (MEASUREMENT_CONVERSION[row.metricId as MeasurementKey] ?? null)
    : null;
  // One input path for every metric: a unit-bearing reading collects in the
  // viewer's unit; a unitless one (body fat) takes the hook's identity path
  // by being shown to a "metric" viewer, which converts nothing.
  const input = useCanonicalInput(
    conversion ? preference : "metric",
    row?.canonicalValue ?? null,
    conversion ?? "weight"
  );

  const range = row ? MEASUREMENT_VALUE_RANGES[row.metricId as MeasurementKey] : null;
  const commit = input.commit;
  // Bounds describe STORAGE (CONVENTIONS §20): judged on the canonical commit.
  const inRange = commit != null && range != null && commit >= range.min && commit <= range.max;
  const showRangeError =
    !input.isPristine && input.value.trim() !== "" && !input.hasParseError && !inRange;
  const canSubmit =
    row !== null && !input.isPristine && !input.hasParseError && inRange && !isSaving;

  const handleSubmit = async () => {
    if (!row || commit == null || !canSubmit) return;
    setIsSaving(true);
    try {
      await onConfirm(row, commit);
      // A success closes with the flag still set, so the closing card keeps its
      // spinner; the host keys the card by the opening, so the next open mounts
      // it fresh.
      onOpenChange(false);
      toast.success(`${row.metricName} corrected`, {
        // Echoed in what the coach typed, not what was stored.
        description: `Now ${input.value.trim()} ${row.unit} for ${formatLogDate(row.date)}.`,
      });
    } catch (error) {
      toast.error("Correction failed", {
        description: error instanceof Error ? error.message : "Something went wrong",
      });
      setIsSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !isSaving && onOpenChange(next)}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Edit reading</DialogTitle>
          <DialogDescription>
            The new value replaces this reading everywhere it is used.
          </DialogDescription>
        </DialogHeader>

        {row && (
          <div className="space-y-4 py-1">
            <p className="text-[11px] text-[#93b0b4]">
              {row.metricName}
              <span className="mx-1">·</span>
              <span className={cn(MONO, "tabular-nums")}>{formatLogDate(row.date)}</span>
              <span className="mx-1">·</span>
              {SOURCE_LABELS[row.source]}
            </p>
            <div className="space-y-1.5">
              <Label htmlFor="edit-reading-value">Value</Label>
              <div className="relative">
                <Input
                  id="edit-reading-value"
                  inputMode="decimal"
                  value={input.value}
                  onChange={(e) => input.setValue(e.target.value)}
                  className={cn(MONO_INPUT_CLASS, FOCUS_RING, "h-8 pr-9 text-[13px]")}
                />
                <span
                  className={cn(
                    "pointer-events-none absolute inset-y-0 right-2.5 flex items-center",
                    LABEL_CLASS
                  )}
                >
                  {row.unit}
                </span>
              </div>
              {input.hasParseError && (
                <p className="text-[11px] text-[#c06060]">Enter a number.</p>
              )}
              {showRangeError && (
                <p className="text-[11px] text-[#c06060]">
                  Out of range for {row.metricName.toLowerCase()}.
                </p>
              )}
            </div>
          </div>
        )}

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={isSaving}>
            Cancel
          </Button>
          <Button
            className="bg-[#0d9488] text-white hover:bg-[#0b7f75]"
            onClick={() => void handleSubmit()}
            disabled={!canSubmit}
          >
            {isSaving && <Loader2 className="h-4 w-4 animate-spin mr-1.5" />}
            Save reading
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
