"use client";

import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from "recharts";
import { Card, CardContent } from "@/components/ui/card";
import { CalendarRange, Target } from "lucide-react";
import { weekFigureWords } from "@/lib/habits/habit-words";
import type { HabitDayFacts, HabitProgressRow } from "@/types/habits";

interface HabitProgressCardProps {
  row: HabitProgressRow;
}

const formatDate = (dateStr: string) => {
  const date = new Date(dateStr + "T00:00:00");
  return `${date.getMonth() + 1}/${date.getDate()}`;
};

/** How a day of the chart reads when the client points at it. */
function dayWord(day: HabitDayFacts): string {
  if (day.met) return "Done";
  if (!day.covered) return "Not running";
  if (day.planned) return "Missed";
  return "Not planned";
}

/**
 * One habit on the Journey: its words, this week's figure and its last few
 * weeks' together — met of planned, a day made up on another day counted
 * toward its week; both the server's, never added up here — and its last days
 * as they happened, a bar for each day done.
 */
export function HabitProgressCard({ row }: HabitProgressCardProps) {
  const { habit, words, weeks, span, days } = row;
  const thisWeek = weeks[weeks.length - 1];
  const describe = [words.target, words.schedule].filter((part): part is string => part !== null).join(" · ");

  const chartData = days.map((day) => ({ date: day.date, value: day.met ? 1 : 0, word: dayWord(day) }));

  return (
    <Card className="overflow-hidden">
      <CardContent className="p-4 sm:p-5">
        <div className="space-y-4">
          {/* Header with the habit's name, its target and its days */}
          <div>
            <h3 className="font-semibold text-base sm:text-lg text-foreground">{habit.name}</h3>
            {describe && <p className="text-sm text-muted-foreground mt-0.5">{describe}</p>}
          </div>

          {/* Figures - Stacked on mobile, side by side on larger screens */}
          <div className="grid grid-cols-2 gap-3">
            <div className="flex items-start gap-2">
              <div className="w-8 h-8 rounded-full bg-success/10 flex items-center justify-center flex-shrink-0">
                <Target className="w-4 h-4 text-success" />
              </div>
              <div className="min-w-0">
                <p className="text-xs text-muted-foreground">This week</p>
                <p className="text-base font-semibold">{thisWeek ? weekFigureWords(thisWeek) : "Nothing planned"}</p>
              </div>
            </div>

            <div className="flex items-start gap-2">
              <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0">
                <CalendarRange className="w-4 h-4 text-primary" />
              </div>
              <div className="min-w-0">
                <p className="text-xs text-muted-foreground">Last {weeks.length} weeks</p>
                <p className="text-base font-semibold">{weekFigureWords(span)}</p>
              </div>
            </div>
          </div>

          {/* Chart - Full width on mobile */}
          <div className="h-[120px] sm:h-[140px] w-full -mx-2">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartData} margin={{ top: 5, right: 5, bottom: 20, left: 5 }}>
                <XAxis
                  dataKey="date"
                  tickFormatter={formatDate}
                  tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
                  tickLine={false}
                  axisLine={false}
                  interval="preserveStartEnd"
                />
                <YAxis hide />
                <Tooltip
                  contentStyle={{
                    backgroundColor: "hsl(var(--popover))",
                    border: "1px solid hsl(var(--border))",
                    borderRadius: "8px",
                    fontSize: "12px",
                    boxShadow: "0 4px 6px -1px rgba(0, 0, 0, 0.1)",
                  }}
                  labelStyle={{ color: "hsl(var(--popover-foreground))", fontWeight: 500 }}
                  formatter={(_value: number, _name: string, item: { payload?: { word?: string } }) => [
                    item.payload?.word ?? "",
                    "",
                  ]}
                  labelFormatter={(label) => {
                    const date = new Date(`${label}T00:00:00`);
                    return date.toLocaleDateString("en-US", {
                      weekday: "short",
                      month: "short",
                      day: "numeric",
                    });
                  }}
                />
                <Bar dataKey="value" radius={[3, 3, 0, 0]} maxBarSize={16}>
                  {chartData.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={entry.value > 0 ? "#10b981" : "#e5e7eb"} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
