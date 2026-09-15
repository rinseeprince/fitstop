"use client";

import { Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  FOCUS_RING,
  MONO_LABEL_CLASS,
  TEXT_SECONDARY,
} from "@/components/clients/training/program-builder/builder-tokens";
import { formatBlockRange, formatNutritionEra } from "@/lib/blocks/block-format";
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
// facts read. Every plan and version starting in the block is listed with its
// RANGE — the row's own window, start to end — and the state the wire stamped
// (Active / Planned / Ended), while the columns above headline one entry per
// track. Block boundaries are a single date. Edits to a plan are invisible by
// design (audit_logs has no readers).

/**
 * The plan a timeline row stands for — what the per-plan delete acts on
 * (C3): its track decides the route, its state the verb (a running plan is
 * ENDED at yesterday, a queued one REMOVED), its range the words. `name` is
 * the program's; a nutrition version carries none, so its rows say "the
 * nutrition targets" and name the range instead.
 */
export type BlockPlanDeleteTarget = {
  track: "training" | "nutrition";
  id: string;
  name: string | null;
  state: BlockPlanState;
  startsOn: string;
  endsOn: string;
};

/** The verb a plan's state earns: a running plan ends, a queued one is removed. */
export function planDeleteVerb(plan: Pick<BlockPlanDeleteTarget, "state">): "End" | "Remove" {
  return plan.state === "active" ? "End" : "Remove";
}

/** The icon's accessible name: "End Upper Lower", "Remove the nutrition targets". */
function planDeleteLabel(plan: BlockPlanDeleteTarget): string {
  return `${planDeleteVerb(plan)} ${plan.name ?? "the nutrition targets"}`;
}

interface BlockTimelineEntry {
  key: string;
  /** The entry's start — the sort key, and the one date a block boundary has. */
  date: string;
  /** A plan's or version's last day (the row's `effective_until`), so the date
   *  column reads as a range; a block boundary carries none. */
  endsOn?: string;
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
  /** The plan the row stands for; a block boundary stands for none. */
  plan?: BlockPlanDeleteTarget;
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
        endsOn: plan.endsOn,
        label: plan.name,
        state: plan.state,
        plan: {
          track: "training",
          id: plan.id,
          name: plan.name,
          state: plan.state,
          startsOn: plan.startsOn,
          endsOn: plan.endsOn,
        },
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
        endsOn: fact.endsOn,
        label: "Nutrition",
        state: fact.state,
        detail: formatNutritionEra({ calories: fact.calories, deficitPerDay: fact.deficitPerDay }),
        ...(fact.note ? { note: fact.note } : {}),
        plan: {
          track: "nutrition",
          id: fact.id,
          name: null,
          state: fact.state,
          startsOn: fact.startsOn,
          endsOn: fact.endsOn,
        },
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
  /**
   * The per-plan delete (C3): a hover-revealed destructive icon on the rows
   * whose plan is active or upcoming — never an ended row, never a block
   * boundary. The card hands it down for current and future blocks only
   * (`blockAcceptsSetup`); absent, no row carries an icon.
   */
  onDeletePlan?: (plan: BlockPlanDeleteTarget) => void;
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

export function BlockTimeline({ entries, color, onDeletePlan }: BlockTimelineProps) {
  if (entries.length === 0) {
    return <p className="text-xs text-[#93b0b4]">Nothing yet.</p>;
  }

  // Two columns for the whole list — the date column sized to its widest
  // entry, the rest beside it — with every row a subgrid over them, so a
  // plan's range and a boundary's single date share one column and the labels
  // line up down the list. A note sits in the label column by construction,
  // under its own entry, rather than at a hand-measured indent that only ever
  // matched a one-date column.
  return (
    <ul className="relative ml-1 grid grid-cols-[auto_minmax(0,1fr)] gap-x-2.5 gap-y-2 border-l border-[rgba(13,148,136,0.08)] pl-3.5">
      {entries.map((entry) => {
        // Only a plan still ahead can be ended or removed; an ended row and
        // a block boundary carry no icon.
        const deletable =
          onDeletePlan &&
          entry.plan &&
          (entry.plan.state === "active" || entry.plan.state === "upcoming")
            ? { plan: entry.plan, onDelete: onDeletePlan }
            : null;
        return (
          <li
            key={entry.key}
            className="group/entry relative col-span-2 grid grid-cols-subgrid items-baseline"
          >
            <span
              className="absolute -left-[19.5px] top-[3px] h-2 w-2 rounded-full border-2 border-white"
              style={{ backgroundColor: color }}
            />
            <span className={cn(MONO_LABEL_CLASS, "whitespace-nowrap normal-case tracking-normal")}>
              {formatBlockRange(entry.date, entry.endsOn ?? entry.date)}
            </span>
            <div>
              <div className="flex flex-wrap items-baseline gap-2.5">
                <span className={cn("text-xs", TEXT_SECONDARY)}>{entry.label}</span>
                {entry.state && <PlanStateChip state={entry.state} />}
                {entry.detail && (
                  <span className={cn(MONO_LABEL_CLASS, "normal-case tracking-normal")}>
                    {entry.detail}
                  </span>
                )}
                {deletable && (
                  // Destructive, rightmost, hover-revealed — the row-action
                  // grammar the block rows above already use.
                  <button
                    type="button"
                    aria-label={planDeleteLabel(deletable.plan)}
                    title={planDeleteLabel(deletable.plan)}
                    onClick={() => deletable.onDelete(deletable.plan)}
                    className={cn(
                      "ml-auto self-center rounded p-1 text-[#93b0b4] opacity-0 transition-colors hover:text-[#c06060] focus-visible:opacity-100 group-hover/entry:opacity-100",
                      FOCUS_RING
                    )}
                  >
                    <Trash2 className="h-3.5 w-3.5" strokeWidth={1.5} />
                  </button>
                )}
              </div>
              {/* In the label column, so a note reads as belonging to the row
                  above it rather than as its own dateless event. */}
              {entry.note && (
                <div className="mt-1.5">
                  <TimelineNote body={entry.note} />
                </div>
              )}
            </div>
          </li>
        );
      })}
    </ul>
  );
}
