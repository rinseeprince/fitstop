"use client";

import { useState } from "react";
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
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Activity, Plus, X, ChevronDown, Flame } from "lucide-react";
import type { CheckInExternalActivity, DayOfWeek } from "@/types/check-in";

type ExternalActivitiesCheckinProps = {
  activities: CheckInExternalActivity[];
  onChange: (activities: CheckInExternalActivity[]) => void;
  clientWeightKg?: number;
};

type NewActivity = {
  activityName: string;
  intensityLevel: "low" | "moderate" | "vigorous";
  durationMinutes: string;
  dayPerformed?: DayOfWeek;
};

const EMPTY_ACTIVITY: NewActivity = {
  activityName: "",
  intensityLevel: "moderate",
  durationMinutes: "",
};

const COMMON_ACTIVITIES = [
  "Running",
  "Cycling",
  "Swimming",
  "Walking",
  "Hiking",
  "Basketball",
  "Soccer",
  "Tennis",
  "Yoga",
  "Dancing",
  "Boxing",
  "Martial Arts",
  "Rock Climbing",
  "CrossFit",
  "Rowing",
];

const DAY_OPTIONS: { value: DayOfWeek; label: string }[] = [
  { value: "monday", label: "Monday" },
  { value: "tuesday", label: "Tuesday" },
  { value: "wednesday", label: "Wednesday" },
  { value: "thursday", label: "Thursday" },
  { value: "friday", label: "Friday" },
  { value: "saturday", label: "Saturday" },
  { value: "sunday", label: "Sunday" },
];

// Basic MET values for calorie estimation
const getMETValue = (intensity: "low" | "moderate" | "vigorous"): number => {
  switch (intensity) {
    case "low":
      return 3.0;
    case "moderate":
      return 5.0;
    case "vigorous":
      return 8.0;
  }
};

const estimateCalories = (
  durationMinutes: number,
  intensity: "low" | "moderate" | "vigorous",
  weightKg: number
): number => {
  const met = getMETValue(intensity);
  // Calories = MET × weight (kg) × duration (hours)
  return Math.round(met * weightKg * (durationMinutes / 60));
};

export const ExternalActivitiesCheckin = ({
  activities,
  onChange,
  clientWeightKg = 70,
}: ExternalActivitiesCheckinProps) => {
  const [isOpen, setIsOpen] = useState(activities.length > 0);
  const [newActivity, setNewActivity] = useState<NewActivity>(EMPTY_ACTIVITY);

  const handleAdd = () => {
    if (!newActivity.activityName.trim() || !newActivity.durationMinutes) return;

    const durationMinutes = parseInt(newActivity.durationMinutes);
    const estimatedCalories = estimateCalories(
      durationMinutes,
      newActivity.intensityLevel,
      clientWeightKg
    );

    const activity: CheckInExternalActivity = {
      activityName: newActivity.activityName,
      intensityLevel: newActivity.intensityLevel,
      durationMinutes,
      estimatedCalories,
      dayPerformed: newActivity.dayPerformed,
    };

    onChange([...activities, activity]);
    setNewActivity(EMPTY_ACTIVITY);
  };

  const handleRemove = (index: number) => {
    onChange(activities.filter((_, i) => i !== index));
  };

  const totalCalories = activities.reduce(
    (sum, a) => sum + (a.estimatedCalories || 0),
    0
  );

  const getIntensityColor = (intensity: string) => {
    switch (intensity) {
      case "low":
        return "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400";
      case "moderate":
        return "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400";
      case "vigorous":
        return "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400";
      default:
        return "bg-muted text-muted-foreground";
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
            <Activity className="h-5 w-5 text-muted-foreground" />
            <span className="font-medium">Other Activities</span>
            {activities.length > 0 && (
              <span className="text-xs bg-primary/10 text-primary px-2 py-0.5 rounded-full">
                {activities.length}
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
          Add any physical activities you did outside of your training plan
          (sports, cardio, recreational activities).
        </p>

        {/* Existing activities */}
        {activities.length > 0 && (
          <div className="space-y-2">
            {activities.map((a, index) => (
              <div
                key={index}
                className="flex items-center gap-2 p-2 rounded-lg bg-muted/50"
              >
                <Activity className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-medium">{a.activityName}</span>
                    <span
                      className={`text-xs px-1.5 py-0.5 rounded capitalize ${getIntensityColor(
                        a.intensityLevel
                      )}`}
                    >
                      {a.intensityLevel}
                    </span>
                  </div>
                  <div className="text-xs text-muted-foreground flex items-center gap-2">
                    <span>{a.durationMinutes} min</span>
                    {a.estimatedCalories && (
                      <span className="flex items-center gap-0.5">
                        <Flame className="h-3 w-3" />
                        ~{a.estimatedCalories} cal
                      </span>
                    )}
                  </div>
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

            {totalCalories > 0 && (
              <div className="flex items-center justify-end gap-1 text-sm text-muted-foreground">
                <Flame className="h-4 w-4" />
                <span>Total: ~{totalCalories} calories</span>
              </div>
            )}
          </div>
        )}

        {/* Add new activity form */}
        <div className="space-y-3 p-3 rounded-lg border bg-background">
          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2">
              <Label className="text-xs">Activity</Label>
              <Input
                list="common-activities"
                placeholder="e.g., Running, Basketball"
                value={newActivity.activityName}
                onChange={(e) =>
                  setNewActivity({ ...newActivity, activityName: e.target.value })
                }
                className="mt-1"
              />
              <datalist id="common-activities">
                {COMMON_ACTIVITIES.map((a) => (
                  <option key={a} value={a} />
                ))}
              </datalist>
            </div>

            <div>
              <Label className="text-xs">Intensity</Label>
              <Select
                value={newActivity.intensityLevel}
                onValueChange={(v) =>
                  setNewActivity({
                    ...newActivity,
                    intensityLevel: v as "low" | "moderate" | "vigorous",
                  })
                }
              >
                <SelectTrigger className="mt-1">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="low">Low</SelectItem>
                  <SelectItem value="moderate">Moderate</SelectItem>
                  <SelectItem value="vigorous">Vigorous</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div>
              <Label className="text-xs">Duration (min)</Label>
              <Input
                type="number"
                placeholder="30"
                min="1"
                max="600"
                value={newActivity.durationMinutes}
                onChange={(e) =>
                  setNewActivity({
                    ...newActivity,
                    durationMinutes: e.target.value,
                  })
                }
                className="mt-1"
              />
            </div>

            <div className="col-span-2">
              <Label className="text-xs">Day (optional)</Label>
              <Select
                value={newActivity.dayPerformed || ""}
                onValueChange={(v) =>
                  setNewActivity({
                    ...newActivity,
                    dayPerformed: v ? (v as DayOfWeek) : undefined,
                  })
                }
              >
                <SelectTrigger className="mt-1">
                  <SelectValue placeholder="Select day..." />
                </SelectTrigger>
                <SelectContent>
                  {DAY_OPTIONS.map((d) => (
                    <SelectItem key={d.value} value={d.value}>
                      {d.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={handleAdd}
            disabled={
              !newActivity.activityName.trim() || !newActivity.durationMinutes
            }
            className="w-full"
          >
            <Plus className="h-4 w-4 mr-1" />
            Add Activity
          </Button>
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
};
