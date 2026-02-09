"use client";

import { Button } from "@/components/ui/button";

interface DateRangeSelectorProps {
  value: string;
  onChange: (range: string) => void;
}

const DATE_RANGES = [
  { label: "7 days", value: "7" },
  { label: "30 days", value: "30" },
  { label: "90 days", value: "90" },
  { label: "All time", value: "all" },
];

export function DateRangeSelector({ value, onChange }: DateRangeSelectorProps) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-sm text-muted-foreground mr-2">Time period:</span>
      {DATE_RANGES.map((range) => (
        <Button
          key={range.value}
          variant={value === range.value ? "default" : "outline"}
          size="sm"
          onClick={() => onChange(range.value)}
          className="h-8"
        >
          {range.label}
        </Button>
      ))}
    </div>
  );
}