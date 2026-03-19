"use client";

import { useState, useMemo } from "react";
import useSWR from "swr";
import { Check, X, ChevronLeft, ChevronRight } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { swrFetcher } from "@/lib/swr-fetcher";
import type { HabitMeta, HabitsHistoryRow } from "@/types/history";

const PAGE_SIZE = 14;

type HabitsHistoryResponse = {
  habits: HabitMeta[];
  rows: HabitsHistoryRow[];
  total: number;
};

function formatDateHeader(dateStr: string) {
  const date = new Date(dateStr + "T00:00:00");
  const day = date.toLocaleDateString("en-AU", { weekday: "short" });
  const dateLabel = date.toLocaleDateString("en-AU", {
    day: "numeric",
    month: "short",
  });
  return { day, dateLabel };
}

type Props = {
  clientId: string;
};

export function HabitsHistoryTable({ clientId }: Props) {
  const [page, setPage] = useState(0);

  const url = `/api/clients/${clientId}/history/habits?limit=${PAGE_SIZE}&offset=${page * PAGE_SIZE}`;
  const { data, isLoading } = useSWR<HabitsHistoryResponse>(url, swrFetcher, {
    revalidateOnFocus: false,
    dedupingInterval: 5000,
  });

  const habits = useMemo(
    () => (data?.habits || []).filter((h) => h.is_active),
    [data?.habits]
  );
  const rows = useMemo(() => data?.rows || [], [data?.rows]);
  const total = data?.total || 0;
  const totalPages = Math.ceil(total / PAGE_SIZE);

  // API returns newest-first; display oldest-left, newest-right
  const displayRows = useMemo(() => [...rows].reverse(), [rows]);

  if (isLoading) {
    return (
      <Card>
        <CardContent className="pt-6">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="min-w-[140px]">Habit</TableHead>
                {Array.from({ length: PAGE_SIZE }).map((_, i) => (
                  <TableHead key={i} className="text-center">
                    <Skeleton className="h-8 w-12 mx-auto" />
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {Array.from({ length: 4 }).map((_, i) => (
                <TableRow key={i}>
                  <TableCell>
                    <Skeleton className="h-4 w-24" />
                  </TableCell>
                  {Array.from({ length: PAGE_SIZE }).map((_, j) => (
                    <TableCell key={j} className="text-center">
                      <Skeleton className="h-4 w-4 mx-auto" />
                    </TableCell>
                  ))}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    );
  }

  if (habits.length === 0 || displayRows.length === 0) {
    return (
      <Card>
        <CardContent className="pt-6">
          <div className="h-24 flex items-center justify-center text-muted-foreground">
            No habits logged yet
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardContent className="pt-6">
        <div className="space-y-4">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="min-w-[140px]">Habit</TableHead>
                {displayRows.map((row) => {
                  const { day, dateLabel } = formatDateHeader(row.date);
                  return (
                    <TableHead key={row.date} className="text-center min-w-[60px]">
                      <div className="text-xs text-muted-foreground">{day}</div>
                      <div>{dateLabel}</div>
                    </TableHead>
                  );
                })}
              </TableRow>
            </TableHeader>
            <TableBody>
              {habits.map((habit) => (
                <TableRow key={habit.id}>
                  <TableCell className="font-medium">{habit.name}</TableCell>
                  {displayRows.map((row) => {
                    const entry = row.habits[habit.id];
                    const existedOnDate = habit.created_at <= row.date;
                    return (
                      <TableCell key={row.date} className="text-center">
                        <div className="flex items-center justify-center">
                          {entry?.completed ? (
                            <Check className="h-4 w-4 text-green-500" />
                          ) : existedOnDate ? (
                            <X className="h-4 w-4 text-red-500" />
                          ) : (
                            <span className="text-muted-foreground">-</span>
                          )}
                        </div>
                      </TableCell>
                    );
                  })}
                </TableRow>
              ))}
            </TableBody>
          </Table>

          {totalPages > 1 && (
            <div className="flex items-center justify-center gap-4">
              <Button
                variant="ghost"
                size="sm"
                disabled={page >= totalPages - 1}
                onClick={() => setPage(page + 1)}
                className={cn(
                  "gap-1",
                  page >= totalPages - 1 && "pointer-events-none opacity-50"
                )}
              >
                <ChevronLeft className="h-4 w-4" />
                <span className="hidden sm:inline">Older</span>
              </Button>
              <span className="text-sm text-muted-foreground">
                Page {page + 1} of {totalPages}
              </span>
              <Button
                variant="ghost"
                size="sm"
                disabled={page === 0}
                onClick={() => setPage(page - 1)}
                className={cn(
                  "gap-1",
                  page === 0 && "pointer-events-none opacity-50"
                )}
              >
                <span className="hidden sm:inline">Newer</span>
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
