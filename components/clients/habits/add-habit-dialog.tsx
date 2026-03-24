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
import { Switch } from "@/components/ui/switch";
import type { DailyHabitInput } from "@/types/daily-habit";
import { PhaseSelector } from "../shared/phase-selector";

type AddHabitDialogProps = {
  clientId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (data: DailyHabitInput) => Promise<void>;
};

export const AddHabitDialog = ({
  clientId,
  open,
  onOpenChange,
  onSubmit,
}: AddHabitDialogProps) => {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [isNumeric, setIsNumeric] = useState(false);
  const [targetValue, setTargetValue] = useState("");
  const [targetUnit, setTargetUnit] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [phaseId, setPhaseId] = useState<string | undefined>(undefined);
  const [phaseBlocked, setPhaseBlocked] = useState(false);

  const handleSubmit = async () => {
    if (!name.trim()) return;

    setIsSubmitting(true);
    try {
      const data: DailyHabitInput = {
        name: name.trim(),
        description: description.trim() || undefined,
        isBoolean: !isNumeric,
        targetValue: isNumeric && targetValue ? parseFloat(targetValue) : undefined,
        targetUnit: isNumeric && targetUnit.trim() ? targetUnit.trim() : undefined,
        phaseId: phaseId || undefined,
      };

      await onSubmit(data);

      // Reset form
      setName("");
      setDescription("");
      setIsNumeric(false);
      setTargetValue("");
      setTargetUnit("");
      setPhaseId(undefined);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>Add New Habit</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-4">
          {/* Name */}
          <div className="space-y-2">
            <Label htmlFor="name">Name</Label>
            <Input
              id="name"
              placeholder="e.g., Drink 3 litres of water, Walk 10,000 steps, Take creatine"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>

          {/* Description */}
          <div className="space-y-2">
            <Label htmlFor="description">Description (optional)</Label>
            <Textarea
              id="description"
              placeholder="Add any additional notes or instructions"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
            />
          </div>

          {/* Track a number toggle */}
          <div className="flex items-center justify-between">
            <Label htmlFor="numeric">Track a number</Label>
            <Switch
              id="numeric"
              checked={isNumeric}
              onCheckedChange={setIsNumeric}
            />
          </div>

          {/* Target value and unit (shown when numeric) */}
          {isNumeric && (
            <div className="flex gap-3">
              <div className="flex-1 space-y-2">
                <Label htmlFor="target">Target Value</Label>
                <Input
                  id="target"
                  type="number"
                  placeholder="e.g., 3"
                  value={targetValue}
                  onChange={(e) => setTargetValue(e.target.value)}
                />
              </div>
              <div className="flex-1 space-y-2">
                <Label htmlFor="unit">Unit</Label>
                <Input
                  id="unit"
                  placeholder="e.g., litres"
                  value={targetUnit}
                  onChange={(e) => setTargetUnit(e.target.value)}
                />
              </div>
            </div>
          )}

          {/* Phase Selector */}
          <PhaseSelector
            clientId={clientId}
            value={phaseId}
            onChange={setPhaseId}
            onBlockSubmit={setPhaseBlocked}
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
            disabled={!name.trim() || isSubmitting || phaseBlocked}
          >
            Add Habit
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};