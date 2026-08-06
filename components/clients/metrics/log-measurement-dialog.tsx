"use client";

import { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Loader2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import {
  FOCUS_RING,
  LABEL_CLASS,
  MONO_INPUT_CLASS,
  SECTION_LABEL_CLASS,
} from "@/components/clients/training/program-builder/builder-tokens";
import {
  METRIC_ENTRY_CONVERSION,
  METRIC_VALUE_RANGES,
  type MetricEntryKey,
} from "@/lib/metrics/metric-entry-definitions";
import { useUnits } from "@/contexts/units-context";
import { parseLengthToCm, parseWeightToKg } from "@/utils/unit-conversions";
import { getTodayDateString } from "@/lib/date-helpers";
import type { CreateMetricEntryRequest } from "@/types/metric-entries";
import { formatShortDate } from "./metrics-format";
import type { MetricSummary } from "./metrics-view-types";

type LogMeasurementDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  metrics: MetricSummary[];
  /** Focused metric — seeds the select each time the dialog opens. */
  initialMetricId: string;
  onSubmit: (input: CreateMetricEntryRequest) => Promise<void>;
};

// Select recipes copied from the (to-be-deleted) time-scope-selector.tsx —
// same trigger/item conventions, minus its toolbar-scoped w-[220px] (dialog
// fields run full width via the base SelectTrigger).
const TRIGGER_CLASS =
  "bg-white border border-[rgba(13,148,136,0.08)] rounded-[6px] text-[13px] font-medium text-[#0c1a1e] focus:border-[rgba(13,148,136,0.25)] focus:shadow-[0_0_0_3px_rgba(13,148,136,0.06)] focus:ring-0 transition-all hover:border-[rgba(13,148,136,0.25)] [&>svg]:text-[#93b0b4] [&>svg]:hover:text-[#0d9488] [&>svg]:transition-colors";

const ITEM_CLASS =
  "rounded-[6px] cursor-pointer text-[13px] text-[#0c1a1e] focus:bg-[rgba(13,148,136,0.05)]";

/** "7/10" and "18%" attach; word units ("kg", "in") get a space. */
function proseValue(value: number, unit: string): string {
  if (!unit) return String(value);
  if (unit.startsWith("/") || unit === "%") return `${value}${unit}`;
  return `${value} ${unit}`;
}

