"use client";

import { Button } from "@/components/ui/button";
import { Plus } from "lucide-react";

type HabitEmptyStateProps = {
  onAddHabit: () => void;
};

export const HabitEmptyState = ({ onAddHabit }: HabitEmptyStateProps) => {
  return (
    <div className="flex flex-col items-center justify-center py-8 px-4 text-center space-y-4">
      <div className="space-y-2">
        <p className="font-medium">No habits yet</p>
        <p className="text-sm text-muted-foreground">
          Create daily habits to help your client build consistency
        </p>
      </div>

      <div className="space-y-1">
        <p className="text-xs text-muted-foreground">Example habits:</p>
        <ul className="text-xs text-muted-foreground space-y-0.5">
          <li>• Drink 3 litres of water</li>
          <li>• Walk 10,000 steps</li>
          <li>• Take creatine</li>
          <li>• 8 hours of sleep</li>
        </ul>
      </div>

      <Button onClick={onAddHabit} size="sm" className="mt-2">
        <Plus className="h-4 w-4 mr-2" />
        Create First Habit
      </Button>
    </div>
  );
};