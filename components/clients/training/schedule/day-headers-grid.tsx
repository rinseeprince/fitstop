"use client";

import { memo } from "react";
import { DAYS_OF_WEEK } from "@/lib/constants/days";

export const DayHeadersGrid = memo(function DayHeadersGrid() {
  return (
    <div className="grid grid-cols-7 gap-2 mb-2">
      {DAYS_OF_WEEK.map((day) => (
        <div key={day.value} className="text-center">
          <span className="text-[10px] font-medium text-[#93b0b4] uppercase tracking-[0.06em]">
            {day.label}
          </span>
        </div>
      ))}
    </div>
  );
});