export function LogMeasurementDialog({
  open,
  onOpenChange,
  metrics,
  initialMetricId,
  onSubmit,
}: LogMeasurementDialogProps) {
  const { toast } = useToast();
  const { preference } = useUnits();
  const [metricId, setMetricId] = useState(initialMetricId);
  const [value, setValue] = useState("");
  const [date, setDate] = useState(getTodayDateString());
  const [note, setNote] = useState("");
  const [valueTouched, setValueTouched] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Always-mounted dialog: each open resets the form and re-seeds the metric
  // from the page's focused metric (both open paths preselect).
  useEffect(() => {
    if (!open) return;
    setMetricId(initialMetricId);
    setValue("");
    setDate(getTodayDateString());
    setNote("");
    setValueTouched(false);
  }, [open, initialMetricId]);

  const today = getTodayDateString();
  const selected = metrics.find((m) => m.id === metricId) ?? null;
  const bodyMetrics = metrics.filter((m) => m.tab === "body");
  const wellnessMetrics = metrics.filter((m) => m.tab === "wellness");

  const range = selected
    ? METRIC_VALUE_RANGES[selected.id as MetricEntryKey]
    : undefined;
  const parsed = Number(value);
  const hasValue = value.trim() !== "";
  const showParseError = valueTouched && hasValue && !Number.isFinite(parsed);

  // The coach types in THEIR unit (the suffix beside the box is
  // `def.getUnit(preference)`); storage is canonical kg/cm. Converting here
  // rather than at submit means the range check below judges the number that
  // will actually be stored — METRIC_VALUE_RANGES is kilograms and
  // centimetres, so validating the typed string would compare 180 lbs against
  // a 20-250 kg bound and wave it through.
  const conversion = selected
    ? METRIC_ENTRY_CONVERSION[selected.id as MetricEntryKey]
    : null;
  const canonical = !Number.isFinite(parsed)
    ? parsed
    : conversion === "weight"
      ? parseWeightToKg(parsed, preference)
      : conversion === "length"
        ? parseLengthToCm(parsed, preference)
        : parsed;

  const valueValid =
    hasValue &&
    Number.isFinite(canonical) &&
    canonical > 0 &&
    range !== undefined &&
    canonical >= range.min &&
    canonical <= range.max &&
    // Integer-ness is a property of the SCALE, so it is judged on what the
    // coach typed — a 1-10 wellness score never converts, and asking whether a
    // converted kilogram value is a whole number would be meaningless.
    (!range.integer || Number.isInteger(parsed));
  const canSubmit =
    selected !== null && valueValid && date !== "" && date <= today && !isSubmitting;

  const handleSubmit = async () => {
    if (!selected || !canSubmit) return;
    setIsSubmitting(true);
    try {
      const trimmedNote = note.trim();
      await onSubmit({
        metricKey: selected.id as MetricEntryKey,
        // Canonical kg/cm on the wire; the coach typed their own unit.
        value: canonical,
        entryDate: date,
        note: trimmedNote || undefined,
      });
      onOpenChange(false);
      toast({
        // Echoed back in what the coach typed, not what was stored — the
        // confirmation is about their action, not about the column.
        title: `${selected.name} logged`,
        description: `Recorded ${proseValue(parsed, selected.unit)} for ${formatShortDate(date)}.`,
      });
    } catch (error) {
      toast({
        title: "Log failed",
        description:
          error instanceof Error ? error.message : "Something went wrong",
        variant: "destructive",
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Log measurement</DialogTitle>
          <DialogDescription>
            Logging a date that already has an entry for this metric replaces
            it.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-1">
          <div className="space-y-1.5">
            <Label htmlFor="log-metric">Metric</Label>
            <Select value={metricId} onValueChange={setMetricId}>
              <SelectTrigger id="log-metric" className={TRIGGER_CLASS}>
                <SelectValue placeholder="Select a metric" />
              </SelectTrigger>
              <SelectContent className="bg-white rounded-[6px] shadow-lg border border-[rgba(13,148,136,0.08)] p-1">
                <SelectGroup>
                  <SelectLabel className={SECTION_LABEL_CLASS}>
                    Physique
                  </SelectLabel>
                  {bodyMetrics.map((m) => (
                    <SelectItem key={m.id} value={m.id} className={ITEM_CLASS}>
                      {m.name}
                    </SelectItem>
                  ))}
                </SelectGroup>
                <SelectGroup>
                  <SelectLabel className={SECTION_LABEL_CLASS}>
                    Wellness
                  </SelectLabel>
                  {wellnessMetrics.map((m) => (
                    <SelectItem key={m.id} value={m.id} className={ITEM_CLASS}>
                      {m.name}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="log-value">Value</Label>
            <div className="relative">
              <Input
                id="log-value"
                inputMode="decimal"
                value={value}
                onChange={(e) => setValue(e.target.value)}
                onBlur={() => setValueTouched(true)}
                className={cn(MONO_INPUT_CLASS, FOCUS_RING, "h-8 pr-9 text-[13px]")}
              />
              <span
                className={cn(
                  "pointer-events-none absolute inset-y-0 right-2.5 flex items-center",
                  LABEL_CLASS
                )}
              >
                {selected?.unit ?? ""}
              </span>
            </div>
            {showParseError && (
              <p className="text-[11px] text-[#c06060]">Enter a number.</p>
            )}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="log-date">Date</Label>
            <Input
              id="log-date"
              type="date"
              value={date}
              max={today}
              onChange={(e) => setDate(e.target.value)}
              className={FOCUS_RING}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="log-note">Note</Label>
            <Textarea
              id="log-note"
              rows={2}
              maxLength={500}
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
            <p className="text-[11px] text-[#93b0b4]">
              Optional · shown to the client
            </p>
          </div>
        </div>

        <DialogFooter>
          <Button
            variant="ghost"
            onClick={() => onOpenChange(false)}
            disabled={isSubmitting}
          >
            Cancel
          </Button>
          <Button
            className="bg-[#0d9488] text-white hover:bg-[#0b7f75]"
            onClick={handleSubmit}
            disabled={!canSubmit}
          >
            {isSubmitting && <Loader2 className="h-4 w-4 animate-spin mr-1.5" />}
            Log entry
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
