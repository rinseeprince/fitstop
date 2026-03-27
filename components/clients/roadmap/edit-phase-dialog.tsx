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
import { Loader2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { weightToKg, weightFromKg } from "@/utils/nutrition-helpers";
import type { Phase } from "@/types/roadmap";

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
  const [isSubmitting, setIsSubmitting] = useState(false);

  const goalsDisabled = phase.status !== "planned";

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
  }, [phase.id, open]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleSubmit = async () => {
    if (!name.trim()) return;

    setIsSubmitting(true);
    try {
      const body: Record<string, string | number | null> = { name: name.trim() };
      body.description = description.trim() || null;
      body.objectives = objectives.trim() || null;
      body.startDate = startDate || null;
      body.endDate = endDate || null;

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

          <div className="space-y-2">
            <Label className="text-sm font-medium">Phase Goals (optional)</Label>
            {goalsDisabled ? (
              <p className="text-xs text-muted-foreground">
                Goals cannot be changed after a phase has started
              </p>
            ) : (
              <p className="text-xs text-muted-foreground">
                Leave blank to use the client&apos;s overall goal
              </p>
            )}
            <div className="flex gap-3">
              <div className="flex-1 space-y-1">
                <Label htmlFor="edit-phase-goal-weight" className="text-xs">
                  Goal Weight ({weightUnit})
                </Label>
                <Input
                  id="edit-phase-goal-weight"
                  type="number"
                  step="0.1"
                  min="0"
                  placeholder={weightUnit === "lbs" ? "e.g., 165" : "e.g., 75"}
                  value={phaseGoalWeight}
                  onChange={(e) => setPhaseGoalWeight(e.target.value)}
                  disabled={goalsDisabled}
                />
              </div>
              <div className="flex-1 space-y-1">
                <Label htmlFor="edit-phase-goal-bf" className="text-xs">
                  Goal Body Fat (%)
                </Label>
                <Input
                  id="edit-phase-goal-bf"
                  type="number"
                  step="0.1"
                  min="0"
                  max="60"
                  placeholder="e.g., 15"
                  value={phaseGoalBodyFatPercentage}
                  onChange={(e) => setPhaseGoalBodyFatPercentage(e.target.value)}
                  disabled={goalsDisabled}
                />
              </div>
            </div>
          </div>
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
