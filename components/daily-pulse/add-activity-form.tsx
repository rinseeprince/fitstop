"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

type UnplannedActivity = {
  activityName: string;
  intensityLevel: "low" | "moderate" | "vigorous";
  durationMinutes: number;
};

const COMMON_ACTIVITIES = [
  "Running", "Cycling", "Swimming", "Walking", "Hiking",
  "Basketball", "Yoga", "Boxing", "Martial Arts"
];

interface AddActivityFormProps {
  onAdd: (activity: UnplannedActivity) => void;
  onCancel: () => void;
}

export function AddActivityForm({ onAdd, onCancel }: AddActivityFormProps) {
  const [newActivity, setNewActivity] = useState<UnplannedActivity>({
    activityName: "",
    intensityLevel: "moderate",
    durationMinutes: 30,
  });

  const handleAdd = () => {
    if (newActivity.activityName.trim()) {
      onAdd(newActivity);
      setNewActivity({ activityName: "", intensityLevel: "moderate", durationMinutes: 30 });
    }
  };

  return (
    <div className="space-y-2 p-3 border rounded-lg">
      <Input
        list="common-activities"
        placeholder="Activity name"
        value={newActivity.activityName}
        onChange={(e) => setNewActivity({ ...newActivity, activityName: e.target.value })}
      />
      <datalist id="common-activities">
        {COMMON_ACTIVITIES.map((name) => (
          <option key={name} value={name} />
        ))}
      </datalist>
      <div className="flex gap-2">
        <Select
          value={newActivity.intensityLevel}
          onValueChange={(v) => setNewActivity({
            ...newActivity,
            intensityLevel: v as "low" | "moderate" | "vigorous"
          })}
        >
          <SelectTrigger className="flex-1">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="low">Low</SelectItem>
            <SelectItem value="moderate">Moderate</SelectItem>
            <SelectItem value="vigorous">Vigorous</SelectItem>
          </SelectContent>
        </Select>
        <Input
          type="number"
          placeholder="Duration (min)"
          value={newActivity.durationMinutes}
          onChange={(e) => setNewActivity({
            ...newActivity,
            durationMinutes: parseInt(e.target.value) || 0
          })}
          className="w-24"
        />
      </div>
      <div className="flex gap-2">
        <Button size="sm" onClick={handleAdd}>Add</Button>
        <Button size="sm" variant="outline" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </div>
  );
}