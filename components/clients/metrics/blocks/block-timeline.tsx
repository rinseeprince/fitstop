"use client";

import { cn } from "@/lib/utils";
import {
  MONO_LABEL_CLASS,
  TEXT_SECONDARY,
} from "@/components/clients/training/program-builder/builder-tokens";
import { formatBlockDate, formatNutritionEra } from "@/lib/blocks/block-format";
import type { ClientBlockView } from "@/lib/blocks/block-derivations";
import type {
  BlockNutritionFact,
  BlockPlanState,
  BlockTrainingFact,
} from "@/types/client-blocks";
import { PlanStateChip } from "./plan-state-chip";

// "What happened" — the expanded block card's vertical timeline. Sources: block
// boundaries (derived), training placements in the window, and the nutrition
// versions that start in the window, each carrying its save note — all from the
// facts read. Every plan and version starting in the block is listed, each on
// its start date with the state the wire stamped (Active / Planned / Ended),
// while the columns above headline one entry per track. Plan amendments are
// invisible by design (audit_logs has no readers).

interface BlockTimelineEntry {
  key: string;
  date: string;
  label: string;
  /** Number-bearing data rendered beside the label, in mono. The label stays
   *  word-only and sans, so the two registers do not blur (design system:
   *  split the branches when the states are distinguishable). */
  detail?: string;
  /** A plan's or version's standing, as the wire stamped it — rendered as the
   *  chip after the label. Block boundaries carry none. */
  state?: BlockPlanState;
  /** The version's save note, rendered NESTED underneath its entry — no dot
   *  and no date of its own: it explains the change above it and is dated with
   *  it (migration 172). */
  note?: string;
}

export function deriveTimelineEntries(
  block: Pick<ClientBlockView, "id" | "startsOn" | "endsOn" | "state">,
  training: BlockTrainingFact[],
  nutrition: BlockNutritionFact[]
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
        label: plan.name,
        state: plan.state,
      });
    }
  }
  // What the client was eating, and when it changed — the question a coach
  // reviewing a finished block asks first. Each version carries the numbers off
  // its own row, so a later plan save cannot rewrite an entry that has already
  // happened. A version queued inside the block is listed the way a queued
  // program is, whether the block has begun or not, its state saying so; a
  // second version's date already says the targets changed. A version that
  // began before the block has no entry, as a crossing program has none — and
  // its note, dated at its start, stays with it. The note rides its own entry:
  // it explains that prescription change and nothing else, so a "Block
  // started" or a program's row is never its host.
  nutrition
    .filter((fact) => fact.startsOn >= block.startsOn && fact.startsOn <= block.endsOn)
    .forEach((fact) => {
      entries.push({
        key: `nutrition-${fact.id}`,
        date: fact.startsOn,
        label: "Nutrition",
        state: fact.state,
        detail: formatNutritionEra({ calories: fact.calories, deficitPerDay: fact.deficitPerDay }),
        ...(fact.note ? { note: fact.note } : {}),
      });
    });

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

/**
 * A version's note, nested under the entry it explains. No dot and no bullet:
 * the hierarchy is the point — a note is evidence for the change above it, not
 * a separate thing that happened — and no date of its own, because it is dated
 * with the change.
 *
 * Body styling follows the established coach note shape from the nutrition
 * calendar's note popover: whitespace preserved, 12.5px, 1.45 leading.
 */
function TimelineNote({ body }: { body: string }) {
  return (
    <p className="whitespace-pre-wrap text-[12.5px] leading-[1.45] text-[#0c1a1e]">
      {body}
    </p>
  );
}

export function BlockTimeline({ entries, color }: BlockTimelineProps) {
  if (entries.length === 0) {
    return <p className="text-xs text-[#93b0b4]">Nothing yet.</p>;
  }

  return (
    <ul className="relative ml-1 space-y-2 border-l border-[rgba(13,148,136,0.08)] pl-3.5">
      {entries.map((entry) => (
        <li key={entry.key} className="relative">
          <div className="flex items-baseline gap-2.5">
            <span
              className="absolute -left-[19.5px] top-[3px] h-2 w-2 rounded-full border-2 border-white"
              style={{ backgroundColor: color }}
            />
            <span className={cn(MONO_LABEL_CLASS, "normal-case tracking-normal shrink-0")}>
              {formatBlockDate(entry.date)}
            </span>
            <span className={cn("text-xs", TEXT_SECONDARY)}>{entry.label}</span>
            {entry.state && <PlanStateChip state={entry.state} />}
            {entry.detail && (
              <span className={cn(MONO_LABEL_CLASS, "normal-case tracking-normal")}>
                {entry.detail}
              </span>
            )}
          </div>
          {/* Indented to the label column, so a note reads as belonging to the
              row above it rather than as its own dateless event. */}
          {entry.note && (
            <div className="mt-1.5 pl-[52px]">
              <TimelineNote body={entry.note} />
            </div>
          )}
        </li>
      ))}
    </ul>
  );
}
