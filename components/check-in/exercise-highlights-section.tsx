"use client";

import { useState, useId } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Trophy, AlertCircle, Plus, X, ChevronDown } from "lucide-react";
import type {
  CheckInExerciseHighlight,
  CheckInTrainingContext,
  ExerciseHighlightType,
} from "@/types/check-in";

type ExerciseHighlightsSectionProps = {
  exercises: CheckInTrainingContext["sessions"][0]["exercises"][];
  highlights: CheckInExerciseHighlight[];
  onChange: (highlights: CheckInExerciseHighlight[]) => void;
  weightUnit: "lbs" | "kg";
};

type NewHighlight = {
  exerciseName: string;
  highlightType: ExerciseHighlightType;
  details: string;
  weightValue: string;
  reps: string;
};

const EMPTY_HIGHLIGHT: NewHighlight = {
  exerciseName: "",
  highlightType: "pr",
  details: "",
  weightValue: "",
  reps: "",
};

export const ExerciseHighlightsSection = ({
  exercises,
  highlights,
  onChange,
  weightUnit,
}: ExerciseHighlightsSectionProps) => {
  const datalistId = useId();
  const [isOpen, setIsOpen] = useState(highlights.length > 0);
  const [newHighlight, setNewHighlight] = useState<NewHighlight>(EMPTY_HIGHLIGHT);

  // Flatten all exercises from all sessions
  const allExercises = exercises.flat();

  const handleAdd = () => {
    if (!newHighlight.exerciseName.trim()) return;

    const highlight: CheckInExerciseHighlight = {
      exerciseName: newHighlight.exerciseName,
      highlightType: newHighlight.highlightType,
      details: newHighlight.details || undefined,
      weightValue: newHighlight.weightValue
        ? parseFloat(newHighlight.weightValue)
        : undefined,
      weightUnit: newHighlight.weightValue ? weightUnit : undefined,
      reps: newHighlight.reps ? parseInt(newHighlight.reps) : undefined,
    };

    onChange([...highlights, highlight]);
    setNewHighlight(EMPTY_HIGHLIGHT);
  };

  const handleRemove = (index: number) => {
    onChange(highlights.filter((_, i) => i !== index));
  };

  const getIcon = (type: ExerciseHighlightType) => {
    switch (type) {
      case "pr":
        return <Trophy className="h-4 w-4 text-yellow-500" />;
      case "struggle":
        return <AlertCircle className="h-4 w-4 text-red-500" />;
      default:
        return null;
    }
  };

  const getTypeLabel = (type: ExerciseHighlightType) => {
    switch (type) {
      case "pr":
        return "PR";
      case "struggle":
        return "Struggle";
      case "note":
        return "Note";
    }
  };

  return (
    <Collapsible open={isOpen} onOpenChange={setIsOpen}>
      <CollapsibleTrigger asChild>
        <Button
          variant="ghost"
          className="w-full flex items-center justify-between p-3 h-auto"
        >
          <div className="flex items-center gap-2">
            <Trophy className="h-5 w-5 text-muted-foreground" />
            <span className="font-medium">Exercise Highlights</span>
            {highlights.length > 0 && (
              <span className="text-xs bg-primary/10 text-primary px-2 py-0.5 rounded-full">
                {highlights.length}
              </span>
            )}
          </div>
          <ChevronDown
            className={`h-4 w-4 transition-transform ${isOpen ? "rotate-180" : ""}`}
          />
        </Button>
      </CollapsibleTrigger>

      <CollapsibleContent className="space-y-4 pt-2">
        <p className="text-sm text-muted-foreground">
          Record any PRs, struggles, or notable moments from your training.
        </p>

        {/* Existing highlights */}
        {highlights.length > 0 && (
          <div className="space-y-2">
            {highlights.map((h, index) => (
              <div
                key={`${h.exerciseName}-${h.highlightType}-${index}`}
                className="flex items-start gap-2 p-2 rounded-lg bg-muted/50"
              >
                {getIcon(h.highlightType)}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium">{h.exerciseName}</span>
                    <span className="text-xs bg-muted px-1.5 py-0.5 rounded">
                      {getTypeLabel(h.highlightType)}
                    </span>
                  </div>
                  {(h.weightValue || h.reps) && (
                    <div className="text-xs text-muted-foreground">
                      {h.weightValue && `${h.weightValue} ${h.weightUnit}`}
                      {h.weightValue && h.reps && " × "}
                      {h.reps && `${h.reps} reps`}
                    </div>
                  )}
                  {h.details && (
                    <div className="text-xs text-muted-foreground mt-1">
                      {h.details}
                    </div>
                  )}
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6 flex-shrink-0"
                  onClick={() => handleRemove(index)}
                >
                  <X className="h-3 w-3" />
                </Button>
              </div>
            ))}
          </div>
        )}

        {/* Add new highlight form */}
        <div className="space-y-3 p-3 rounded-lg border bg-background">
          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2">
              <Label className="text-xs">Exercise Name</Label>
              <Input
                list={datalistId}
                placeholder="e.g., Bench Press"
                value={newHighlight.exerciseName}
                onChange={(e) =>
                  setNewHighlight({ ...newHighlight, exerciseName: e.target.value })
                }
                className="mt-1"
              />
              <datalist id={datalistId}>
                {allExercises.map((e) => (
                  <option key={e.id} value={e.name} />
                ))}
              </datalist>
            </div>

            <div>
              <Label className="text-xs">Type</Label>
              <Select
                value={newHighlight.highlightType}
                onValueChange={(v) =>
                  setNewHighlight({
                    ...newHighlight,
                    highlightType: v as ExerciseHighlightType,
                  })
                }
              >
                <SelectTrigger className="mt-1">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="pr">PR / Win</SelectItem>
                  <SelectItem value="struggle">Struggle</SelectItem>
                  <SelectItem value="note">Note</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div>
                <Label className="text-xs">Weight ({weightUnit})</Label>
                <Input
                  type="number"
                  placeholder="135"
                  value={newHighlight.weightValue}
                  onChange={(e) =>
                    setNewHighlight({ ...newHighlight, weightValue: e.target.value })
                  }
                  className="mt-1"
                />
              </div>
              <div>
                <Label className="text-xs">Reps</Label>
                <Input
                  type="number"
                  placeholder="8"
                  value={newHighlight.reps}
                  onChange={(e) =>
                    setNewHighlight({ ...newHighlight, reps: e.target.value })
                  }
                  className="mt-1"
                />
              </div>
            </div>
          </div>

          <div>
            <Label className="text-xs">Details (optional)</Label>
            <Textarea
              placeholder="Any additional context..."
              value={newHighlight.details}
              onChange={(e) =>
                setNewHighlight({ ...newHighlight, details: e.target.value })
              }
              rows={2}
              className="mt-1 resize-none"
            />
          </div>

          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={handleAdd}
            disabled={!newHighlight.exerciseName.trim()}
            className="w-full"
          >
            <Plus className="h-4 w-4 mr-1" />
            Add Highlight
          </Button>
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
};
