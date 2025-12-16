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
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { useToast } from "@/hooks/use-toast";
import { Loader2 } from "lucide-react";

type AddExerciseDialogProps = {
  clientId: string;
  planId: string;
  sessionId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess: () => void;
};

export function AddExerciseDialog({
  clientId,
  planId,
  sessionId,
  open,
  onOpenChange,
  onSuccess,
}: AddExerciseDialogProps) {
  const { toast } = useToast();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [formData, setFormData] = useState({
    name: "",
    sets: "3",
    repsMin: "8",
    repsMax: "12",
    rpeTarget: "",
    restSeconds: "90",
    notes: "",
    isWarmup: false,
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!formData.name.trim()) {
      toast({
        title: "Exercise name required",
        variant: "destructive",
      });
      return;
    }

    setIsSubmitting(true);
    try {
      const res = await fetch(
        `/api/clients/${clientId}/training/${planId}/sessions/${sessionId}/exercises`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: formData.name,
            sets: parseInt(formData.sets) || 3,
            repsMin: formData.repsMin ? parseInt(formData.repsMin) : undefined,
            repsMax: formData.repsMax ? parseInt(formData.repsMax) : undefined,
            rpeTarget: formData.rpeTarget ? parseFloat(formData.rpeTarget) : undefined,
            restSeconds: formData.restSeconds ? parseInt(formData.restSeconds) : undefined,
            notes: formData.notes || undefined,
            isWarmup: formData.isWarmup,
          }),
        }
      );

      if (!res.ok) throw new Error("Failed to add exercise");

      toast({ title: "Exercise added" });
      setFormData({
        name: "",
        sets: "3",
        repsMin: "8",
        repsMax: "12",
        rpeTarget: "",
        restSeconds: "90",
        notes: "",
        isWarmup: false,
      });
      onOpenChange(false);
      onSuccess();
    } catch (error) {
      toast({
        title: "Error",
        description: "Failed to add exercise",
        variant: "destructive",
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add Exercise</DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="exercise-name">Exercise Name *</Label>
            <Input
              id="exercise-name"
              placeholder="e.g., Bench Press, Squats"
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
            />
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div className="space-y-2">
              <Label htmlFor="sets">Sets</Label>
              <Input
                id="sets"
                type="number"
                min={1}
                max={20}
                value={formData.sets}
                onChange={(e) => setFormData({ ...formData, sets: e.target.value })}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="reps-min">Min Reps</Label>
              <Input
                id="reps-min"
                type="number"
                min={1}
                max={100}
                value={formData.repsMin}
                onChange={(e) => setFormData({ ...formData, repsMin: e.target.value })}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="reps-max">Max Reps</Label>
              <Input
                id="reps-max"
                type="number"
                min={1}
                max={100}
                value={formData.repsMax}
                onChange={(e) => setFormData({ ...formData, repsMax: e.target.value })}
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="rpe">RPE Target</Label>
              <Input
                id="rpe"
                type="number"
                min={1}
                max={10}
                step={0.5}
                placeholder="e.g., 8"
                value={formData.rpeTarget}
                onChange={(e) => setFormData({ ...formData, rpeTarget: e.target.value })}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="rest">Rest (seconds)</Label>
              <Input
                id="rest"
                type="number"
                min={0}
                max={600}
                value={formData.restSeconds}
                onChange={(e) => setFormData({ ...formData, restSeconds: e.target.value })}
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="notes">Notes</Label>
            <Textarea
              id="notes"
              placeholder="Form cues, variations, progressions..."
              value={formData.notes}
              onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
              rows={2}
            />
          </div>

          <div className="flex items-center space-x-2">
            <Checkbox
              id="warmup"
              checked={formData.isWarmup}
              onCheckedChange={(checked) =>
                setFormData({ ...formData, isWarmup: checked === true })
              }
            />
            <Label htmlFor="warmup" className="text-sm font-normal">
              This is a warm-up exercise
            </Label>
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Add Exercise
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
