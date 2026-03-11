"use client";

import { Button } from "@/components/ui/button";
import { ListChecks, Plus } from "lucide-react";

type HabitEmptyStateProps = {
  onAddHabit: () => void;
};

export const HabitEmptyState = ({ onAddHabit }: HabitEmptyStateProps) => {
  return (
    <div className="flex flex-col items-center justify-center h-full py-16 px-8 text-center">
      <div className="w-16 h-16 rounded-full bg-primary/15 flex items-center justify-center mb-4">
        <ListChecks className="h-8 w-8 text-primary" />
      </div>
      <h3 className="text-lg font-semibold text-foreground mb-2">No habits yet</h3>
      <p className="text-sm text-muted-foreground max-w-sm mb-6">
        Create daily habits to help your client build consistency.
      </p>
      <Button
        onClick={onAddHabit}
        className="bg-primary hover:bg-primary/90"
      >
        <Plus className="h-4 w-4 mr-2" />
        Get Started
      </Button>
    </div>
  );
};