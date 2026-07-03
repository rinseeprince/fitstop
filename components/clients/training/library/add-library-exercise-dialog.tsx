"use client";

import { useState, useCallback } from "react";
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
import { useToast } from "@/hooks/use-toast";
import { MIN_SEARCH_CHARS, useExerciseSearch } from "@/hooks/use-exercise-search";
import { Loader2, Search } from "lucide-react";
import type { Exercise } from "@/types/training";

export type NewExercisePayload = {
  name: string;
  sets: number;
  repsMin?: number;
  repsMax?: number;
  rpeTarget?: number;
  restSeconds?: number;
};

type AddLibraryExerciseDialogProps = {
  savedPlanId: string;
  sessionId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess: () => void;
  /**
   * When provided, the dialog routes the new exercise through this callback
   * instead of POSTing to the server. Used by DraftEditor's working-copy mode
   * (status === "saved") where edits live in React state until the coach
   * explicitly commits them.
   */
  onAddLocal?: (exercise: NewExercisePayload) => void;
};

export function AddLibraryExerciseDialog({
  savedPlanId,
  sessionId,
  open,
  onOpenChange,
  onSuccess,
  onAddLocal,
}: AddLibraryExerciseDialogProps) {
  const { toast } = useToast();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [formData, setFormData] = useState({
    name: "",
    sets: "3",
    repsMin: "8",
    repsMax: "12",
    rpeTarget: "",
    restSeconds: "90",
  });

  // Instant results over the SWR-cached catalog. suppressSuggestions keeps a
  // just-selected name from reopening the dropdown on refocus: results derive
  // from the input value now, so they can't be cleared the way the old fetch
  // results were.
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [suppressSuggestions, setSuppressSuggestions] = useState(false);
  const { results: catalogResults, isLoading: catalogLoading } =
    useExerciseSearch(formData.name);
  const isSearching =
    catalogLoading && formData.name.trim().length >= MIN_SEARCH_CHARS;

  const handleNameChange = useCallback((value: string) => {
    setFormData((prev) => ({ ...prev, name: value }));
    setSuppressSuggestions(false);
    setShowSuggestions(true);
  }, []);

  const handleSelectExercise = useCallback((exercise: Exercise) => {
    setFormData((prev) => ({ ...prev, name: exercise.name }));
    setSuppressSuggestions(true);
    setShowSuggestions(false);
  }, []);

  const resetForm = () => {
    setFormData({ name: "", sets: "3", repsMin: "8", repsMax: "12", rpeTarget: "", restSeconds: "90" });
    setShowSuggestions(false);
    setSuppressSuggestions(false);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.name.trim()) {
      toast({ title: "Exercise name required", variant: "destructive" });
      return;
    }

    const payload: NewExercisePayload = {
      name: formData.name,
      sets: parseInt(formData.sets) || 3,
      repsMin: formData.repsMin ? parseInt(formData.repsMin) : undefined,
      repsMax: formData.repsMax ? parseInt(formData.repsMax) : undefined,
      rpeTarget: formData.rpeTarget ? parseFloat(formData.rpeTarget) : undefined,
      restSeconds: formData.restSeconds ? parseInt(formData.restSeconds) : undefined,
    };

    // Local-first branch: parent handles it in React state. No server call,
    // no refresh cascade — the parent updates its working copy and the list
    // re-renders.
    if (onAddLocal) {
      onAddLocal(payload);
      resetForm();
      onOpenChange(false);
      return;
    }

    setIsSubmitting(true);
    try {
      const res = await fetch(
        `/api/training/saved-plans/${savedPlanId}/sessions/${sessionId}/exercises`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        }
      );

      if (!res.ok) throw new Error("Failed to add exercise");

      toast({ title: "Exercise added" });
      resetForm();
      onOpenChange(false);
      onSuccess();
    } catch {
      toast({ title: "Error", description: "Failed to add exercise", variant: "destructive" });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) resetForm(); onOpenChange(o); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add Exercise</DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Exercise name with catalog search */}
          <div className="space-y-2 relative">
            <Label htmlFor="lib-exercise-name">Exercise Name *</Label>
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-[#93b0b4]" />
              <Input
                id="lib-exercise-name"
                placeholder="Search or type exercise name..."
                value={formData.name}
                onChange={(e) => handleNameChange(e.target.value)}
                onFocus={() =>
                  catalogResults.length > 0 &&
                  !suppressSuggestions &&
                  setShowSuggestions(true)
                }
                onBlur={() => setTimeout(() => setShowSuggestions(false), 200)}
                className="pl-8"
                autoComplete="off"
              />
              {isSearching && (
                <Loader2 className="absolute right-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-[#93b0b4] animate-spin" />
              )}
            </div>
            {showSuggestions && catalogResults.length > 0 && (
              <div className="absolute z-50 top-full left-0 right-0 mt-1 bg-white border border-[rgba(13,148,136,0.12)] rounded-[6px] shadow-lg max-h-48 overflow-y-auto">
                {catalogResults.map((exercise) => (
                  <button
                    key={exercise.id}
                    type="button"
                    className="w-full text-left px-3 py-2 text-sm hover:bg-[rgba(13,148,136,0.05)] flex items-center gap-2 transition-colors"
                    onMouseDown={(e) => { e.preventDefault(); handleSelectExercise(exercise); }}
                  >
                    <span className="text-[#0c1a1e]">{exercise.name}</span>
                    {exercise.muscleGroup && (
                      <span className="text-[10px] text-[#93b0b4] bg-[rgba(13,148,136,0.05)] px-1.5 py-0.5 rounded-[3px]">
                        {exercise.muscleGroup}
                      </span>
                    )}
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div className="space-y-2">
              <Label htmlFor="lib-sets">Sets</Label>
              <Input id="lib-sets" type="number" min={1} max={20} value={formData.sets}
                onChange={(e) => setFormData({ ...formData, sets: e.target.value })} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="lib-reps-min">Min Reps</Label>
              <Input id="lib-reps-min" type="number" min={1} max={100} value={formData.repsMin}
                onChange={(e) => setFormData({ ...formData, repsMin: e.target.value })} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="lib-reps-max">Max Reps</Label>
              <Input id="lib-reps-max" type="number" min={1} max={100} value={formData.repsMax}
                onChange={(e) => setFormData({ ...formData, repsMax: e.target.value })} />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="lib-rpe">RPE Target</Label>
              <Input id="lib-rpe" type="number" min={1} max={10} step={0.5} placeholder="e.g., 8"
                value={formData.rpeTarget}
                onChange={(e) => setFormData({ ...formData, rpeTarget: e.target.value })} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="lib-rest">Rest (seconds)</Label>
              <Input id="lib-rest" type="number" min={0} max={600} value={formData.restSeconds}
                onChange={(e) => setFormData({ ...formData, restSeconds: e.target.value })} />
            </div>
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
