"use client";

import { useState, useEffect } from "react";
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
import { useClientGoals, useInvalidateClientGoals } from "@/hooks/use-client-goals";
import { getTodayDateString } from "@/lib/date-helpers";
import { SECTION_LABEL_CLASS } from "@/components/clients/training/program-builder/builder-tokens";
import type { ClientGoal } from "@/types/client-goals";

// Coach editor for the client's long-term goal (Session 7.8). Drives the existing
// PUT /api/clients/[id]/goals (previously orphaned — no UI consumer). Weight is
// stored in the client's display unit (client_goals.goal_weight), so no kg
// conversion here. Shows a read-only "Goal: X by Y" summary + an Edit dialog;
// SWR keeps the summary live after a save.

type ClientGoalEditorProps = {
  clientId: string;
  unit: "lbs" | "kg";
};

export function ClientGoalEditor({ clientId, unit }: ClientGoalEditorProps) {
  const [open, setOpen] = useState(false);
  const { goal } = useClientGoals(clientId);
  // A save here has to reach the coach Overview's goal chips, which read the
  // same area from a different component. This hook's own `mutate` reaches only
  // this one (CONVENTIONS §7).
  const invalidateGoals = useInvalidateClientGoals();

  const summary =
    goal?.goalWeight != null
      ? `${goal.goalWeight} ${unit}${goal.goalDeadline ? ` by ${goal.goalDeadline}` : ""}`
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
        unit={unit}
        goal={goal}
        open={open}
        onOpenChange={setOpen}
        onSaved={() => void invalidateGoals(clientId)}
      />
    </div>
  );
}

type GoalEditDialogProps = {
  clientId: string;
  unit: "lbs" | "kg";
  goal: ClientGoal | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
};

function GoalEditDialog({
  clientId,
  unit,
  goal,
  open,
  onOpenChange,
  onSaved,
}: GoalEditDialogProps) {
  const { toast } = useToast();
  const [goalWeight, setGoalWeight] = useState("");
  const [bodyFat, setBodyFat] = useState("");
  const [deadline, setDeadline] = useState("");
  const [startDate, setStartDate] = useState("");
  const [submitting, setSubmitting] = useState(false);

  // Sync fields when the dialog opens (or the underlying goal changes).
  useEffect(() => {
    if (!open) return;
    setGoalWeight(goal?.goalWeight != null ? String(goal.goalWeight) : "");
    setBodyFat(
      goal?.goalBodyFatPercentage != null ? String(goal.goalBodyFatPercentage) : ""
    );
    setDeadline(goal?.goalDeadline ?? "");
    setStartDate(goal?.goalStartDate ?? "");
  }, [goal, open]);

  const handleSubmit = async () => {
    const weight = parseFloat(goalWeight);
    if (!goalWeight.trim() || isNaN(weight)) {
      toast({ title: "Goal weight is required", variant: "destructive" });
      return;
    }
    setSubmitting(true);
    try {
      // Presence-based merge server-side: explicit null clears the optional fields.
      const body: Record<string, string | number | null> = {
        goalWeight: weight,
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
