"use client";

import { useEffect } from "react";
import useSWR from "swr";
import { swrFetcher } from "@/lib/swr-fetcher";
import type { Phase } from "@/types/roadmap";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { AlertCircle } from "lucide-react";

type PhaseSelectorProps = {
  clientId: string;
  value?: string;
  onChange: (phaseId: string | undefined) => void;
  onBlockSubmit?: (blocked: boolean) => void;
};

type PhasesResponse = {
  success: true;
  data: Phase[];
};

export function PhaseSelector({
  clientId,
  value,
  onChange,
  onBlockSubmit,
}: PhaseSelectorProps) {
  const { data, error, isLoading } = useSWR<PhasesResponse>(
    clientId ? `/api/clients/${clientId}/roadmap/phases` : null,
    swrFetcher,
    { revalidateOnFocus: false }
  );

  const is404 = error && "status" in error && (error as { status: number }).status === 404;
  const hasRoadmap = !is404 && !isLoading && data?.success;
  const selectablePhases =
    data?.data?.filter(
      (p) => p.status === "planned" || p.status === "active"
    ) ?? [];
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
  if (isLoading || is404 || !hasRoadmap) {
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
    return (
      <div className="space-y-1.5">
        <Label htmlFor="phase-selector" className="text-sm font-medium text-foreground">
          Roadmap Phase
        </Label>
        <Select
          value={value ?? ""}
          onValueChange={(v) => onChange(v || undefined)}
        >
          <SelectTrigger
            id="phase-selector"
            className="bg-card border-border rounded-lg focus:border-primary focus:ring-1 focus:ring-ring"
          >
            <SelectValue placeholder="Select a phase…" />
          </SelectTrigger>
          <SelectContent className="bg-card rounded-lg shadow-lg border border-border p-1">
            {selectablePhases.map((phase) => (
              <SelectItem
                key={phase.id}
                value={phase.id}
                className="rounded-lg cursor-pointer focus:bg-muted"
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
            ))}
          </SelectContent>
        </Select>
      </div>
    );
  }

  return null;
}
