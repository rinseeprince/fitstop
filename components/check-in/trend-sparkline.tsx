"use client";

import { Area, AreaChart, ResponsiveContainer, YAxis } from "recharts";

type TrendSparklineProps = {
  values: number[];
  // A Tailwind text-* class; the line colour is taken from it via currentColor.
  colorClass?: string;
};

// A compact trend line. With fewer than two points there is no trend to draw, so
// it renders a ghosted placeholder ("trends build next week"). Built now so that
// future weeks light up automatically once a second check-in exists.
export const TrendSparkline = ({ values, colorClass = "text-[#0d9488]" }: TrendSparklineProps) => {
  if (values.length < 2) {
    return (
      <div className="h-8 w-20 flex items-center" aria-label="Trend builds next week">
        <div className="h-px w-full border-t border-dashed border-[rgba(13,148,136,0.2)]" />
      </div>
    );
  }

  const data = values.map((v, i) => ({ i, v }));

  return (
    <div className={`h-8 w-20 ${colorClass}`} aria-label="Trend">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 2, right: 0, bottom: 2, left: 0 }}>
          <YAxis hide domain={["dataMin", "dataMax"]} />
          <Area
            type="monotone"
            dataKey="v"
            stroke="currentColor"
            strokeWidth={1.5}
            fill="currentColor"
            fillOpacity={0.12}
            dot={false}
            isAnimationActive={false}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
};
