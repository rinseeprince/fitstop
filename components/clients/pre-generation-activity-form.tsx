"use client";

import { useState, useEffect } from "react";
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
import { ActivityAutocomplete } from "./activity-autocomplete";
import { ActivityAnalysisPreview } from "./activity-analysis-preview";
import type { PreGenerationActivity } from "@/types/training";
import type { ActivityAnalysis, IntensityLevel } from "@/types/external-activity";

type PreGenerationActivityFormProps = {
  clientWeightKg: number;
  onAdd: (activity: PreGenerationActivity) => void;
  onCancel: () => void;
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

export function PreGenerationActivityForm({
  clientWeightKg,
  onAdd,
  onCancel,
}: PreGenerationActivityFormProps) {
  const [activityName, setActivityName] = useState("");
  const [dayOfWeek, setDayOfWeek] = useState("");
  const [intensityLevel, setIntensityLevel] = useState<IntensityLevel>("moderate");
  const [durationMinutes, setDurationMinutes] = useState(60);
  const [analysis, setAnalysis] = useState<ActivityAnalysis | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);

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

  const handleAdd = () => {
    if (!activityName || !dayOfWeek) return;

    const newActivity: PreGenerationActivity = {
      tempId: `temp-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      activityName,
      dayOfWeek,
      intensityLevel,
      durationMinutes,
      analysis: analysis || undefined,
    };

    onAdd(newActivity);
  };

  return (
    <div className="space-y-4 p-4 bg-background rounded-lg border">
      <div className="space-y-2">
        <Label>Activity Name</Label>
        <ActivityAutocomplete
          value={activityName}
          onChange={setActivityName}
          triggerFetch={true}
        />
      </div>

      <div className="grid grid-cols-2 gap-4">
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
          <Label>Duration (min)</Label>
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
      </div>

      <div className="space-y-2">
        <Label>Intensity</Label>
        <Select
          value={intensityLevel}
          onValueChange={(v) => setIntensityLevel(v as IntensityLevel)}
        >
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

      <ActivityAnalysisPreview analysis={analysis} isLoading={isAnalyzing} />

      <div className="flex justify-end gap-2">
        <Button variant="outline" size="sm" onClick={onCancel}>
          Cancel
        </Button>
        <Button
          size="sm"
          onClick={handleAdd}
          disabled={!activityName || !dayOfWeek}
        >
          Add Activity
        </Button>
      </div>
    </div>
  );
}
