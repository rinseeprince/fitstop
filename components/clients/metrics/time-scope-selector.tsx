"use client";

import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { RoadmapWithPhases, TimeScope } from "@/lib/metrics/resolve-time-scope";

type TimeScopeSelectorProps = {
  scope: TimeScope;
  onChange: (scope: TimeScope) => void;
  roadmaps: RoadmapWithPhases[];
};

// One control drives both the body/wellness trend charts and the exercise
// progression charts (Sessions 7.5 / 7.7). Options are grouped:
// All time → Program (per roadmap) → Phase (children) → relative presets.
// A single-phase program collapses to one row (no redundant parent+child); the
// Program/Phase groups disappear entirely when the client has no roadmap.

function encode(scope: TimeScope): string {
  switch (scope.kind) {
    case "all":
      return "all";
    case "relative":
      return `relative:${scope.days}`;
    case "program":
      return `program:${scope.roadmapId}`;
    case "phase":
      return `phase:${scope.phaseId}`;
  }
}

function decode(value: string): TimeScope {
  if (value === "all") return { kind: "all" };
  const [kind, rest] = value.split(":");
  if (kind === "relative") return { kind: "relative", days: Number(rest) as 7 | 30 | 90 };
  if (kind === "program") return { kind: "program", roadmapId: rest };
  if (kind === "phase") return { kind: "phase", phaseId: rest };
  return { kind: "all" };
}

const TRIGGER_CLASS =
  "w-[220px] bg-white border border-[rgba(13,148,136,0.08)] rounded-[6px] text-[13px] font-medium text-[#0c1a1e] focus:border-[rgba(13,148,136,0.25)] focus:shadow-[0_0_0_3px_rgba(13,148,136,0.06)] focus:ring-0 transition-all hover:border-[rgba(13,148,136,0.25)] [&>svg]:text-[#93b0b4] [&>svg]:hover:text-[#0d9488] [&>svg]:transition-colors";

const ITEM_CLASS =
  "rounded-[6px] cursor-pointer text-[13px] text-[#0c1a1e] focus:bg-[rgba(13,148,136,0.05)]";

export function TimeScopeSelector({ scope, onChange, roadmaps }: TimeScopeSelectorProps) {
  const roadmapsWithPhases = roadmaps.filter((r) => r.phases.length > 0);

  return (
    <Select value={encode(scope)} onValueChange={(v) => onChange(decode(v))}>
      <SelectTrigger className={TRIGGER_CLASS} aria-label="Time scope">
        <SelectValue />
      </SelectTrigger>
      <SelectContent className="bg-white rounded-[6px] shadow-lg border border-[rgba(13,148,136,0.08)] p-1">
        <SelectItem value="all" className={ITEM_CLASS}>
          All time
        </SelectItem>

        {roadmapsWithPhases.map((roadmap) => {
          const phases = [...roadmap.phases].sort((a, b) => a.orderIndex - b.orderIndex);

          // Single-phase program → one collapsed row (no parent+child duplication).
          if (phases.length === 1) {
            return (
              <SelectItem key={roadmap.id} value={`program:${roadmap.id}`} className={ITEM_CLASS}>
                {roadmap.name}
              </SelectItem>
            );
          }

          return (
            <SelectGroup key={roadmap.id}>
              <SelectLabel className="text-[10.5px] uppercase tracking-[0.07em] font-semibold text-[#93b0b4]">
                {roadmap.name}
              </SelectLabel>
              <SelectItem value={`program:${roadmap.id}`} className={ITEM_CLASS}>
                Whole program
              </SelectItem>
              {phases.map((phase) => (
                <SelectItem key={phase.id} value={`phase:${phase.id}`} className={`${ITEM_CLASS} pl-6`}>
                  {phase.name}
                </SelectItem>
              ))}
            </SelectGroup>
          );
        })}

        <SelectGroup>
          <SelectLabel className="text-[10.5px] uppercase tracking-[0.07em] font-semibold text-[#93b0b4]">
            Recent
          </SelectLabel>
          <SelectItem value="relative:7" className={ITEM_CLASS}>
            Last 7 days
          </SelectItem>
          <SelectItem value="relative:30" className={ITEM_CLASS}>
            Last 30 days
          </SelectItem>
          <SelectItem value="relative:90" className={ITEM_CLASS}>
            Last 90 days
          </SelectItem>
        </SelectGroup>
      </SelectContent>
    </Select>
  );
}
