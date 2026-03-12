"use client";

import { useEffect } from "react";
import { Smile, Frown, Meh, SmilePlus, Heart } from "lucide-react";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Textarea } from "@/components/ui/textarea";
import { DailyLogsSummary } from "./daily-logs-summary";
import { calculateMetricAverages } from "@/utils/daily-logs-aggregation";
import type { SubjectiveMetrics } from "@/types/check-in";
import type { DailyLog } from "@/types/daily-log";

type StepSubjectiveProps = {
  data: Partial<SubjectiveMetrics>;
  onChange: (data: Partial<SubjectiveMetrics>) => void;
  dailyLogs?: DailyLog[];
};

const moodEmojis = [
  { value: 1, icon: Frown, label: "Poor", color: "text-destructive" },
  { value: 2, icon: Meh, label: "Below Average", color: "text-warning" },
  { value: 3, icon: Smile, label: "Good", color: "text-warning" },
  { value: 4, icon: SmilePlus, label: "Great", color: "text-success" },
  { value: 5, icon: Heart, label: "Excellent", color: "text-success" },
];

export const StepSubjective = ({ data, onChange, dailyLogs = [] }: StepSubjectiveProps) => {
  // Check if we have enough daily logs to show the summary
  const hasSufficientLogs = dailyLogs.length >= 3;
  
  // When we have sufficient logs, calculate and store the averages
  useEffect(() => {
    if (hasSufficientLogs && !data.mood) {
      const averages = calculateMetricAverages(dailyLogs);
      onChange({
        ...data,
        mood: averages.mood,
        energy: averages.energy,
        sleep: averages.sleep,
        stress: averages.stress,
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasSufficientLogs, dailyLogs.length]);
  
  // If we have sufficient daily logs, show the summary view
  if (hasSufficientLogs) {
    return (
      <div className="space-y-8">
        <div>
          <h3 className="text-lg font-semibold mb-1">Your Week Summary</h3>
          <p className="text-sm text-muted-foreground">
            Based on your daily logs from the past week
          </p>
        </div>
        
        {/* Daily Logs Summary */}
        <DailyLogsSummary dailyLogs={dailyLogs} />
        
        {/* Reflection Text Area */}
        <div className="space-y-3">
          <Label htmlFor="reflection" className="text-muted-foreground">Anything worth noting about how you felt this week?</Label>
          <Textarea
            id="reflection"
            placeholder="Any highlights, challenges, or patterns you noticed? How did you feel overall?"
            value={data.notes || ""}
            onChange={(e) => onChange({ ...data, notes: e.target.value })}
            rows={4}
            className="resize-none"
          />
        </div>
      </div>
    );
  }
  
  // Otherwise, show the manual input form (existing implementation)
  return (
    <div className="space-y-8">
      <div>
        <h3 className="text-lg font-semibold mb-1">How are you feeling?</h3>
        <p className="text-sm text-muted-foreground">
          Help your coach understand your current state
        </p>
      </div>

      {/* Mood Selector */}
      <div className="space-y-3">
        <Label>Overall Mood</Label>
        <div className="grid grid-cols-5 gap-2">
          {moodEmojis.map(({ value, icon: Icon, label, color }) => (
            <button
              key={value}
              type="button"
              onClick={() => onChange({ ...data, mood: value })}
              className={`
                flex flex-col items-center gap-2 p-3 rounded-lg border-2
                transition-all duration-200 hover:scale-105
                ${
                  data.mood === value
                    ? "border-primary bg-primary/5"
                    : "border-border hover:border-primary/50"
                }
              `}
            >
              <Icon
                className={`w-6 h-6 ${
                  data.mood === value ? color : "text-muted-foreground"
                }`}
              />
              <span className="text-xs font-medium text-center">{label}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Energy Level */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <Label>Energy Level</Label>
          <span className="text-sm font-semibold text-primary">
            {data.energy ?? 5}/10
          </span>
        </div>
        <Slider
          value={[data.energy ?? 5]}
          onValueChange={(value) => onChange({ ...data, energy: value[0] })}
          min={1}
          max={10}
          step={1}
          className="w-full"
        />
        <div className="flex justify-between text-xs text-muted-foreground">
          <span>Low</span>
          <span>High</span>
        </div>
      </div>

      {/* Sleep Quality */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <Label>Sleep Quality</Label>
          <span className="text-sm font-semibold text-primary">
            {data.sleep ?? 5}/10
          </span>
        </div>
        <Slider
          value={[data.sleep ?? 5]}
          onValueChange={(value) => onChange({ ...data, sleep: value[0] })}
          min={1}
          max={10}
          step={1}
          className="w-full"
        />
        <div className="flex justify-between text-xs text-muted-foreground">
          <span>Poor</span>
          <span>Excellent</span>
        </div>
      </div>

      {/* Stress Level */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <Label>Stress Level</Label>
          <span className="text-sm font-semibold text-primary">
            {data.stress ?? 5}/10
          </span>
        </div>
        <Slider
          value={[data.stress ?? 5]}
          onValueChange={(value) => onChange({ ...data, stress: value[0] })}
          min={1}
          max={10}
          step={1}
          className="w-full"
        />
        <div className="flex justify-between text-xs text-muted-foreground">
          <span>Low</span>
          <span>High</span>
        </div>
      </div>

      {/* Notes */}
      <div className="space-y-3">
        <Label htmlFor="notes">Additional Notes (Optional)</Label>
        <Textarea
          id="notes"
          placeholder="Anything else you'd like to share about how you're feeling?"
          value={data.notes || ""}
          onChange={(e) => onChange({ ...data, notes: e.target.value })}
          rows={4}
          className="resize-none"
        />
      </div>
    </div>
  );
};
