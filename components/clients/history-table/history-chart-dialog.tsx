"use client";

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AreaChart,
  Area,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  Cell,
  ReferenceLine,
} from "recharts";

const DEFAULT_COLOR = "#8b5cf6";

const TOOLTIP_STYLE = {
  backgroundColor: "hsl(var(--popover))",
  border: "1px solid hsl(var(--border))",
  borderRadius: "8px",
  fontSize: "12px",
  boxShadow: "0 4px 6px -1px rgba(0, 0, 0, 0.1)",
};

const TOOLTIP_LABEL_STYLE = {
  color: "hsl(var(--popover-foreground))",
  fontWeight: 500,
};

const TICK_STYLE = {
  fontSize: 11,
  fill: "hsl(var(--muted-foreground))",
};

type HistoryChartDialogProps = {
  open: boolean;
  onClose: () => void;
  title: string;
  chartType: "line" | "bar" | "heatmap";
  data: Array<{ date: string; value: number }>;
  dataKey: string;
  color?: string;
  referenceValue?: number | null;
  referenceLabel?: string;
};

function hexToRgba(hex: string, alpha: number): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function formatDate(dateStr: string) {
  const date = new Date(dateStr);
  return `${date.getMonth() + 1}/${date.getDate()}`;
}

function LineChart({
  data,
  dataKey,
  color,
  referenceValue,
  referenceLabel,
}: {
  data: Array<{ date: string; value: number }>;
  dataKey: string;
  color: string;
  referenceValue?: number | null;
  referenceLabel?: string;
}) {
  const gradientId = `history-gradient-${dataKey}`;

  return (
    <ResponsiveContainer width="100%" height="100%">
      <AreaChart data={data} margin={{ top: 10, right: 10, bottom: 0, left: 0 }}>
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity={0.3} />
            <stop offset="100%" stopColor={color} stopOpacity={0.05} />
          </linearGradient>
        </defs>
        <XAxis
          dataKey="date"
          tickFormatter={formatDate}
          tick={TICK_STYLE}
          tickLine={false}
          axisLine={false}
          interval="preserveStartEnd"
        />
        <YAxis
          domain={["auto", "auto"]}
          tick={TICK_STYLE}
          tickLine={false}
          axisLine={false}
          width={40}
        />
        <Tooltip
          contentStyle={TOOLTIP_STYLE}
          labelStyle={TOOLTIP_LABEL_STYLE}
        />
        <Area
          type="monotone"
          dataKey="value"
          stroke={color}
          strokeWidth={2}
          fill={`url(#${gradientId})`}
          dot={false}
          activeDot={{ r: 5, fill: color, strokeWidth: 2, stroke: "#fff" }}
        />
        {referenceValue != null && (
          <ReferenceLine
            y={referenceValue}
            stroke="hsl(var(--muted-foreground))"
            strokeDasharray="6 4"
            strokeWidth={1.5}
            label={{
              value: referenceLabel || `Goal: ${referenceValue}`,
              position: "insideTopRight",
              fill: "hsl(var(--muted-foreground))",
              fontSize: 11,
            }}
          />
        )}
      </AreaChart>
    </ResponsiveContainer>
  );
}

function BarChartSimple({
  data,
  color,
}: {
  data: Array<{ date: string; value: number }>;
  color: string;
}) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={data} margin={{ top: 10, right: 10, bottom: 0, left: 0 }}>
        <XAxis
          dataKey="date"
          tickFormatter={formatDate}
          tick={TICK_STYLE}
          tickLine={false}
          axisLine={false}
          interval="preserveStartEnd"
        />
        <YAxis
          tick={TICK_STYLE}
          tickLine={false}
          axisLine={false}
          width={40}
        />
        <Tooltip
          contentStyle={TOOLTIP_STYLE}
          labelStyle={TOOLTIP_LABEL_STYLE}
        />
        <Bar
          dataKey="value"
          fill={color}
          radius={[4, 4, 0, 0]}
          maxBarSize={20}
        />
      </BarChart>
    </ResponsiveContainer>
  );
}

function HeatmapChart({
  data,
  color,
}: {
  data: Array<{ date: string; value: number }>;
  color: string;
}) {
  const maxValue = Math.max(...data.map((d) => d.value), 1);

  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={data} margin={{ top: 10, right: 10, bottom: 0, left: 0 }}>
        <XAxis
          dataKey="date"
          tickFormatter={formatDate}
          tick={TICK_STYLE}
          tickLine={false}
          axisLine={false}
          interval="preserveStartEnd"
        />
        <YAxis
          tick={TICK_STYLE}
          tickLine={false}
          axisLine={false}
          width={40}
        />
        <Tooltip
          contentStyle={TOOLTIP_STYLE}
          labelStyle={TOOLTIP_LABEL_STYLE}
        />
        <Bar dataKey="value" radius={[4, 4, 0, 0]} maxBarSize={20}>
          {data.map((entry, index) => {
            const alpha = 0.3 + (entry.value / maxValue) * 0.7;
            return (
              <Cell key={`cell-${index}`} fill={hexToRgba(color, alpha)} />
            );
          })}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

export function HistoryChartDialog({
  open,
  onClose,
  title,
  chartType,
  data,
  dataKey,
  color = DEFAULT_COLOR,
  referenceValue,
  referenceLabel,
}: HistoryChartDialogProps) {
  return (
    <Dialog open={open} onOpenChange={(isOpen) => { if (!isOpen) onClose(); }}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        {data.length === 0 ? (
          <div className="h-[300px] flex items-center justify-center">
            <p className="text-sm text-muted-foreground">No data available</p>
          </div>
        ) : (
          <div className="h-[300px]">
            {chartType === "line" && (
              <LineChart
                data={data}
                dataKey={dataKey}
                color={color}
                referenceValue={referenceValue}
                referenceLabel={referenceLabel}
              />
            )}
            {chartType === "bar" && (
              <BarChartSimple data={data} color={color} />
            )}
            {chartType === "heatmap" && (
              <HeatmapChart data={data} color={color} />
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
