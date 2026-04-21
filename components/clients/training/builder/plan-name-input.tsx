"use client";

import { Input } from "@/components/ui/input";

type PlanNameInputProps = {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  helpText?: string;
};

const MAX_LENGTH = 80;

export function PlanNameInput({
  value,
  onChange,
  placeholder,
  helpText,
}: PlanNameInputProps) {
  return (
    <div className="space-y-1.5">
      <label className="text-[11px] font-semibold uppercase tracking-wide text-[#5a7d82]">
        Plan Name
      </label>
      <Input
        value={value}
        onChange={(e) => onChange(e.target.value.slice(0, MAX_LENGTH))}
        onBlur={(e) => onChange(e.target.value.trim())}
        placeholder={placeholder ?? "Plan name"}
        maxLength={MAX_LENGTH}
        className="h-10 text-[14px] border-[rgba(13,148,136,0.15)] bg-white focus-visible:ring-[rgba(13,148,136,0.35)]"
      />
      {helpText && (
        <p className="text-[11px] text-[#93b0b4] leading-[1.3]">{helpText}</p>
      )}
    </div>
  );
}
