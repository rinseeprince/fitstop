"use client";

import { useState } from "react";
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
import { weightToKg } from "@/utils/nutrition-helpers";
import { PhaseGoalFields } from "./phase-goal-fields";
import { MilestoneInputList } from "./milestone-input-list";
import type { Milestone } from "@/types/roadmap";

type AddPhaseDialogProps = {
  clientId: string;
  weightUnit: "lbs" | "kg";
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess: () => void;
};

export const AddPhaseDialog = ({
  clientId,
  weightUnit,
  open,
  onOpenChange,
  onSuccess,
}: AddPhaseDialogProps) => {
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

  const handleSubmit = async () => {
    if (!name.trim()) return;

    setIsSubmitting(true);
    try {
      const body: Record<string, string | number | Milestone[]> = { name: name.trim() };
      if (description.trim()) body.description = description.trim();
      if (objectives.trim()) body.objectives = objectives.trim();
      if (startDate) body.startDate = startDate;
      if (endDate) body.endDate = endDate;
      if (phaseGoalWeight.trim()) {
        body.phaseGoalWeight = weightToKg(parseFloat(phaseGoalWeight), weightUnit);
      }
      if (phaseGoalBodyFatPercentage.trim()) {
        body.phaseGoalBodyFatPercentage = parseFloat(phaseGoalBodyFatPercentage);
      }
      if (milestones.length > 0) body.milestones = milestones;

      const res = await fetch(`/api/clients/${clientId}/roadmap/phases`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to add phase");
      }

      toast({ title: "Phase added" });

      // Reset form
      setName("");
      setDescription("");
      setObjectives("");
      setStartDate("");
      setEndDate("");
      setPhaseGoalWeight("");
      setPhaseGoalBodyFatPercentage("");
      setMilestones([]);

      onSuccess();
      onOpenChange(false);
    } catch (error) {
      toast({
        title: "Error",
        description:
          error instanceof Error ? error.message : "Failed to add phase",
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
          <DialogTitle>Add Phase</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <Label htmlFor="phase-name">Name</Label>
            <Input
              id="phase-name"
              placeholder="e.g., Hypertrophy Block"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="phase-description">Description (optional)</Label>
            <Textarea
              id="phase-description"
              placeholder="What is the focus of this phase?"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="phase-objectives">Objectives (optional)</Label>
            <Textarea
              id="phase-objectives"
              placeholder="Key objectives for this phase"
              value={objectives}
              onChange={(e) => setObjectives(e.target.value)}
              rows={2}
            />
          </div>

          <div className="flex gap-3">
            <div className="flex-1 space-y-2">
              <Label htmlFor="phase-start">Start Date</Label>
              <Input
                id="phase-start"
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
              />
            </div>
            <div className="flex-1 space-y-2">
              <Label htmlFor="phase-end">End Date</Label>
              <Input
                id="phase-end"
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
          />
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
            Add Phase
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
