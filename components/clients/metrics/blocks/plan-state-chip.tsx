import { cn } from "@/lib/utils";
import { CHIP_NEUTRAL_CLASS } from "@/components/clients/training/program-builder/builder-tokens";
import type { BlockPlanState } from "@/types/client-blocks";

// A plan's standing on the block card, in the design system's chip vocabulary
// (docs/newdesignsystem.md → Badges & chips): the status-active tint for a plan
// in force, the neutral chip — the card's own "Not started" — for one queued,
// the archived/inactive treatment for one that ran. Shared by the column
// headline and the timeline so the two cannot spell a state differently.

const PLAN_STATE_LABEL: Record<BlockPlanState, string> = {
  active: "Active",
  upcoming: "Planned",
  ended: "Ended",
};

const PLAN_STATE_CLASS: Record<BlockPlanState, string> = {
  active:
    "rounded-[4px] bg-[rgba(13,148,136,0.08)] px-1.5 py-px text-[10px] font-medium text-[#0d9488]",
  upcoming: CHIP_NEUTRAL_CLASS,
  ended:
    "rounded-[4px] bg-[rgba(0,0,0,0.03)] px-1.5 py-px text-[10px] font-medium text-[#93b0b4]",
};

export function PlanStateChip({
  state,
  className,
}: {
  state: BlockPlanState;
  className?: string;
}) {
  return (
    <span className={cn("shrink-0 whitespace-nowrap", PLAN_STATE_CLASS[state], className)}>
      {PLAN_STATE_LABEL[state]}
    </span>
  );
}
