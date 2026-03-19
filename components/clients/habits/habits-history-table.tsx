"use client";

import { useState, useMemo, useCallback } from "react";
import useSWR from "swr";
import { Check, X } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { HistoryTable, type ColumnDef } from "@/components/clients/history-table/history-table";
import { HistoryChartDialog } from "@/components/clients/history-table/history-chart-dialog";
import { swrFetcher } from "@/lib/swr-fetcher";
import type { HabitMeta, HabitsHistoryRow } from "@/types/history";

const PAGE_SIZE = 10;

type HabitsHistoryResponse = {
  habits: HabitMeta[];
  rows: HabitsHistoryRow[];
  total: number;
};

function formatDate(dateStr: string) {
  const date = new Date(dateStr + "T00:00:00");
  return date.toLocaleDateString("en-AU", { day: "numeric", month: "short" });
}

function formatDay(dateStr: string) {
  const date = new Date(dateStr + "T00:00:00");
  return date.toLocaleDateString("en-AU", { weekday: "long" });
}

function renderDash() {
  return <span className="text-muted-foreground">-</span>;
}

function renderBooleanHabit(completed: boolean) {
  return completed ? (
    <Check className="h-4 w-4 text-green-500" />
  ) : (
    <X className="h-4 w-4 text-red-500" />
  );
}

function renderValueHabit(value: number | null, target: number | null, unit: string | null) {
  if (value === null) return renderDash();
  const label = target ? `${value} / ${target}` : `${value}`;
  const suffix = unit ? ` ${unit}` : "";

  let colorClass = "text-muted-foreground";
  if (target && target > 0) {
    const pct = (value / target) * 100;
    if (pct >= 100) colorClass = "text-green-600";
    else if (pct >= 50) colorClass = "text-amber-600";
    else colorClass = "text-red-600";
  }

  return <span className={colorClass}>{label}{suffix}</span>;
}

type Props = {
  clientId: string;
};

export function HabitsHistoryTable({ clientId }: Props) {
  const [page, setPage] = useState(0);
  const [chartColumn, setChartColumn] = useState<string | null>(null);

  const url = `/api/clients/${clientId}/history/habits?limit=${PAGE_SIZE}&offset=${page * PAGE_SIZE}`;
  const { data, isLoading } = useSWR<HabitsHistoryResponse>(url, swrFetcher, {
    revalidateOnFocus: false,
    dedupingInterval: 5000,
  });

  const habits = useMemo(() => data?.habits || [], [data?.habits]);
  const rows = useMemo(() => data?.rows || [], [data?.rows]);
  const total = data?.total || 0;

  const handleColumnClick = useCallback((key: string) => {
    setChartColumn(key);
  }, []);

  const chartTitle = useMemo(() => {
    if (chartColumn === "completion_rate") return "Daily Completion Rate";
    const habit = habits.find((h) => h.id === chartColumn);
    return habit ? `${habit.name} - Completion` : "";
  }, [chartColumn, habits]);

  const chartData = useMemo(() => {
    if (!chartColumn || rows.length === 0) return [];

    if (chartColumn === "completion_rate") {
      return [...rows].reverse().map((row) => ({
        date: formatDate(row.date),
        value: row.total_habits > 0
          ? Math.round((row.total_completed / row.total_habits) * 100)
          : 0,
      }));
    }

    // Per-habit chart: show 1 for completed, 0 for not
    return [...rows].reverse().map((row) => {
      const entry = (row as Record<string, unknown>)[chartColumn] as
        { completed: boolean } | undefined;
      return {
        date: formatDate(row.date),
        value: entry?.completed ? 1 : 0,
      };
    });
  }, [chartColumn, rows]);

  const columns: ColumnDef<HabitsHistoryRow>[] = useMemo(() => {
    const cols: ColumnDef<HabitsHistoryRow>[] = [
      {
        key: "date",
        label: "Date",
        render: (_v, row) => formatDate(row.date),
      },
      {
        key: "day",
        label: "Day",
        render: (_v, row) => formatDay(row.date),
      },
    ];

    // Dynamic habit columns - use first arg (row[col.key]) which the service
    // copies to top-level properties, avoiding nested row.habits[id] lookup
    for (const habit of habits) {
      cols.push({
        key: habit.id,
        label: habit.name,
        chartType: "bar" as const,
        render: (v) => {
          const entry = v as { completed: boolean; value: number | null; notes: string | null } | undefined;
          if (!entry) return renderDash();
          if (habit.is_boolean) return renderBooleanHabit(entry.completed);
          return renderValueHabit(entry.value, habit.target_value, habit.target_unit);
        },
      });
    }

    // Completion rate column
    cols.push({
      key: "completion_rate",
      label: "Completion",
      chartType: "bar" as const,
      render: (_v, row) => {
        if (row.total_habits === 0) return renderDash();
        const pct = Math.round((row.total_completed / row.total_habits) * 100);
        let colorClass = "text-red-600";
        if (pct >= 80) colorClass = "text-green-600";
        else if (pct >= 50) colorClass = "text-amber-600";
        return <span className={`font-medium ${colorClass}`}>{pct}%</span>;
      },
    });

    return cols;
  }, [habits]);

  return (
    <Card>
      <CardContent className="pt-6">
        <HistoryTable<HabitsHistoryRow>
          columns={columns}
          data={rows}
          total={total}
          page={page}
          onPageChange={setPage}
          isLoading={isLoading}
          emptyMessage="No habits logged yet"
          onColumnClick={handleColumnClick}
        />
      </CardContent>

      <HistoryChartDialog
        open={chartColumn !== null}
        onClose={() => setChartColumn(null)}
        title={chartTitle}
        chartType="bar"
        data={chartData}
        dataKey="value"
        color="#22c55e"
      />
    </Card>
  );
}
