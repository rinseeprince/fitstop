"use client";

import { Smile, Frown, Meh, SmilePlus, Heart } from "lucide-react";
import { cn } from "@/lib/utils";
import type { DailyLog } from "@/types/daily-log";

const moodEmojis = [
  { value: 1, icon: Frown, label: "Poor", color: "text-destructive" },
  { value: 2, icon: Meh, label: "Below Average", color: "text-warning" },
  { value: 3, icon: Smile, label: "Good", color: "text-warning" },
  { value: 4, icon: SmilePlus, label: "Great", color: "text-success" },
  { value: 5, icon: Heart, label: "Excellent", color: "text-success" },
];

interface DailyPulseSummaryProps {
  todayLog: DailyLog;
}

export function DailyPulseSummary({ todayLog }: DailyPulseSummaryProps) {
  const getMoodEmoji = (value: number | null | undefined) => {
    if (!value) return null;
    return moodEmojis.find(m => m.value === value);
  };

  return (
    <div className="grid grid-cols-4 gap-3 text-center">
      {todayLog.mood && (() => {
        const moodData = getMoodEmoji(todayLog.mood);
        const MoodIcon = moodData?.icon;
        const moodColor = moodData?.color;
        return (
          <div>
            <p className="text-xs text-muted-foreground mb-1">Mood</p>
            {MoodIcon && <MoodIcon className={cn("h-5 w-5 mx-auto", moodColor)} />}
          </div>
        );
      })()}
      {todayLog.energy && (
        <div>
          <p className="text-xs text-muted-foreground mb-1">Energy</p>
          <p className="font-semibold">{todayLog.energy}/10</p>
        </div>
      )}
      {todayLog.sleep && (
        <div>
          <p className="text-xs text-muted-foreground mb-1">Sleep</p>
          <p className="font-semibold">{todayLog.sleep}/10</p>
        </div>
      )}
      {todayLog.stress && (
        <div>
          <p className="text-xs text-muted-foreground mb-1">Stress</p>
          <p className="font-semibold">{todayLog.stress}/10</p>
        </div>
      )}
    </div>
  );
}