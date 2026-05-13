"use client";

import { useState, useEffect, useRef, useCallback } from "react";
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
import { Loader2, Search } from "lucide-react";

type CatalogExercise = {
  id: string;
  name: string;
  muscle_group?: string;
  equipment?: string;
};

type LocalExerciseData = {
  name: string;
  sets: number;
  repsMin?: number;
  repsMax?: number;
  repsTarget?: string;
  rpeTarget?: number;
  restSeconds?: number;
  notes?: string;
  isWarmup: boolean;
};

type AddExerciseDialogProps = {
  clientId: string;
  planId: string;
  sessionId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess: () => void;
  onLocalAdd?: (exercise: LocalExerciseData) => void;
};

export function AddExerciseDialog({
  clientId,
  planId,
  sessionId,
  open,
  onOpenChange,
  onSuccess,
  onLocalAdd,
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

  // Catalog search state
  const [catalogResults, setCatalogResults] = useState<CatalogExercise[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [isSearching, setIsSearching] = useState(false);
  const searchTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const suggestionsRef = useRef<HTMLDivElement>(null);

  const searchCatalog = useCallback(async (query: string) => {
    if (query.length < 2) {
      setCatalogResults([]);
      return;
    }
    setIsSearching(true);
    try {
      const res = await fetch(`/api/training/exercises?search=${encodeURIComponent(query)}`);
      if (res.ok) {
        const data = await res.json();
        setCatalogResults(data.exercises?.slice(0, 8) ?? []);
      }
    } catch {
      // Non-critical — free-text fallback still works
    } finally {
      setIsSearching(false);
    }
  }, []);

  const handleNameChange = useCallback((value: string) => {
    setFormData((prev) => ({ ...prev, name: value }));
    setShowSuggestions(true);
    if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current);
    searchTimeoutRef.current = setTimeout(() => {
      void searchCatalog(value);
    }, 300);
  }, [searchCatalog]);

  const handleSelectExercise = useCallback((exercise: CatalogExercise) => {
    setFormData((prev) => ({ ...prev, name: exercise.name }));
    setShowSuggestions(false);
    setCatalogResults([]);
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!formData.name.trim()) {
      toast({
        title: "Exercise name required",
        variant: "destructive",
      });
      return;
    }

    const exerciseData: LocalExerciseData = {
      name: formData.name,
      sets: parseInt(formData.sets) || 3,
      repsMin: formData.repsMin ? parseInt(formData.repsMin) : undefined,
      repsMax: formData.repsMax ? parseInt(formData.repsMax) : undefined,
      rpeTarget: formData.rpeTarget ? parseFloat(formData.rpeTarget) : undefined,
      restSeconds: formData.restSeconds ? parseInt(formData.restSeconds) : undefined,
      notes: formData.notes || undefined,
      isWarmup: formData.isWarmup,
    };

    const resetForm = () => {
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
      setCatalogResults([]);
      setShowSuggestions(false);
    };

    // Local mode: no API call
    if (onLocalAdd) {
      onLocalAdd(exerciseData);
      resetForm();
      onOpenChange(false);
      return;
    }

    setIsSubmitting(true);
    try {
      const res = await fetch(
        `/api/clients/${clientId}/training/${planId}/sessions/${sessionId}/exercises`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(exerciseData),
        }
      );

      if (!res.ok) throw new Error("Failed to add exercise");

      toast({ title: "Exercise added" });
      resetForm();
      onOpenChange(false);
      onSuccess();
    } catch (_error) {
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
          <div className="space-y-2 relative">
            <Label htmlFor="exercise-name">Exercise Name *</Label>
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-[#93b0b4]" />
              <Input
                id="exercise-name"
                placeholder="Search or type exercise name..."
                value={formData.name}
                onChange={(e) => handleNameChange(e.target.value)}
                onFocus={() => catalogResults.length > 0 && setShowSuggestions(true)}
                onBlur={() => setTimeout(() => setShowSuggestions(false), 200)}
                className="pl-8"
                autoComplete="off"
              />
              {isSearching && (
                <Loader2 className="absolute right-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-[#93b0b4] animate-spin" />
              )}
            </div>
            {showSuggestions && catalogResults.length > 0 && (
              <div
                ref={suggestionsRef}
                className="absolute z-50 top-full left-0 right-0 mt-1 bg-white border border-[rgba(13,148,136,0.12)] rounded-[6px] shadow-lg max-h-48 overflow-y-auto"
              >
                {catalogResults.map((exercise) => (
                  <button
                    key={exercise.id}
                    type="button"
                    className="w-full text-left px-3 py-2 text-sm hover:bg-[rgba(13,148,136,0.05)] flex items-center gap-2 transition-colors"
                    onMouseDown={(e) => {
                      e.preventDefault();
                      handleSelectExercise(exercise);
                    }}
                  >
                    <span className="text-[#0c1a1e]">{exercise.name}</span>
                    {exercise.muscle_group && (
                      <span className="text-[10px] text-[#93b0b4] bg-[rgba(13,148,136,0.05)] px-1.5 py-0.5 rounded-[3px]">
                        {exercise.muscle_group}
                      </span>
                    )}
                  </button>
                ))}
              </div>
            )}
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
