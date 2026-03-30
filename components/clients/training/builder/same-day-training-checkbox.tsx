"use client";

import { memo, useId } from "react";
import { Checkbox } from "@/components/ui/checkbox";
import { useTrainingBuilderContext } from "@/contexts/training-builder-context";

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
    <div className={`flex items-start space-x-3 p-3 bg-[rgba(13,148,136,0.04)] rounded-[6px] ${className ?? ""}`}>
      <Checkbox
        id={id}
        checked={builder.allowSameDayTraining}
        onCheckedChange={(checked) => builder.setAllowSameDayTraining(checked === true)}
      />
      <div className="grid gap-1.5 leading-none">
        <label
          htmlFor={id}
          className="text-[13px] font-medium text-[#0c1a1e] cursor-pointer"
        >
          Client can train on activity days
        </label>
        <p className="text-[12px] text-[#93b0b4]">
          Enable for athletes or clients comfortable with multiple sessions per day
        </p>
      </div>
    </div>
  );
});
