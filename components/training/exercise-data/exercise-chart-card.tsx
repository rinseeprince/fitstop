"use client";

import { TrendingUp } from "lucide-react";

type ExerciseChartCardProps = {
  title: string;
  subtitle?: string;
  legend?: React.ReactNode;
  insight?: string | null;
  children: React.ReactNode;
};

export function ExerciseChartCard({
  title,
  subtitle,
  legend,
  insight,
  children,
}: ExerciseChartCardProps) {
  return (
    <div className="bg-white border border-[rgba(13,148,136,0.08)] rounded-[6px] px-[18px] py-[20px]">
      {/* Header */}
      <div className="flex items-start justify-between mb-4">
        <div>
          <p className="text-[14px] font-medium text-[#0c1a1e]">{title}</p>
          {subtitle && (
            <p className="text-[12px] text-[#93b0b4] mt-0.5">{subtitle}</p>
          )}
        </div>
        {legend && <div className="flex items-center gap-3">{legend}</div>}
      </div>

      {/* Chart slot */}
      {children}

      {/* Insight footer */}
      {insight && (
        <div className="flex items-start gap-2 mt-4 pt-3 border-t border-[rgba(13,148,136,0.08)]">
          <TrendingUp className="h-3 w-3 text-[#0d9488] mt-0.5 shrink-0" />
          <p className="text-[12px] text-[#5a7d82] leading-relaxed">
            {insight}
          </p>
        </div>
      )}
    </div>
  );
}

// Reusable legend dot
export function LegendItem({
  color,
  label,
  icon,
}: {
  color: string;
  label: string;
  icon?: "dot" | "star";
}) {
  return (
    <span className="flex items-center gap-1.5 text-[11px] text-[#93b0b4]">
      {icon === "star" ? (
        <span className="text-[12px]" style={{ color }}>
          ★
        </span>
      ) : (
        <span
          className="w-[8px] h-[8px] rounded-full"
          style={{ backgroundColor: color }}
        />
      )}
      {label}
    </span>
  );
}
