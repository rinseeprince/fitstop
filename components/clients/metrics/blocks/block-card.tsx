"use client";

import { useState } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  CHIP_NEUTRAL_CLASS,
  COUNT_CHIP_CLASS,
  FOCUS_RING,
  LABEL_CLASS,
  MONO,
  MONO_LABEL_CLASS,
  MONO_META_CLASS,
  TEXT_PRIMARY,
  TEXT_SECONDARY,
  TRAINING_CARD_BORDER,
} from "@/components/clients/training/program-builder/builder-tokens";
import { formatBlockDate, formatBlockRange, splitDeficitPerDay } from "@/lib/blocks/block-format";
import { selectHeadlineFact } from "@/lib/blocks/block-headline";
import {
  BlockTimeline,
  deriveTimelineEntries,
  type BlockPlanDeleteTarget,
} from "./block-timeline";
import { PlanStateChip } from "./plan-state-chip";
import type { ClientBlockView } from "@/lib/blocks/block-derivations";
import type { BlockFacts, BlockNutritionFact } from "@/types/client-blocks";

// One block in the Journey list. Collapsed: identity + dates.
// Expanded: the Training / Nutrition fact columns + the timeline.
// Block names are SANS even when they contain digits ("Cut 2") — the digits
// belong to the name; dates, weeks and weights are mono via the tokens.

const HAIRLINE = "border-t border-[rgba(13,148,136,0.06)]";

type BlockCardProps = {
  block: ClientBlockView;
  color: string;
  facts: BlockFacts | undefined;
  factsLoading: boolean;
  factsError: boolean;
  defaultOpen: boolean;
  /** 3.4's delete affordance mounts here, inside the row but outside the
   *  expand toggle (buttons cannot nest). */
  rowAction?: React.ReactNode;
  /** The Journey round trip (7.3/7.4, H): the Training / Nutrition facts are
   *  the way into the apply and plan flows — the empty state's "place one" /
   *  "set targets", and the set state's "update plan" / "update targets"
   *  beside the value on its own line, which place a NEW plan from the block's
   *  first available day and supersede the standing one from there (never the
   *  amendment, which edits a placed program in place). One handler per track
   *  serves both states, in one grammar. Undefined, or a block that fails
   *  blockAcceptsSetup, leaves the empty state as plain text and the set state
   *  without its action. */
  onPlaceProgram?: () => void;
  onSetNutrition?: () => void;
  /** The per-plan delete (C3): a hover-revealed destructive icon on the
   *  timeline's active and upcoming rows, on the same gate as the way in
   *  (`blockAcceptsSetup` — current and future blocks only). Ended rows, block
   *  rows, elapsed and archived blocks carry none. Undefined = no icons. */
  onDeletePlan?: (plan: BlockPlanDeleteTarget) => void;
};

/**
 * Which blocks get a round-trip affordance on a fact, unset or set: CURRENT
 * and FUTURE only (owner decision 2026-08-21). Elapsed and archived keep plain
 * text — a plan cannot start before the deletion floor, so a finished block is
 * not even listed by the setup surfaces' Block field and the trip would land on
 * the dash; and it matches the read-only posture elapsed blocks already have
 * everywhere else (no delete offered, dates pinned from storage).
 */
function blockAcceptsSetup(block: ClientBlockView): boolean {
  return block.state !== "past" && block.archivedAt == null;
}

/**
 * The way in, in ONE grammar and ONE position (Session 7.3/7.4, H): the state
 * of the fact, then a dash, then the teal gesture to its right on the same
 * line. Unset: "No program placed — place one". Set: the value IS the state —
 * "Push Pull Legs — update plan", the numbers "— update targets" — so the word
 * sits exactly where the empty state's does (owner, 2026-09-11: "the same as
 * place one and set targets, which means it sits in the same position too, to
 * the right"). The whole line is the button, as in the empty state; only the
 * word turns on hover. It stays visible rather than hover-revealed — a coach
 * who has to hover to discover the door is exactly the problem this session
 * exists to fix — and it is never set in the label register, where it reads
 * as a title, and never on a line of its own under the value.
 */
