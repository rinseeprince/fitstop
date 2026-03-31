"use client";

import type { PhaseWeeklyDataRow } from "@/types/roadmap";

type PhaseWeeklyTableProps = {
  data: PhaseWeeklyDataRow[];
  weightUnit: "lbs" | "kg";
};

function formatPeriod(dateStr: string): string {
  const d = new Date(dateStr + "T00:00:00");
  const day = String(d.getDate()).padStart(2, "0");
  const month = String(d.getMonth() + 1).padStart(2, "0");
  return `${day}/${month}`;
}

export const PhaseWeeklyTable = ({ data, weightUnit }: PhaseWeeklyTableProps) => {
  if (data.length === 0) {
    return (
      <p className="text-[12.5px] italic text-[#93b0b4] py-2">
        No check-in data yet
      </p>
    );
  }

  return (
    <div>
      <table className="w-full text-left text-[12.5px]">
        <thead>
          <tr className="text-[10px] uppercase text-[#93b0b4] tracking-[0.06em] font-semibold">
            <th className="pb-2 pr-3 font-semibold">Wk</th>
            <th className="pb-2 pr-3 font-semibold">Period</th>
            <th className="pb-2 pr-3 font-semibold text-right">Weight</th>
            <th className="pb-2 pr-3 font-semibold text-right">Nutrition</th>
            <th className="pb-2 font-semibold text-right">Sessions</th>
          </tr>
        </thead>
        <tbody>
          {data.map((row, index) => (
            <tr
              key={row.weekNumber}
              className="border-b border-[rgba(13,148,136,0.08)]"
              style={{
                animation: "slideUp 0.3s ease forwards",
                animationDelay: `${index * 0.05}s`,
                opacity: 0,
              }}
            >
              <td className="py-1.5 pr-3 font-mono-display text-[#0c1a1e]">
                {row.weekNumber}
              </td>
              <td className="py-1.5 pr-3 font-mono-display text-[#0c1a1e]">
                {formatPeriod(row.periodStart)} – {formatPeriod(row.periodEnd)}
              </td>
              <td className="py-1.5 pr-3 font-mono-display text-right">
                {row.weight != null ? (
                  <span className="text-[#0c1a1e]">
                    {row.weight.toFixed(1)} {weightUnit}
                  </span>
                ) : (
                  <span className="text-[#93b0b4]">—</span>
                )}
              </td>
              <td className="py-1.5 pr-3 font-mono-display text-right">
                {row.nutritionDaysOnTarget != null ? (
                  <span className="text-[#0c1a1e]">
                    {row.nutritionDaysOnTarget}/7
                  </span>
                ) : (
                  <span className="text-[#93b0b4]">—</span>
                )}
              </td>
              <td className="py-1.5 font-mono-display text-right">
                {row.trainingSessions > 0 ? (
                  <span className="text-[#0c1a1e]">{row.trainingSessions}</span>
                ) : (
                  <span className="text-[#93b0b4]">—</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};
