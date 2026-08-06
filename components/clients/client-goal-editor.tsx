"use client";

import { useState, useEffect } from "react";
import useSWR from "swr";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2, Pencil } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { swrFetcher } from "@/lib/swr-fetcher";
import { getTodayDateString } from "@/lib/date-helpers";
import { SECTION_LABEL_CLASS } from "@/components/clients/training/program-builder/builder-tokens";
import type { ClientGoal } from "@/types/client-goals";
import { useUnits } from "@/contexts/units-context";
import { formatWeight, parseWeightToKg } from "@/utils/unit-conversions";

const round1 = (n: number): number => Math.round(n * 10) / 10;

// Coach editor for the client's long-term goal (Session 7.8). Drives the existing
// PUT /api/clients/[id]/goals (previously orphaned — no UI consumer). Shows a
// read-only "Goal: X by Y" summary + an Edit dialog; SWR keeps the summary live
// after a save.
//
// client_goals.goal_weight is canonical KILOGRAMS (migration 141). The comment
// here used to say it was stored in the client's display unit, which predates
// that migration and was load-bearing: it justified sending the typed number
// straight through. Display converts to the viewer's unit and submit converts
// back, so the round trip holds.

type GoalsResponse = { success: boolean; data: ClientGoal | null };

const SWR_OPTS = {
  revalidateOnFocus: false,
  errorRetryCount: 3,
  errorRetryInterval: 1000,
};

type ClientGoalEditorProps = {
  clientId: string;
  /**
   * Fired after a successful goal save, IN ADDITION to this component's own
   * SWR revalidation.
   *
   * That local `mutate()` only refreshes `/api/clients/{id}/goals`. Anything
   * else on screen that was derived from the goal stays stale — and this editor
   * is mounted inside the nutrition drawer, where the live calorie preview and
   * the goal-drift banner are both computed from server-resolved inputs that
   * the goal has just invalidated. Without this callback the drawer would
   * preview one plan and save another.
   */
  onSaved?: () => void;
};

export function ClientGoalEditor({ clientId, onSaved }: ClientGoalEditorProps) {
  const { preference } = useUnits();
  const [open, setOpen] = useState(false);
  const { data, mutate } = useSWR<GoalsResponse>(
    `/api/clients/${clientId}/goals`,
    swrFetcher,
    SWR_OPTS
  );
  const goal = data?.data ?? null;

  const shown = goal?.goalWeight != null ? formatWeight(goal.goalWeight, preference) : null;
  const summary =
    shown != null
      ? `${round1(shown.value)} ${shown.unit}${goal?.goalDeadline ? ` by ${goal.goalDeadline}` : ""}`
      : "No goal set yet";

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <label className={SECTION_LABEL_CLASS}>
          Goal
        </label>
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="inline-flex items-center gap-1 text-[11px] font-medium text-[#0d9488] hover:underline"
        >
          <Pencil className="w-3 h-3" />
          Edit
        </button>
      </div>
      <p className="text-[13px] font-medium text-[#0c1a1e]">{summary}</p>
      <p className="text-[11px] text-[#93b0b4] leading-[1.4]">
        The long-term goal &amp; deadline drive nutrition pace.
      </p>
      <GoalEditDialog
        clientId={clientId}
        goal={goal}
        open={open}
        onOpenChange={setOpen}
        onSaved={() => {
          void mutate();
          onSaved?.();
        }}
      />
    </div>
  );
}

type GoalEditDialogProps = {
  clientId: string;
  goal: ClientGoal | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
};

function GoalEditDialog({
  clientId,
  goal,
  open,
  onOpenChange,
  onSaved,
}: GoalEditDialogProps) {
  const { toast } = useToast();
  const { preference } = useUnits();
  const unit = formatWeight(0, preference).unit;
  const [goalWeight, setGoalWeight] = useState("");
  const [bodyFat, setBodyFat] = useState("");
  const [deadline, setDeadline] = useState("");
  const [startDate, setStartDate] = useState("");
  const [submitting, setSubmitting] = useState(false);

  // Sync fields when the dialog opens (or the underlying goal changes).
  useEffect(() => {
    if (!open) return;
    // Seeded in the viewer's unit; handleSubmit converts back.
    setGoalWeight(
      goal?.goalWeight != null
        ? String(round1(formatWeight(goal.goalWeight, preference).value))
        : "",
    );
    setBodyFat(
      goal?.goalBodyFatPercentage != null ? String(goal.goalBodyFatPercentage) : ""
    );
    setDeadline(goal?.goalDeadline ?? "");
    setStartDate(goal?.goalStartDate ?? "");
  }, [goal, open, preference]);

  const handleSubmit = async () => {
    const weight = parseFloat(goalWeight);
    if (!goalWeight.trim() || isNaN(weight)) {
      toast({ title: "Goal weight is required", variant: "destructive" });
      return;
    }
    setSubmitting(true);
    try {
      // Presence-based merge server-side: explicit null clears the optional fields.
      // The seeded string is rounded for legibility, so re-parsing an UNTOUCHED
      // field would store a slightly different kilogram value than the one it
      // was seeded from. Same drift the builder's load inputs guard against.
      const seeded =
        goal?.goalWeight != null
          ? String(round1(formatWeight(goal.goalWeight, preference).value))
          : "";
      const goalWeightKg =
        goalWeight.trim() === seeded && goal?.goalWeight != null
          ? goal.goalWeight
          : parseWeightToKg(weight, preference);

      const body: Record<string, string | number | null> = {
        goalWeight: goalWeightKg,
        goalBodyFatPercentage: bodyFat.trim() ? parseFloat(bodyFat) : null,
        goalDeadline: deadline || null,
        goalStartDate: startDate || null,
      };
      const res = await fetch(`/api/clients/${clientId}/goals`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const d = await res.json();
        throw new Error(
          d.error || d.details?.[0]?.message || "Failed to update goal"
        );
      }
      toast({ title: "Goal updated" });
      onSaved();
      onOpenChange(false);
    } catch (error) {
      toast({
        title: "Error",
        description:
          error instanceof Error ? error.message : "Failed to update goal",
        variant: "destructive",
      });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>Edit goal</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-2">
            <Label htmlFor="goal-weight">Goal weight ({unit})</Label>
            <Input
              id="goal-weight"
              type="number"
              inputMode="decimal"
              value={goalWeight}
              onChange={(e) => setGoalWeight(e.target.value)}
              placeholder={`Target weight in ${unit}`}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="goal-bodyfat">Goal body fat % (optional)</Label>
            <Input
              id="goal-bodyfat"
              type="number"
              inputMode="decimal"
              value={bodyFat}
              onChange={(e) => setBodyFat(e.target.value)}
              placeholder="Optional"
            />
          </div>
          <div className="flex gap-3">
            <div className="flex-1 space-y-2">
              <Label htmlFor="goal-start">Start date (optional)</Label>
              <Input
                id="goal-start"
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
              />
            </div>
            <div className="flex-1 space-y-2">
              <Label htmlFor="goal-deadline">Deadline (optional)</Label>
              <Input
                id="goal-deadline"
                type="date"
                min={getTodayDateString()}
                value={deadline}
                onChange={(e) => setDeadline(e.target.value)}
              />
            </div>
          </div>
          <p className="text-xs text-muted-foreground">
            Clear the deadline to remove the target date.
          </p>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={submitting}>
            {submitting && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
