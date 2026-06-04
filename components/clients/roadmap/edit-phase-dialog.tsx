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
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Loader2, AlertCircle } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { weightToKg, weightFromKg } from "@/utils/nutrition-helpers";
import type { Phase, Milestone } from "@/types/roadmap";
import { PhaseGoalFields } from "./phase-goal-fields";
import { MilestoneInputList } from "./milestone-input-list";

type EditPhaseDialogProps = {
  phase: Phase;
  clientId: string;
  weightUnit: "lbs" | "kg";
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess: () => void;
};

export const EditPhaseDialog = ({
  phase,
  clientId,
  weightUnit,
  open,
  onOpenChange,
  onSuccess,
}: EditPhaseDialogProps) => {
  const { toast } = useToast();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [objectives, setObjectives] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [phaseGoalWeight, setPhaseGoalWeight] = useState("");
  const [phaseGoalBodyFatPercentage, setPhaseGoalBodyFatPercentage] = useState("");
  const [milestones, setMilestones] = useState<Milestone[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const goalsDisabled = !["planned", "active"].includes(phase.status);

  // Show a warning when a goal is being changed on an ACTIVE phase, since the
  // nutrition plan is not auto-recalculated. Compare against the values the form
  // was initialized to (derived the same way as the open effect below).
  const initialGoalWeight =
    phase.phaseGoalWeight != null
      ? weightFromKg(phase.phaseGoalWeight, weightUnit).toFixed(1)
      : "";
  const initialGoalBodyFat =
    phase.phaseGoalBodyFatPercentage != null
      ? phase.phaseGoalBodyFatPercentage.toString()
      : "";
  const goalsChanged =
    phaseGoalWeight !== initialGoalWeight ||
    phaseGoalBodyFatPercentage !== initialGoalBodyFat;
  const showActiveGoalWarning = phase.status === "active" && goalsChanged;

  // Sync form fields when the dialog opens or a different phase is passed
  useEffect(() => {
    if (!open) return;
    setName(phase.name);
    setDescription(phase.description || "");
    setObjectives(phase.objectives || "");
    setStartDate(phase.startDate || "");
    setEndDate(phase.endDate || "");
    setPhaseGoalWeight(
      phase.phaseGoalWeight != null
        ? weightFromKg(phase.phaseGoalWeight, weightUnit).toFixed(1)
        : ""
    );
    setPhaseGoalBodyFatPercentage(
      phase.phaseGoalBodyFatPercentage != null
        ? phase.phaseGoalBodyFatPercentage.toString()
        : ""
    );
    setMilestones(phase.milestones ?? []);
  }, [phase.id, open]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleSubmit = async () => {
    if (!name.trim()) return;

    setIsSubmitting(true);
    try {
      const body: Record<string, string | number | null | Milestone[]> = { name: name.trim() };
      body.description = description.trim() || null;
      body.objectives = objectives.trim() || null;
      body.startDate = startDate || null;
      body.endDate = endDate || null;

      body.milestones = milestones;

      if (!goalsDisabled) {
        body.phaseGoalWeight = phaseGoalWeight.trim()
          ? weightToKg(parseFloat(phaseGoalWeight), weightUnit)
          : null;
        body.phaseGoalBodyFatPercentage = phaseGoalBodyFatPercentage.trim()
          ? parseFloat(phaseGoalBodyFatPercentage)
          : null;
      }

      const res = await fetch(
        `/api/clients/${clientId}/roadmap/phases/${phase.id}`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }
      );

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to update phase");
      }

      toast({ title: "Phase updated" });
      onSuccess();
      onOpenChange(false);
    } catch (error) {
      toast({
        title: "Error",
        description:
          error instanceof Error ? error.message : "Failed to update phase",
        variant: "destructive",
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>Edit Phase</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <Label htmlFor="edit-phase-name">Name</Label>
            <Input
              id="edit-phase-name"
              placeholder="e.g., Hypertrophy Block"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="edit-phase-description">Description (optional)</Label>
            <Textarea
              id="edit-phase-description"
              placeholder="What is the focus of this phase?"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="edit-phase-objectives">Objectives (optional)</Label>
            <Textarea
              id="edit-phase-objectives"
              placeholder="Key objectives for this phase"
              value={objectives}
              onChange={(e) => setObjectives(e.target.value)}
              rows={2}
            />
          </div>

          <div className="flex gap-3">
            <div className="flex-1 space-y-2">
              <Label htmlFor="edit-phase-start">Start Date</Label>
              <Input
                id="edit-phase-start"
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
              />
            </div>
            <div className="flex-1 space-y-2">
              <Label htmlFor="edit-phase-end">End Date</Label>
              <Input
                id="edit-phase-end"
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
              />
            </div>
          </div>

          <MilestoneInputList milestones={milestones} onChange={setMilestones} />

          <PhaseGoalFields
            weightUnit={weightUnit}
            phaseGoalWeight={phaseGoalWeight}
            onWeightChange={setPhaseGoalWeight}
            phaseGoalBodyFatPercentage={phaseGoalBodyFatPercentage}
            onBodyFatChange={setPhaseGoalBodyFatPercentage}
            disabled={goalsDisabled}
            idPrefix="edit-phase"
          />

          {showActiveGoalWarning && (
            <div className="flex items-start gap-2 p-3 bg-amber-50 dark:bg-amber-950/30 rounded-lg">
              <AlertCircle className="h-4 w-4 text-amber-600 mt-0.5 flex-shrink-0" />
              <p className="text-xs text-foreground">
                This phase is active — changing its goal won&apos;t automatically
                recalculate the nutrition plan. Regenerate it manually if needed.
              </p>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={isSubmitting}
          >
            Cancel
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={!name.trim() || isSubmitting}
          >
            {isSubmitting && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
            Save Changes
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