function SetupPrompt({
  state,
  action,
  onClick,
}: {
  /** What is unset (muted, inherited) or the value in its own styling. */
  state: React.ReactNode;
  action: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "group rounded text-left text-xs text-[#93b0b4] transition-colors",
        FOCUS_RING
      )}
    >
      {state} &mdash;{" "}
      <span className="font-medium text-[#0d9488] group-hover:text-[#0b7f75]">
        {action}
      </span>
    </button>
  );
}

/** A version's target and deficit on one line, both in the target's weight,
 *  the units in the unit's — inline, so it can sit inside the way-in line. */
function NutritionValue({ fact }: { fact: BlockNutritionFact }) {
  return (
    <span className="inline-flex flex-wrap items-baseline gap-x-3">
      <span>
        <span className={cn(MONO, "text-[13px] font-semibold", TEXT_PRIMARY)}>
          {Math.round(fact.calories).toLocaleString()}
        </span>{" "}
        <span className={cn(MONO_META_CLASS, "text-[10px]")}>kcal</span>
      </span>
      {fact.deficitPerDay != null && (
        <span>
          <span className={cn(MONO, "text-[13px] font-semibold", TEXT_PRIMARY)}>
            {splitDeficitPerDay(fact.deficitPerDay).value}
          </span>{" "}
          <span className={cn(MONO_META_CLASS, "text-[10px]")}>
            {splitDeficitPerDay(fact.deficitPerDay).unit}
          </span>
        </span>
      )}
    </span>
  );
}

/**
 * ONE gate per track, consulted once: the handler reaches the empty state's
 * "place one" and the set state's "update plan" together, or neither — so the
 * two affordances cannot drift apart on which blocks offer them.
 */
function TrainingColumn({
  block,
  facts,
  factsLoading,
  factsError,
  onPlaceProgram,
}: Pick<
  BlockCardProps,
  "block" | "facts" | "factsLoading" | "factsError" | "onPlaceProgram"
>) {
  const setUp =
    onPlaceProgram && blockAcceptsSetup(block) ? onPlaceProgram : undefined;
  if (factsError) {
    return <p className="text-xs text-[#93b0b4]">Unavailable</p>;
  }
  if (!facts) {
    return factsLoading ? <p className="text-xs text-[#93b0b4]">Loading…</p> : null;
  }
  // ONE entry — the headline: the plan in force today, else the next one
  // queued in the block, else the last one that ran, so a program that ended
  // early with nothing after it still headlines its block, as ended, with the
  // door beside it (owner, 2026-09-11). The wire's whole list feeds the
  // timeline below. The way in rides the headline's line — the position the
  // empty state's line holds — and the state chip sits after the value only
  // when the headline is not in force: a running block's header already says
  // it is running. Under the value, the plan's own range, in the grammar the
  // card's header spells the block's.
  const shown = selectHeadlineFact(facts.training);
  if (!shown) {
    return setUp ? (
      <SetupPrompt state="No program placed" action="place one" onClick={setUp} />
    ) : (
      <p className="text-xs text-[#93b0b4]">No program placed</p>
    );
  }
  const value = (
    <span className={cn("text-xs font-medium", TEXT_PRIMARY)}>
      {shown.name}
      {shown.state !== "active" && (
        <PlanStateChip state={shown.state} className="ml-1.5" />
      )}
    </span>
  );
  return (
    <div>
      <p className="text-xs">
        {setUp ? (
          <SetupPrompt state={value} action="update plan" onClick={setUp} />
        ) : (
          value
        )}
      </p>
      <p className={cn(MONO_LABEL_CLASS, "normal-case tracking-normal")}>
        {formatBlockRange(shown.startsOn, shown.endsOn)}
      </p>
    </div>
  );
}

