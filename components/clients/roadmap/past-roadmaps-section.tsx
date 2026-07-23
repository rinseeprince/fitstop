"use client";

import { useState } from "react";
import useSWR from "swr";
import { ChevronRight } from "lucide-react";
import { swrFetcher } from "@/lib/swr-fetcher";
import { cn } from "@/lib/utils";
import {
  COUNT_CHIP_CLASS,
  LABEL_CLASS,
  MONO_META_CLASS,
} from "@/components/clients/training/program-builder/builder-tokens";
import { PhaseCard } from "./phase-card";
import type { Roadmap, Phase } from "@/types/roadmap";

type RoadmapWithPhases = Roadmap & { phases: Phase[] };

type ArchivedResponse = {
  success: boolean;
  data: RoadmapWithPhases[];
};

type PastRoadmapsSectionProps = {
  clientId: string;
  weightUnit: "lbs" | "kg";
};

export const PastRoadmapsSection = ({
  clientId,
  weightUnit,
}: PastRoadmapsSectionProps) => {
  const [open, setOpen] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const { data } = useSWR<ArchivedResponse>(
    `/api/clients/${clientId}/roadmap/archived`,
    swrFetcher,
    { revalidateOnFocus: false }
  );

  const roadmaps = data?.data ?? [];

  // Nothing to show for a client that has never had a prior roadmap.
  if (roadmaps.length === 0) return null;

  return (
    <div className="mt-6">
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-2"
      >
        <ChevronRight
          className={`h-4 w-4 shrink-0 text-[#5a7d82] transition-transform duration-200 ${
            open ? "rotate-90" : ""
          }`}
        />
        <span className={LABEL_CLASS}>
          Past roadmaps
        </span>
        <span className={COUNT_CHIP_CLASS}>
          {roadmaps.length}
        </span>
      </button>

      {open && (
        <div className="space-y-2 mt-2">
          {roadmaps.map((rm) => {
            const isExpanded = expandedId === rm.id;
            const dateRange = [rm.startedAt, rm.targetEndDate]
              .filter(Boolean)
              .join(" → ");
            return (
              <div
                key={rm.id}
                className="bg-white rounded-[6px] border border-[rgba(13,148,136,0.08)]"
              >
                <button
                  onClick={() =>
                    setExpandedId(isExpanded ? null : rm.id)
                  }
                  className="w-full flex items-center gap-3 px-4 py-3"
                >
                  <ChevronRight
                    className={`h-4 w-4 shrink-0 text-[#5a7d82] transition-transform duration-200 ${
                      isExpanded ? "rotate-90" : ""
                    }`}
                  />
                  <span className="text-[14px] font-semibold text-[#0c1a1e] truncate">
                    {rm.name}
                  </span>
                  <span className="text-[11px] font-semibold text-[#5a7d82]">
                    {rm.status === "completed" ? "Completed" : "Archived"}
                  </span>
                  {dateRange && (
                    <span className={cn("ml-auto", MONO_META_CLASS, "text-[12px]")}>
                      {dateRange}
                    </span>
                  )}
                </button>

                {isExpanded && (
                  <div className="px-2 pb-2 space-y-2">
                    {rm.phases.length === 0 ? (
                      <p className="px-2 py-1 text-[12.5px] italic text-[#93b0b4]">
                        No phases.
                      </p>
                    ) : (
                      rm.phases.map((phase, index) => (
                        <PhaseCard
                          key={phase.id}
                          phase={phase}
                          clientId={clientId}
                          hasActivePhase={false}
                          weightUnit={weightUnit}
                          onUpdate={() => undefined}
                          index={index}
                          isReadOnly
                        />
                      ))
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
