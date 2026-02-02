"use client";

import { memo } from "react";
import { DAYS_OF_WEEK } from "@/lib/constants/days";

export const DayHeadersGrid = memo(function DayHeadersGrid() {
  return (
    <div className="grid grid-cols-7 gap-3 mb-2">
      {DAYS_OF_WEEK.map((day) => (
        <div key={day.value} className="text-center">
          <span className="text-xs font-medium text-gray-400 uppercase tracking-wider">
            {day.label}
          </span>
        </div>
      ))}
    </div>
  );
});