function NutritionColumn({
  block,
  facts,
  factsLoading,
  factsError,
  onSetNutrition,
}: Pick<
  BlockCardProps,
  "block" | "facts" | "factsLoading" | "factsError" | "onSetNutrition"
>) {
  const setUp =
    onSetNutrition && blockAcceptsSetup(block) ? onSetNutrition : undefined;
  if (factsError) {
    return <p className="text-xs text-[#93b0b4]">Unavailable</p>;
  }
  if (!facts) {
    return factsLoading ? <p className="text-xs text-[#93b0b4]">Loading…</p> : null;
  }
  // The training column's rule, entry for entry: one headline version by the
  // same precedence, the date under the numbers, the way in on its line.
  const shown = selectHeadlineFact(facts.nutrition);
  if (!shown) {
    return setUp ? (
      <SetupPrompt state="Not set" action="set targets" onClick={setUp} />
    ) : (
      <p className="text-xs text-[#93b0b4]">Not set</p>
    );
  }
  const value = (
    <>
      <NutritionValue fact={shown} />
      {shown.state !== "active" && (
        <PlanStateChip state={shown.state} className="ml-1.5" />
      )}
    </>
  );
  return (
    <div className="space-y-0.5">
      <p className="text-xs">
        {setUp ? (
          <SetupPrompt state={value} action="update targets" onClick={setUp} />
        ) : (
          value
        )}
      </p>
      <p className={cn(MONO_LABEL_CLASS, "normal-case tracking-normal")}>
        {formatBlockRange(shown.startsOn, shown.endsOn)}
      </p>
    </div>
  );
}

export function BlockCard(props: BlockCardProps) {
  const { block, color, facts, defaultOpen, rowAction, onDeletePlan } = props;
  const [open, setOpen] = useState(defaultOpen);
  const muted = block.state !== "current";
  // The same one gate the way in consults: a finished or archived block's
  // plans are history, and nothing on its timeline can be ended or removed.
  const deletePlan = onDeletePlan && blockAcceptsSetup(block) ? onDeletePlan : undefined;

  return (
    <div className={cn("group/row rounded-[6px] bg-white", TRAINING_CARD_BORDER)}>
      <div className="flex items-center">
        <button
          type="button"
          aria-expanded={open}
          onClick={() => setOpen((prev) => !prev)}
          className={cn(
            "flex min-w-0 flex-1 items-center gap-2.5 rounded-[6px] px-[11px] py-2.5 text-left",
            FOCUS_RING
          )}
        >
          <span
            className="h-2 w-2 shrink-0 rounded-full"
            style={{ backgroundColor: color, opacity: muted ? 0.45 : 1 }}
          />
          <span
            className={cn(
              "truncate text-[13px] font-semibold",
              muted ? TEXT_SECONDARY : TEXT_PRIMARY
            )}
          >
            {block.name}
          </span>
          {block.weekOfTotal && (
            <span className={cn(COUNT_CHIP_CLASS, "shrink-0")}>
              week {block.weekOfTotal.current} of {block.weekOfTotal.total}
            </span>
          )}
          {block.state === "future" && (
            <span className={cn(CHIP_NEUTRAL_CLASS, "shrink-0")}>Not started</span>
          )}
          <span className="flex-1" />
          <span
            className={cn(
              MONO_LABEL_CLASS,
              "shrink-0 normal-case tracking-normal"
            )}
          >
            {formatBlockDate(block.startsOn)} – {formatBlockDate(block.endsOn)} ·{" "}
            {block.weeks} {block.weeks === 1 ? "week" : "weeks"}
          </span>
          <ChevronDown
            className={cn(
              "h-3.5 w-3.5 shrink-0 text-[#93b0b4] transition-transform duration-200",
              open && "rotate-180"
            )}
            strokeWidth={1.5}
          />
        </button>
        {rowAction}
      </div>

      {open && (
        <div className={cn(HAIRLINE, "space-y-3 px-[11px] py-3")}>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <p className={cn(LABEL_CLASS, "mb-1.5")}>Training</p>
              <TrainingColumn {...props} />
            </div>
            <div>
              <p className={cn(LABEL_CLASS, "mb-1.5")}>Nutrition</p>
              <NutritionColumn {...props} />
            </div>
          </div>
          <div className={cn(HAIRLINE, "pt-3")}>
            <p className={cn(LABEL_CLASS, "mb-2")}>What happened</p>
            <BlockTimeline
              entries={deriveTimelineEntries(
                block,
                facts?.training ?? [],
                facts?.nutrition ?? []
              )}
              color={color}
              onDeletePlan={deletePlan}
            />
          </div>
        </div>
      )}
    </div>
  );
}
