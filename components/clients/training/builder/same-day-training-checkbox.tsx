"use client";

import { memo, useId } from "react";
import { Checkbox } from "@/components/ui/checkbox";
import { useTrainingBuilderContext } from "@/contexts/training-builder-context";
import { cn } from "@/lib/utils";

type SameDayTrainingCheckboxProps = {
  className?: string;
};

export const SameDayTrainingCheckbox = memo(function SameDayTrainingCheckbox({
  className,
}: SameDayTrainingCheckboxProps) {
  const builder = useTrainingBuilderContext();
  const id = useId();

  if (builder.preGenerationActivities.length === 0) {
    return null;
  }

  return (
    <div className={cn("flex items-start space-x-3 p-3 bg-muted/50 rounded-lg", className)}>
      <Checkbox
        id={id}
        checked={builder.allowSameDayTraining}
        onCheckedChange={(checked) => builder.setAllowSameDayTraining(checked === true)}
      />
      <div className="grid gap-1.5 leading-none">
        <label
          htmlFor={id}
          className="text-sm font-medium cursor-pointer"
        >
          Client can train on activity days
        </label>
        <p className="text-xs text-muted-foreground">
          Enable for athletes or clients comfortable with multiple sessions per day
        </p>
      </div>
    </div>
  );
});
