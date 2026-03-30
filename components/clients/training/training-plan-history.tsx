"use client";

import { Fragment, useState } from "react";
import useSWR from "swr";
import { swrFetcher } from "@/lib/swr-fetcher";
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { History, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { format } from "date-fns";
import { SPLIT_TYPE_LABELS } from "@/lib/training-constants";
import type { TrainingPlanHistory as TrainingPlanHistoryType } from "@/types/training";

type HistoryResponse = {
  success: boolean;
  history: TrainingPlanHistoryType[];
};

type TrainingPlanHistoryProps = {
  clientId: string;
};

const REASON_LABELS: Record<string, string> = {
  initial: "Initial Plan",
  regenerated: "Regenerated",
  manual_update: "Manual Update",
};

export function TrainingPlanHistory({ clientId }: TrainingPlanHistoryProps) {
  const [isOpen, setIsOpen] = useState(false);
  const { data, isLoading } = useSWR<HistoryResponse>(
    `/api/clients/${clientId}/training/history`,
    swrFetcher,
    { revalidateOnFocus: false }
  );

  if (isLoading) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-14 w-full rounded-[6px]" />
      </div>
    );
  }

  const history = data?.history ?? [];

  if (history.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-center bg-white rounded-[6px]">
        <div className="w-12 h-12 bg-[#f0f5f4] rounded-full flex items-center justify-center mb-3">
          <History className="h-6 w-6 text-[#93b0b4]" />
        </div>
        <p className="text-sm text-[#93b0b4]">No training plan history yet</p>
      </div>
    );
  }

  const totalEntries = history.length;

  return (
    <div data-plan-history>
      {/* Section header row */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="w-full flex items-center gap-3 group"
      >
        <span className="text-[10.5px] uppercase tracking-[0.07em] font-semibold text-[#93b0b4] whitespace-nowrap">
          Plan History
        </span>
        <div className="flex-1 h-px bg-[rgba(13,148,136,0.08)]" />
        <div className="flex items-center gap-2">
          <span className="text-[11px] bg-[rgba(13,148,136,0.05)] text-[#93b0b4] px-2 py-0.5 rounded-[6px] font-medium">
            {totalEntries}
          </span>
          <ChevronDown
            className={cn(
              "h-3.5 w-3.5 text-[#93b0b4] transition-transform duration-200",
              isOpen && "rotate-180"
            )}
          />
        </div>
      </button>

      {/* Collapsible table card */}
      {isOpen && (
        <div className="bg-white rounded-[6px] mt-4">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="text-[11px] uppercase tracking-[0.06em] text-[#93b0b4] font-medium">Date</TableHead>
                <TableHead className="text-[11px] uppercase tracking-[0.06em] text-[#93b0b4] font-medium">Label</TableHead>
                <TableHead className="text-[11px] uppercase tracking-[0.06em] text-[#93b0b4] font-medium">Split</TableHead>
                <TableHead className="text-[11px] uppercase tracking-[0.06em] text-[#93b0b4] font-medium">Frequency</TableHead>
                <TableHead className="text-[11px] uppercase tracking-[0.06em] text-[#93b0b4] font-medium">Sessions</TableHead>
                <TableHead className="text-[11px] uppercase tracking-[0.06em] text-[#93b0b4] font-medium">Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {history.map((entry, index) => {
                const snapshot = entry.planSnapshot;
                const splitLabel = snapshot
                  ? SPLIT_TYPE_LABELS[snapshot.splitType] || snapshot.splitType
                  : "—";
                const reasonLabel =
                  REASON_LABELS[entry.regenerationReason || ""] ||
                  entry.regenerationReason ||
                  "Created";

                return (
                  <Fragment key={entry.id}>
                    <TableRow>
                      <TableCell className="text-sm text-[#93b0b4] font-mono-display">
                        {format(new Date(entry.createdAt), "MMM d, yyyy")}
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium text-[#0c1a1e]">
                            {reasonLabel}
                          </span>
                          {index === 0 && (
                            <span className="inline-flex items-center px-2 py-0.5 rounded-[6px] text-xs font-medium bg-[#e6f5f3] text-[#0d9488]">
                              Current
                            </span>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="text-sm text-[#5a7d82]">
                        {splitLabel}
                      </TableCell>
                      <TableCell className="text-sm font-mono-display text-[#0c1a1e]">
                        {snapshot ? `${snapshot.frequencyPerWeek}x/week` : "—"}
                      </TableCell>
                      <TableCell>
                        {snapshot?.sessions && snapshot.sessions.length > 0 ? (
                          <div className="flex flex-wrap gap-1">
                            {snapshot.sessions.map((session, i) => (
                              <span
                                key={i}
                                className="inline-flex items-center px-1.5 py-0.5 rounded-[4px] text-[10px] font-medium bg-[rgba(13,148,136,0.05)] text-[#5a7d82]"
                              >
                                {session.name} ({session.exercises?.length || 0})
                              </span>
                            ))}
                          </div>
                        ) : (
                          <span className="text-[#93b0b4]">&mdash;</span>
                        )}
                      </TableCell>
                      <TableCell>
                        {index === 0 ? (
                          <span className="inline-flex items-center px-2 py-0.5 rounded-[6px] text-xs font-medium bg-[#e6f5f3] text-[#0d9488]">
                            Active
                          </span>
                        ) : (
                          <span className="inline-flex items-center px-2 py-0.5 rounded-[6px] text-xs font-medium bg-[#e6edec] text-[#93b0b4]">
                            Archived
                          </span>
                        )}
                      </TableCell>
                    </TableRow>
                    {entry.coachPrompt && (
                      <TableRow>
                        <TableCell colSpan={6} className="pt-0">
                          <p className="border-l-2 border-[#93b0b4]/30 pl-3 text-sm italic text-[#93b0b4]">
                            {entry.coachPrompt}
                          </p>
                        </TableCell>
                      </TableRow>
                    )}
                    {entry.clientMetricsSnapshot && (
                      <TableRow>
                        <TableCell colSpan={6} className="pt-0">
                          <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-[#93b0b4]">
                            {entry.clientMetricsSnapshot.weightKg != null && (
                              <span>Weight: {entry.clientMetricsSnapshot.weightKg.toFixed(1)}kg</span>
                            )}
                            {entry.clientMetricsSnapshot.bodyFatPercentage != null && (
                              <span>BF: {entry.clientMetricsSnapshot.bodyFatPercentage}%</span>
                            )}
                            {entry.clientMetricsSnapshot.goalWeightKg != null && (
                              <span>Goal: {entry.clientMetricsSnapshot.goalWeightKg.toFixed(1)}kg</span>
                            )}
                          </div>
                        </TableCell>
                      </TableRow>
                    )}
                  </Fragment>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
