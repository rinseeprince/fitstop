"use client";

import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Smile, Frown, Meh, SmilePlus, Heart, Flame, ChevronDown, Edit } from "lucide-react";
import { useDailyPulse } from "@/hooks/use-daily-pulse";
import { cn } from "@/lib/utils";
import type { Database } from "@/types/database";

type DailyLog = Database["public"]["Tables"]["daily_logs"]["Row"];

const moodEmojis = [
  { value: 1, icon: Frown, label: "Poor", color: "text-destructive" },
  { value: 2, icon: Meh, label: "Below Average", color: "text-warning" },
  { value: 3, icon: Smile, label: "Good", color: "text-warning" },
  { value: 4, icon: SmilePlus, label: "Great", color: "text-success" },
  { value: 5, icon: Heart, label: "Excellent", color: "text-success" },
];

export function DailyPulse() {
  const { todayLog, streak, isLoading, isSaving, saveLog } = useDailyPulse();
  const [isExpanded, setIsExpanded] = useState(false);
  const [showNotes, setShowNotes] = useState(false);
  const [formData, setFormData] = useState<Partial<DailyLog>>({
    mood: undefined,
    energy: undefined,
    sleep: undefined,
    stress: undefined,
    notes: undefined,
  });

  // Update form data when todayLog loads or changes
  useEffect(() => {
    if (todayLog && !isLoading) {
      setFormData({
        mood: todayLog.mood || undefined,
        energy: todayLog.energy || undefined,
        sleep: todayLog.sleep || undefined,
        stress: todayLog.stress || undefined,
        notes: todayLog.notes || undefined,
      });
      // If we have a log, don't expand by default
      setIsExpanded(false);
    } else if (!todayLog && !isLoading) {
      // If no log exists, expand by default
      setIsExpanded(true);
    }
  }, [todayLog, isLoading]);

  const handleSave = async () => {
    await saveLog({
      mood: formData.mood || undefined,
      energy: formData.energy || undefined,
      sleep: formData.sleep || undefined,
      stress: formData.stress || undefined,
      notes: formData.notes || undefined,
    });
    setIsExpanded(false);
    setShowNotes(false);
  };

  const handleEdit = () => {
    setFormData({
      mood: todayLog?.mood || undefined,
      energy: todayLog?.energy || undefined,
      sleep: todayLog?.sleep || undefined,
      stress: todayLog?.stress || undefined,
      notes: todayLog?.notes || undefined,
    });
    setIsExpanded(true);
  };

  const getMoodEmoji = (value: number | null | undefined) => {
    if (!value) return null;
    return moodEmojis.find(m => m.value === value);
  };

  if (isLoading) {
    return (
      <Card>
        <CardContent className="py-8 text-center text-muted-foreground">
          Loading daily pulse...
        </CardContent>
      </Card>
    );
  }

  const hasLoggedToday = !!todayLog && (
    todayLog.mood !== null ||
    todayLog.energy !== null ||
    todayLog.sleep !== null ||
    todayLog.stress !== null
  );

  return (
    <Card>
      <CardHeader className="pb-4">
        <div className="flex items-center justify-between">
          <CardTitle className="text-lg">Daily Pulse - Wellness</CardTitle>
          {streak > 0 && (
            <Badge variant="secondary" className="flex items-center gap-1">
              <Flame className="h-3 w-3" />
              {streak} day streak
            </Badge>
          )}
        </div>
      </CardHeader>

      <CardContent>
        {hasLoggedToday && !isExpanded ? (
          <div className="space-y-3">
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">Today's wellness logged</span>
              <Button variant="ghost" size="sm" onClick={handleEdit}>
                <Edit className="h-4 w-4 mr-1" />
                Edit
              </Button>
            </div>
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
          </div>
        ) : (
          <div className="space-y-6">
            <div className="space-y-3">
              <Label>Overall Mood</Label>
              <div className="grid grid-cols-5 gap-2">
                {moodEmojis.map(({ value, icon: Icon, label, color }) => (
                  <button
                    key={value}
                    type="button"
                    onClick={() => setFormData({ ...formData, mood: value })}
                    className={cn(
                      "flex flex-col items-center gap-1 p-2 rounded-lg border-2 transition-all duration-200 hover:scale-105",
                      formData.mood === value
                        ? "border-primary bg-primary/5 shadow-lg"
                        : "border-border hover:border-primary/50"
                    )}
                  >
                    <Icon className={cn("w-5 h-5", formData.mood === value ? color : "text-muted-foreground")} />
                    <span className="text-xs font-medium">{label}</span>
                  </button>
                ))}
              </div>
            </div>

            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <Label>Energy Level</Label>
                <span className="text-sm font-semibold text-primary">{formData.energy || 5}/10</span>
              </div>
              <Slider
                value={[formData.energy || 5]}
                onValueChange={(value) => setFormData({ ...formData, energy: value[0] })}
                min={1}
                max={10}
                step={1}
                className="w-full"
              />
            </div>

            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <Label>Sleep Quality</Label>
                <span className="text-sm font-semibold text-primary">{formData.sleep || 5}/10</span>
              </div>
              <Slider
                value={[formData.sleep || 5]}
                onValueChange={(value) => setFormData({ ...formData, sleep: value[0] })}
                min={1}
                max={10}
                step={1}
                className="w-full"
              />
            </div>

            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <Label>Stress Level</Label>
                <span className="text-sm font-semibold text-primary">{formData.stress || 5}/10</span>
              </div>
              <Slider
                value={[formData.stress || 5]}
                onValueChange={(value) => setFormData({ ...formData, stress: value[0] })}
                min={1}
                max={10}
                step={1}
                className="w-full"
              />
            </div>

            <Collapsible open={showNotes} onOpenChange={setShowNotes}>
              <CollapsibleTrigger asChild>
                <Button variant="ghost" size="sm" className="w-full justify-between">
                  <span>Add notes (optional)</span>
                  <ChevronDown className={cn("h-4 w-4 transition-transform", showNotes && "rotate-180")} />
                </Button>
              </CollapsibleTrigger>
              <CollapsibleContent className="pt-2">
                <Textarea
                  placeholder="How are you feeling today?"
                  value={formData.notes || ""}
                  onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                  rows={3}
                  className="resize-none"
                />
              </CollapsibleContent>
            </Collapsible>

            <Button onClick={handleSave} disabled={isSaving} className="w-full">
              {isSaving ? "Saving..." : todayLog ? "Update Log" : "Log Day"}
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}