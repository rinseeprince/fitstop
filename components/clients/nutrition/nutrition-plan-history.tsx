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

type PlanHistoryPlan = {
  id: string;
  createdAt: string;
  status: string;
  baselineCalories: number;
  proteinTargetG: number;
  carbTargetG: number;
  fatTargetG: number;
  coachNotes: string | null;
  goalSource: "phase" | "client" | null;
};

type PlanHistoryGroup = {
  phaseId: string | null;
  phaseName: string | null;
  startDate: string | null;
  endDate: string | null;
  phaseGoalWeight: number | null;
  phaseStatus: string | null;
  startWeight: number | null;
  endWeight: number | null;
  plans: PlanHistoryPlan[];
};

type HistoryResponse = {
  success: boolean;
  data: { groups: PlanHistoryGroup[] };
};

type NutritionPlanHistoryProps = {
  clientId: string;
};

export function NutritionPlanHistory({ clientId }: NutritionPlanHistoryProps) {
  const [isOpen, setIsOpen] = useState(false);
  const { data, isLoading } = useSWR<HistoryResponse>(
    `/api/clients/${clientId}/nutrition/history`,
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

  const groups = data?.data?.groups ?? [];

  if (groups.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-center bg-white rounded-[6px]">
        <div className="w-12 h-12 bg-[#f0f5f4] rounded-full flex items-center justify-center mb-3">
          <History className="h-6 w-6 text-[#93b0b4]" />
        </div>
        <p className="text-sm text-[#93b0b4]">No nutrition plan history yet</p>
      </div>
    );
  }

  // Flatten all plans from all groups into a single array with derived labels
  const allPlans = groups.flatMap((group) =>
    group.plans.map((plan, index) => ({
      ...plan,
      label: index === 0 ? "Initial" : `Revision ${index}`,
      source: plan.goalSource === "phase" ? "Phase" : plan.goalSource === "client" ? "Client" : null,
    }))
  );

  const totalRevisions = allPlans.length;

  return (
    <div>
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
            {totalRevisions}
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
                <TableHead className="text-[11px] uppercase tracking-[0.06em] text-[#93b0b4] font-medium">Calories</TableHead>
                <TableHead className="text-[11px] uppercase tracking-[0.06em] text-[#93b0b4] font-medium">Protein</TableHead>
                <TableHead className="text-[11px] uppercase tracking-[0.06em] text-[#93b0b4] font-medium">Carbs</TableHead>
                <TableHead className="text-[11px] uppercase tracking-[0.06em] text-[#93b0b4] font-medium">Fat</TableHead>
                <TableHead className="text-[11px] uppercase tracking-[0.06em] text-[#93b0b4] font-medium">Source</TableHead>
                <TableHead className="text-[11px] uppercase tracking-[0.06em] text-[#93b0b4] font-medium">Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {allPlans.map((plan) => (
                <Fragment key={plan.id}>
                  <TableRow>
                    <TableCell className="text-sm text-[#93b0b4]">
                      {format(new Date(plan.createdAt), "MMM d, yyyy")}
                    </TableCell>
                    <TableCell className="text-sm font-medium text-[#0c1a1e]">
                      {plan.label}
                    </TableCell>
                    <TableCell className="text-sm font-mono-display text-[#0c1a1e]">
                      {plan.baselineCalories.toLocaleString()}
                    </TableCell>
                    <TableCell className="text-sm font-mono-display text-protein">
                      {Math.round(plan.proteinTargetG)}g
                    </TableCell>
                    <TableCell className="text-sm font-mono-display text-carbs">
                      {Math.round(plan.carbTargetG)}g
                    </TableCell>
                    <TableCell className="text-sm font-mono-display text-fat">
                      {Math.round(plan.fatTargetG)}g
                    </TableCell>
                    <TableCell>
                      {plan.source ? (
                        <span className="text-xs text-[#93b0b4]">{plan.source}</span>
                      ) : (
                        <span className="text-[#93b0b4]">&mdash;</span>
                      )}
                    </TableCell>
                    <TableCell>
                      {plan.status === "active" ? (
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
                  {plan.coachNotes && (
                    <TableRow>
                      <TableCell colSpan={8} className="pt-0">
                        <p className="border-l-2 border-[#93b0b4]/30 pl-3 text-sm italic text-[#93b0b4]">
                          {plan.coachNotes}
                        </p>
                      </TableCell>
                    </TableRow>
                  )}
                </Fragment>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
