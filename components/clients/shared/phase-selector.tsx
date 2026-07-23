"use client";

import { useEffect } from "react";
import useSWR from "swr";
import { swrFetcher } from "@/lib/swr-fetcher";
import type { Phase } from "@/types/roadmap";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { AlertCircle } from "lucide-react";
import { weightFromKg } from "@/utils/nutrition-helpers";
import { SECTION_LABEL_CLASS } from "@/components/clients/training/program-builder/builder-tokens";

type PhaseSelectorProps = {
  clientId: string;
  weightUnit?: "lbs" | "kg";
  value?: string;
  onChange: (phaseId: string | undefined) => void;
  onBlockSubmit?: (blocked: boolean) => void;
  phases?: Phase[];
  activeOnly?: boolean;
};

type PhasesResponse = {
  success: true;
  data: Phase[];
};

export function PhaseSelector({
  clientId,
  weightUnit = "lbs",
  value,
  onChange,
  onBlockSubmit,
  phases: externalPhases,
  activeOnly = false,
}: PhaseSelectorProps) {
  const { data, error, isLoading } = useSWR<PhasesResponse>(
    externalPhases ? null : (clientId ? `/api/clients/${clientId}/roadmap/phases` : null),
    swrFetcher,
    { revalidateOnFocus: false }
  );

  const allPhases = externalPhases ?? data?.data ?? [];
  const hasExternalData = !!externalPhases;
  const hasRoadmap = hasExternalData
    ? allPhases.length > 0
    : !isLoading && !error && data?.success && allPhases.length > 0;
  const selectablePhases = allPhases.filter(
    (p) => p.status === "planned" || p.status === "active"
  );
  const noSelectablePhases = hasRoadmap && selectablePhases.length === 0;
  const hasPhases = hasRoadmap && selectablePhases.length > 0;

  // Clear selection and unblock submit when no roadmap or no selectable phases
  useEffect(() => {
    if (!hasRoadmap) {
      onChange(undefined);
      onBlockSubmit?.(false);
    } else if (noSelectablePhases) {
      onChange(undefined);
      onBlockSubmit?.(true);
    } else {
      onBlockSubmit?.(false);
    }
  }, [hasRoadmap, noSelectablePhases]); // eslint-disable-line react-hooks/exhaustive-deps

  // No roadmap or still loading — render nothing
  if (!hasExternalData && (isLoading || error)) {
    return null;
  }
  if (!hasRoadmap) {
    return null;
  }

  // Roadmap exists but no selectable phases
  if (noSelectablePhases) {
    return (
      <div className="flex items-start gap-2 p-3 bg-amber-50 dark:bg-amber-950/30 rounded-lg">
        <AlertCircle className="h-4 w-4 text-amber-600 mt-0.5 flex-shrink-0" />
        <p className="text-xs text-foreground">
          No phases available. Add a phase to your roadmap first.
        </p>
      </div>
    );
  }

  // Roadmap with selectable phases — show dropdown
  if (hasPhases) {
    const selectedPhase = value
      ? selectablePhases.find((p) => p.id === value)
      : undefined;

    return (
      <div className="space-y-1.5">
        <label className={SECTION_LABEL_CLASS}>
          Roadmap Phase
        </label>
        <Select
          value={value ?? ""}
          onValueChange={(v) => onChange(v || undefined)}
        >
          <SelectTrigger
            id="phase-selector"
            className="bg-white border border-[rgba(13,148,136,0.08)] rounded-[6px] text-[13px] font-medium text-[#0c1a1e] focus:border-[rgba(13,148,136,0.25)] focus:shadow-[0_0_0_3px_rgba(13,148,136,0.06)] focus:ring-0 transition-all hover:border-[rgba(13,148,136,0.25)] [&>svg]:text-[#93b0b4] [&>svg]:hover:text-[#0d9488] [&>svg]:transition-colors"
          >
            <SelectValue placeholder="Select a phase..." />
          </SelectTrigger>
          <SelectContent className="bg-white rounded-[6px] shadow-lg border border-[rgba(13,148,136,0.08)] p-1">
            {selectablePhases.map((phase) => {
              const isDisabled = activeOnly && phase.status !== "active";

              if (isDisabled) {
                return (
                  <Tooltip key={phase.id}>
                    <TooltipTrigger asChild>
                      <div>
                        <SelectItem
                          value={phase.id}
                          disabled
                          className="rounded-[6px] opacity-50"
                        >
                          <span className="flex items-center gap-2">
                            {phase.name}
                            <Badge variant="secondary" className="text-[10px] px-1.5 py-0">
                              {phase.status}
                            </Badge>
                          </span>
                        </SelectItem>
                      </div>
                    </TooltipTrigger>
                    <TooltipContent>
                      Nutrition plans can only be created for the active phase
                    </TooltipContent>
                  </Tooltip>
                );
              }

              return (
                <SelectItem
                  key={phase.id}
                  value={phase.id}
                  className="rounded-[6px] cursor-pointer text-[13px] text-[#0c1a1e] focus:bg-[rgba(13,148,136,0.05)]"
                >
                  <span className="flex items-center gap-2">
                    {phase.name}
                    <Badge
                      variant={phase.status === "active" ? "default" : "secondary"}
                      className="text-[10px] px-1.5 py-0"
                    >
                      {phase.status}
                    </Badge>
                  </span>
                </SelectItem>
              );
            })}
          </SelectContent>
        </Select>
        {selectedPhase && (
          <p className="text-[11px] text-[#93b0b4] leading-[1.4]">
            {selectedPhase.phaseGoalWeight != null
              ? `Phase goal: ${weightFromKg(selectedPhase.phaseGoalWeight, weightUnit).toFixed(1)} ${weightUnit}${selectedPhase.endDate ? ` by ${selectedPhase.endDate}` : ""}`
              : "Using client\u2019s overall goal"}
          </p>
        )}
      </div>
    );
  }

  return null;
}
