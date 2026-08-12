"use client";

import { cn } from "@/lib/utils";
import {
  MONO_LABEL_CLASS,
  TEXT_SECONDARY,
} from "@/components/clients/training/program-builder/builder-tokens";
import { formatBlockDate } from "@/lib/blocks/block-format";
import type { ClientBlockView } from "@/lib/blocks/block-derivations";
import type { BlockTrainingFact } from "@/types/client-blocks";

// "What happened" — the expanded block card's vertical timeline. v1 sources:
// block boundaries (derived) + training placements in the window (from the
// facts read). Nutrition save notes join in Session 6; plan amendments are
// invisible by design (audit_logs has no readers). The coach-note quote block
// is deferred with the Session 6 note source.

export interface BlockTimelineEntry {
  key: string;
  date: string;
  label: string;
}

export function deriveTimelineEntries(
  block: Pick<ClientBlockView, "id" | "startsOn" | "endsOn" | "state">,
  training: BlockTrainingFact[]
): BlockTimelineEntry[] {
  const entries: BlockTimelineEntry[] = [];
  if (block.state !== "future") {
    entries.push({
      key: `${block.id}-start`,
      date: block.startsOn,
      label: "Block started",
    });
  }
  for (const plan of training) {
    if (plan.startsOn >= block.startsOn && plan.startsOn <= block.endsOn) {
      entries.push({
        key: `plan-${plan.id}`,
        date: plan.startsOn,
        label: `${plan.name} started`,
      });
    }
  }
  if (block.state === "past") {
    entries.push({
      key: `${block.id}-end`,
      date: block.endsOn,
      label: "Block ended",
    });
  }
  return entries.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}

type BlockTimelineProps = {
  entries: BlockTimelineEntry[];
  color: string;
};

export function BlockTimeline({ entries, color }: BlockTimelineProps) {
  if (entries.length === 0) {
    return <p className="text-xs text-[#93b0b4]">Nothing yet.</p>;
  }

  return (
    <ul className="relative ml-1 space-y-2 border-l border-[rgba(13,148,136,0.08)] pl-3.5">
      {entries.map((entry) => (
        <li key={entry.key} className="relative flex items-baseline gap-2.5">
          <span
            className="absolute -left-[19.5px] top-[3px] h-2 w-2 rounded-full border-2 border-white"
            style={{ backgroundColor: color }}
          />
          <span className={cn(MONO_LABEL_CLASS, "normal-case tracking-normal shrink-0")}>
            {formatBlockDate(entry.date)}
          </span>
          <span className={cn("text-xs", TEXT_SECONDARY)}>{entry.label}</span>
        </li>
      ))}
    </ul>
  );
}
