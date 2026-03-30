"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { PhaseSelector } from "../shared/phase-selector";
import type { DailyHabitInput } from "@/types/daily-habit";

type AddHabitInlineFormProps = {
  clientId: string;
  onSubmit: (data: DailyHabitInput) => Promise<void>;
  onCancel: () => void;
};

export function AddHabitInlineForm({
  clientId,
  onSubmit,
  onCancel,
}: AddHabitInlineFormProps) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [isNumeric, setIsNumeric] = useState(false);
  const [targetValue, setTargetValue] = useState("");
  const [targetUnit, setTargetUnit] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [phaseId, setPhaseId] = useState<string | undefined>(undefined);
  const [phaseBlocked, setPhaseBlocked] = useState(false);

  const handleSubmit = async () => {
    if (!name.trim()) return;

    setIsSubmitting(true);
    try {
      const data: DailyHabitInput = {
        name: name.trim(),
        description: description.trim() || undefined,
        isBoolean: !isNumeric,
        targetValue: isNumeric && targetValue ? parseFloat(targetValue) : undefined,
        targetUnit: isNumeric && targetUnit.trim() ? targetUnit.trim() : undefined,
        phaseId: phaseId || undefined,
      };

      await onSubmit(data);

      setName("");
      setDescription("");
      setIsNumeric(false);
      setTargetValue("");
      setTargetUnit("");
      setPhaseId(undefined);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="border border-[rgba(13,148,136,0.08)] rounded-[6px] p-4 space-y-3 bg-[#f4f7f6]">
      <div className="space-y-1.5">
        <Label htmlFor="inline-name" className="text-[11px] text-[#5a7d82]">Name</Label>
        <Input
          id="inline-name"
          placeholder="e.g., Drink 3 litres of water"
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="bg-white border-[rgba(13,148,136,0.08)] focus-visible:ring-[#0d9488] text-[13px]"
        />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="inline-desc" className="text-[11px] text-[#5a7d82]">Description (optional)</Label>
        <Textarea
          id="inline-desc"
          placeholder="Additional notes or instructions"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={2}
          className="bg-white border-[rgba(13,148,136,0.08)] focus-visible:ring-[#0d9488] text-[13px] resize-none"
        />
      </div>

      <div className="flex items-center justify-between">
        <Label htmlFor="inline-numeric" className="text-[11px] text-[#5a7d82]">Track a number</Label>
        <Switch id="inline-numeric" checked={isNumeric} onCheckedChange={setIsNumeric} />
      </div>

      {isNumeric && (
        <div className="flex gap-3">
          <div className="flex-1 space-y-1.5">
            <Label htmlFor="inline-target" className="text-[11px] text-[#5a7d82]">Target Value</Label>
            <Input
              id="inline-target"
              type="number"
              placeholder="e.g., 3"
              value={targetValue}
              onChange={(e) => setTargetValue(e.target.value)}
              className="bg-white border-[rgba(13,148,136,0.08)] focus-visible:ring-[#0d9488] text-[13px]"
            />
          </div>
          <div className="flex-1 space-y-1.5">
            <Label htmlFor="inline-unit" className="text-[11px] text-[#5a7d82]">Unit</Label>
            <Input
              id="inline-unit"
              placeholder="e.g., litres"
              value={targetUnit}
              onChange={(e) => setTargetUnit(e.target.value)}
              className="bg-white border-[rgba(13,148,136,0.08)] focus-visible:ring-[#0d9488] text-[13px]"
            />
          </div>
        </div>
      )}

      <PhaseSelector
        clientId={clientId}
        value={phaseId}
        onChange={setPhaseId}
        onBlockSubmit={setPhaseBlocked}
      />

      <div className="flex items-center gap-2 pt-1">
        <Button
          variant="outline"
          size="sm"
          onClick={onCancel}
          disabled={isSubmitting}
          className="border-[rgba(13,148,136,0.08)] text-[#5a7d82] text-[12px]"
        >
          Cancel
        </Button>
        <Button
          size="sm"
          onClick={handleSubmit}
          disabled={!name.trim() || isSubmitting || phaseBlocked}
          className="bg-[#0d9488] hover:bg-[#0f766e] text-white text-[12px]"
        >
          Add Habit
        </Button>
      </div>
    </div>
  );
}
