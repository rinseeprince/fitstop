"use client";

import { useState, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { Loader2 } from "lucide-react";
import { ActivityAutocomplete } from "./activity-autocomplete";
import { ActivityAnalysisPreview } from "./activity-analysis-preview";
import type { ActivityAnalysis } from "@/types/external-activity";

type AddActivityDialogProps = {
  clientId: string;
  planId: string;
  clientWeightKg: number;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess: () => void;
};

const DAYS_OF_WEEK = [
  { value: "monday", label: "Monday" },
  { value: "tuesday", label: "Tuesday" },
  { value: "wednesday", label: "Wednesday" },
  { value: "thursday", label: "Thursday" },
  { value: "friday", label: "Friday" },
  { value: "saturday", label: "Saturday" },
  { value: "sunday", label: "Sunday" },
];

const INTENSITY_LEVELS = [
  { value: "low", label: "Low", description: "Light effort, easy breathing" },
  { value: "moderate", label: "Moderate", description: "Somewhat hard, can talk" },
  { value: "vigorous", label: "Vigorous", description: "Hard effort, limited talking" },
];

export function AddActivityDialog({
  clientId,
  planId,
  clientWeightKg,
  open,
  onOpenChange,
  onSuccess,
}: AddActivityDialogProps) {
  const { toast } = useToast();
  const [activityName, setActivityName] = useState("");
  const [dayOfWeek, setDayOfWeek] = useState("");
  const [intensityLevel, setIntensityLevel] = useState<string>("moderate");
  const [durationMinutes, setDurationMinutes] = useState(60);
  const [analysis, setAnalysis] = useState<ActivityAnalysis | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  // Analyze activity when params change
  useEffect(() => {
    if (!activityName || !intensityLevel || !durationMinutes) {
      setAnalysis(null);
      return;
    }

    const timer = setTimeout(async () => {
      setIsAnalyzing(true);
      try {
        const res = await fetch("/api/activities/analyze", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            activityName,
            intensityLevel,
            durationMinutes,
            clientWeightKg,
          }),
        });
        const data = await res.json();
        if (data.success) {
          setAnalysis(data.analysis);
        }
      } catch (error) {
        console.error("Failed to analyze activity:", error);
      } finally {
        setIsAnalyzing(false);
      }
    }, 500);

    return () => clearTimeout(timer);
  }, [activityName, intensityLevel, durationMinutes, clientWeightKg]);

  const handleSave = async () => {
    if (!activityName || !dayOfWeek || !intensityLevel) {
      toast({
        title: "Missing fields",
        description: "Please fill in all required fields",
        variant: "destructive",
      });
      return;
    }

    setIsSaving(true);
    try {
      const res = await fetch(`/api/clients/${clientId}/training/${planId}/activities`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          activityName,
          dayOfWeek,
          intensityLevel,
          durationMinutes,
        }),
      });

      const data = await res.json();

      if (data.success) {
        toast({
          title: "Activity added",
          description: `${activityName} added (+${data.activity.activityMetadata?.estimatedCalories || 0} cal)`,
        });
        onSuccess();
        onOpenChange(false);
        resetForm();
      } else {
        throw new Error(data.error || "Failed to add activity");
      }
    } catch (error) {
      toast({
        title: "Error",
        description: error instanceof Error ? error.message : "Failed to add activity",
        variant: "destructive",
      });
    } finally {
      setIsSaving(false);
    }
  };

  const resetForm = () => {
    setActivityName("");
    setDayOfWeek("");
    setIntensityLevel("moderate");
    setDurationMinutes(60);
    setAnalysis(null);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Add External Activity</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <Label>Activity Name</Label>
            <ActivityAutocomplete
              value={activityName}
              onChange={setActivityName}
              triggerFetch={open}
            />
          </div>

          <div className="space-y-2">
            <Label>Day</Label>
            <Select value={dayOfWeek} onValueChange={setDayOfWeek}>
              <SelectTrigger>
                <SelectValue placeholder="Select day" />
              </SelectTrigger>
              <SelectContent>
                {DAYS_OF_WEEK.map((day) => (
                  <SelectItem key={day.value} value={day.value}>
                    {day.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label>Intensity</Label>
            <Select value={intensityLevel} onValueChange={setIntensityLevel}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {INTENSITY_LEVELS.map((level) => (
                  <SelectItem key={level.value} value={level.value}>
                    <div className="flex flex-col">
                      <span>{level.label}</span>
                      <span className="text-xs text-muted-foreground">
                        {level.description}
                      </span>
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label>Duration (minutes)</Label>
            <Input
              type="number"
              min={10}
              max={480}
              value={durationMinutes || ""}
              onChange={(e) => {
                const val = e.target.value;
                setDurationMinutes(val === "" ? 0 : parseInt(val));
              }}
              onBlur={(e) => {
                const val = parseInt(e.target.value);
                if (!val || val < 10) setDurationMinutes(10);
                else if (val > 480) setDurationMinutes(480);
              }}
            />
          </div>

          <ActivityAnalysisPreview analysis={analysis} isLoading={isAnalyzing} />
        </div>

        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={isSaving || !activityName || !dayOfWeek}>
            {isSaving ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Adding...
              </>
            ) : (
              "Add Activity"
            )}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
