"use client";

import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Smile, Frown, Meh, SmilePlus, Heart, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import type { DailyLog } from "@/types/daily-log";

const moodEmojis = [
  { value: 1, icon: Frown, label: "Poor", color: "text-destructive" },
  { value: 2, icon: Meh, label: "Below Average", color: "text-warning" },
  { value: 3, icon: Smile, label: "Good", color: "text-warning" },
  { value: 4, icon: SmilePlus, label: "Great", color: "text-success" },
  { value: 5, icon: Heart, label: "Excellent", color: "text-success" },
];

interface WellnessSectionProps {
  formData: Partial<DailyLog>;
  setFormData: (data: Partial<DailyLog>) => void;
  showNotes: boolean;
  setShowNotes: (show: boolean) => void;
}

export function WellnessSection({ 
  formData, 
  setFormData, 
  showNotes, 
  setShowNotes 
}: WellnessSectionProps) {
  return (
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
    </div>
  );
}