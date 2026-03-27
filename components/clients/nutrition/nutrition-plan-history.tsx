"use client";

import { Fragment } from "react";
import useSWR from "swr";
import { swrFetcher } from "@/lib/swr-fetcher";
import {
  Accordion,
  AccordionItem,
  AccordionTrigger,
  AccordionContent,
} from "@/components/ui/accordion";
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { useNutritionBuilderContext } from "@/contexts/nutrition-builder-context";
import { format } from "date-fns";
import { History, Check, X } from "lucide-react";

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
  const { data, isLoading } = useSWR<HistoryResponse>(
    `/api/clients/${clientId}/nutrition/history`,
    swrFetcher,
    { revalidateOnFocus: false }
  );
  const builder = useNutritionBuilderContext();

  if (isLoading) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-14 w-full rounded-md" />
        <Skeleton className="h-14 w-full rounded-md" />
        <Skeleton className="h-14 w-full rounded-md" />
      </div>
    );
  }

  const groups = data?.data?.groups ?? [];

  if (groups.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-center">
        <div className="w-12 h-12 bg-muted rounded-full flex items-center justify-center mb-3">
          <History className="h-6 w-6 text-muted-foreground" />
        </div>
        <p className="text-sm text-muted-foreground">No nutrition plan history yet</p>
      </div>
    );
  }

  return (
    <div className="bg-card rounded-lg border border-border p-5">
    <Accordion type="multiple" defaultValue={[]}>
      {groups.map((group) => {
        const key = group.phaseId ?? "pre-roadmap";
        return (
          <AccordionItem key={key} value={key}>
            <AccordionTrigger className="hover:no-underline">
              <PhaseGroupHeader group={group} formatWeight={builder.formatWeight} />
            </AccordionTrigger>
            <AccordionContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Date</TableHead>
                    <TableHead>Label</TableHead>
                    <TableHead>Calories</TableHead>
                    <TableHead>Protein (g)</TableHead>
                    <TableHead>Carbs (g)</TableHead>
                    <TableHead>Fat (g)</TableHead>
                    <TableHead>Goal Source</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {group.plans.map((plan, index) => {
                    const label = index === 0 ? "Initial" : `Revision ${index}`;
                    return (
                      <Fragment key={plan.id}>
                        <TableRow>
                          <TableCell className="text-muted-foreground">
                            {format(new Date(plan.createdAt), "MMM d, yyyy")}
                          </TableCell>
                          <TableCell>{label}</TableCell>
                          <TableCell>{plan.baselineCalories.toLocaleString()}</TableCell>
                          <TableCell>{Math.round(plan.proteinTargetG)}</TableCell>
                          <TableCell>{Math.round(plan.carbTargetG)}</TableCell>
                          <TableCell>{Math.round(plan.fatTargetG)}</TableCell>
                          <TableCell>
                            {plan.goalSource === "phase" && (
                              <Badge variant="outline" className="text-xs">Phase</Badge>
                            )}
                            {plan.goalSource === "client" && (
                              <Badge variant="outline" className="text-xs">Client</Badge>
                            )}
                            {!plan.goalSource && (
                              <span className="text-muted-foreground">-</span>
                            )}
                          </TableCell>
                          <TableCell>
                            {plan.status === "active" ? (
                              <Badge variant="success" className="text-xs">Active</Badge>
                            ) : (
                              <span className="text-muted-foreground">Archived</span>
                            )}
                          </TableCell>
                        </TableRow>
                        {plan.coachNotes && (
                          <TableRow>
                            <TableCell colSpan={8} className="pt-0">
                              <p className="border-l-2 border-muted-foreground/30 pl-3 text-sm italic text-muted-foreground">
                                {plan.coachNotes}
                              </p>
                            </TableCell>
                          </TableRow>
                        )}
                      </Fragment>
                    );
                  })}
                </TableBody>
              </Table>
            </AccordionContent>
          </AccordionItem>
        );
      })}
    </Accordion>
    </div>
  );
}

function PhaseGroupHeader({
  group,
  formatWeight,
}: {
  group: PlanHistoryGroup;
  formatWeight: (kg: number) => string;
}) {
  const name = group.phaseId ? group.phaseName ?? "Phase" : "Pre-roadmap";

  const dateRange = group.startDate
    ? `${format(new Date(group.startDate), "MMM d")} – ${
        group.endDate
          ? format(new Date(group.endDate), "MMM d, yyyy")
          : group.phaseStatus === "active"
            ? "ongoing"
            : ""
      }`
    : null;

  const showWeight = group.phaseId != null && group.startWeight != null;

  return (
    <div className="flex-1 text-left">
      <div className="flex items-center gap-2">
        <span className="text-base font-semibold text-foreground">{name}</span>
        {dateRange && (
          <span className="text-sm text-muted-foreground">{dateRange}</span>
        )}
        {group.phaseStatus === "active" && (
          <Badge variant="success" className="text-xs">Active</Badge>
        )}
      </div>

      {showWeight && (
        <WeightContextLine group={group} formatWeight={formatWeight} />
      )}
    </div>
  );
}

function WeightContextLine({
  group,
  formatWeight,
}: {
  group: PlanHistoryGroup;
  formatWeight: (kg: number) => string;
}) {
  const parts: string[] = [];
  if (group.startWeight != null) parts.push(formatWeight(group.startWeight));
  if (group.phaseGoalWeight != null) parts.push(`Goal: ${formatWeight(group.phaseGoalWeight)}`);
  if (group.endWeight != null) {
    const label = group.phaseStatus === "completed" ? "Actual" : "Current";
    parts.push(`${label}: ${formatWeight(group.endWeight)}`);
  }
  let indicator: React.ReactNode = null;
  if (
    group.phaseStatus === "completed" &&
    group.phaseGoalWeight != null &&
    group.endWeight != null &&
    group.startWeight != null
  ) {
    const isDeficit = group.phaseGoalWeight < group.startWeight;
    const hit = isDeficit
      ? group.endWeight <= group.phaseGoalWeight
      : group.endWeight >= group.phaseGoalWeight;
    indicator = hit ? (
      <Check className="h-3.5 w-3.5 text-success inline ml-1" />
    ) : (
      <X className="h-3.5 w-3.5 text-destructive inline ml-1" />
    );
  }

  return (
    <p className="text-sm text-muted-foreground mt-0.5">
      {parts.join(" → ")}
      {indicator}
    </p>
  );
}
