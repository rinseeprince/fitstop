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
import { formatBlockDate, splitDeficitPerDay } from "@/lib/blocks/block-format";
import { BlockTimeline, deriveTimelineEntries } from "./block-timeline";
import type { BlockWeightFacts } from "@/lib/blocks/block-weight";
import type { BlockPace, ClientBlockView } from "@/lib/blocks/block-derivations";
import type { BlockFacts } from "@/types/client-blocks";

// One block in the Journey list. Collapsed: identity + dates + weight change.
// Expanded: the Training / Nutrition / Weight fact columns + the timeline.
// Block names are SANS even when they contain digits ("Cut 2") — the digits
// belong to the name; dates, weeks and weights are mono via the tokens.

const HAIRLINE = "border-t border-[rgba(13,148,136,0.06)]";

type BlockCardProps = {
  block: ClientBlockView;
  color: string;
  facts: BlockFacts | undefined;
  factsLoading: boolean;
  factsError: boolean;
  weight: BlockWeightFacts;
  pace: BlockPace | null;
  /** Block target converted to the viewer's unit; null = no target. */
  targetDisplay: number | null;
  weightUnit: string;
  defaultOpen: boolean;
  /** 3.4's delete affordance mounts here, inside the row but outside the
   *  expand toggle (buttons cannot nest). */
  rowAction?: React.ReactNode;
  /** The Journey round trip (7.3/7.4, H): the Training / Nutrition facts are
   *  the way into the apply and plan flows — the empty state's "place one" /
   *  "set targets", and the set state's "update plan" / "update targets"
   *  under the value, which place a NEW plan from the block's first available
   *  day and supersede the standing one from there (never the amendment, which
   *  edits a placed program in place). One handler per track serves both
   *  states, in one register. Undefined, or a block that fails
   *  blockAcceptsSetup, leaves the empty state as plain text and the set state
   *  without its action. */
  onPlaceProgram?: () => void;
  onSetNutrition?: () => void;
};

const signed = (n: number) => (n > 0 ? `+${n.toFixed(1)}` : n.toFixed(1));

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
 * The way in, in ONE register (Session 7.3/7.4, H): the empty state names what
 * is unset and offers the gesture that fixes it ("No program placed — place
 * one"); the set state offers the gesture alone under the value ("update
 * plan"), the same word treatment with no prefix — the value above it is the
 * state. The action word stays visible rather than hover-revealed — a coach
 * who has to hover to discover the door is exactly the problem this session
 * exists to fix — and it is never set in the label register: a small-caps word
 * beside the column label reads as a title, not a door (owner, 2026-09-11).
 */
function SetupPrompt({
  missing,
  action,
  onClick,
}: {
  /** What is unset; omitted on the set state, where the value says it. */
  missing?: string;
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
      {missing && <>{missing} &mdash;{" "}</>}
      <span className="font-medium text-[#0d9488] group-hover:text-[#0b7f75]">
        {action}
      </span>
    </button>
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
  if (facts.training.length === 0) {
    return setUp ? (
      <SetupPrompt
        missing="No program placed"
        action="place one"
        onClick={setUp}
      />
    ) : (
      <p className="text-xs text-[#93b0b4]">No program placed</p>
    );
  }
  return (
    <div className="space-y-1">
      <ul className="space-y-1">
        {facts.training.map((plan) => (
          <li key={plan.id}>
            <p className={cn("text-xs font-medium", TEXT_PRIMARY)}>{plan.name}</p>
            <p className={cn(MONO_LABEL_CLASS, "normal-case tracking-normal")}>
              from {formatBlockDate(plan.startsOn)}
            </p>
          </li>
        ))}
      </ul>
      {setUp && <SetupPrompt action="update plan" onClick={setUp} />}
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
  if (facts.nutrition.length === 0) {
    return setUp ? (
      <SetupPrompt
        missing="Not set"
        action="set targets"
        onClick={setUp}
      />
    ) : (
      <p className="text-xs text-[#93b0b4]">Not set</p>
    );
  }
  // One entry per version overlapping the block, the training column's shape:
  // a queued version lists under the running one with its own start.
  return (
    <div className="space-y-1">
      <ul className="space-y-1">
        {facts.nutrition.map((fact) => (
          <li key={fact.id} className="space-y-0.5">
            {/* Target and surplus/deficit on one line, both in the target's
                weight; the units in the unit's. The date sits under it, the
                training column's title-then-date grammar. */}
            <p className="flex flex-wrap items-baseline gap-x-3">
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
            </p>
            <p className={cn(MONO_LABEL_CLASS, "normal-case tracking-normal")}>
              from {formatBlockDate(fact.startsOn)}
            </p>
          </li>
        ))}
      </ul>
      {setUp && <SetupPrompt action="update targets" onClick={setUp} />}
    </div>
  );
}

function WeightColumn({
  block,
  weight,
  pace,
  targetDisplay,
  weightUnit,
}: Pick<
  BlockCardProps,
  "block" | "weight" | "pace" | "targetDisplay" | "weightUnit"
>) {
  const hasRange = weight.start != null && weight.end != null;
  const noData = !hasRange && targetDisplay == null;
  if (noData) {
    return <p className="text-xs text-[#93b0b4]">—</p>;
  }

  // Direction of travel decides the ahead/behind wording (goal-state.ts's
  // lesson): a negative delta is "ahead" in a cut, "behind" in a gain.
  const cutting =
    targetDisplay != null && weight.start != null
      ? targetDisplay < weight.start.value
      : null;
  const onPace = pace != null && Math.abs(pace.delta) < 0.05;
  const ahead =
    pace != null && cutting != null
      ? (cutting && pace.delta < 0) || (!cutting && pace.delta > 0)
      : null;

  return (
    <div className="space-y-0.5">
      {hasRange && (
        <p>
          <span className={cn(MONO, "text-[13px] font-semibold", TEXT_PRIMARY)}>
            {weight.start!.value.toFixed(1)} → {weight.end!.value.toFixed(1)}
          </span>{" "}
          <span className={cn(MONO_META_CLASS, "text-[10px]")}>{weightUnit}</span>
        </p>
      )}
      {targetDisplay != null && (
        <p className={cn(MONO_META_CLASS, "text-[11px]")}>
          Target {targetDisplay.toFixed(1)} {weightUnit}
        </p>
      )}
      {pace != null && block.state === "current" && (
        <>
          <p className={cn(MONO_META_CLASS, "text-[11px]")}>
            {Math.abs(pace.remaining).toFixed(1)} {weightUnit}{" "}
            {pace.remaining > 0 ? "above" : "below"} target ·{" "}
            {pace.weeksLeft.toFixed(1)} wk left
          </p>
          {onPace ? (
            <p className="text-[11px] text-[#5a7d82]">On pace</p>
          ) : (
            <p className={cn(MONO_META_CLASS, "text-[11px]")}>
              {Math.abs(pace.delta).toFixed(1)} {weightUnit}{" "}
              {ahead ? "ahead" : "behind"}
            </p>
          )}
        </>
      )}
      {pace != null && block.state === "past" && (
        <p className={cn(MONO_META_CLASS, "text-[11px]")}>
          {pace.remaining === 0
            ? "Finished on target"
            : `Finished ${Math.abs(pace.remaining).toFixed(1)} ${weightUnit} ${
                pace.remaining > 0 ? "above" : "below"
              } target`}
        </p>
      )}
      {pace == null && targetDisplay != null && block.state !== "future" && (
        <p className="text-[11px] text-[#93b0b4]">
          No weight logged before this block
        </p>
      )}
    </div>
  );
}

export function BlockCard(props: BlockCardProps) {
  const { block, color, facts, weight, defaultOpen, rowAction } = props;
  const [open, setOpen] = useState(defaultOpen);
  const muted = block.state !== "current";

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
          <span
            className={cn(
              MONO,
              "w-16 shrink-0 text-right text-[12px]",
              weight.change != null ? TEXT_SECONDARY : "text-[#c2d0cc]"
            )}
          >
            {weight.change != null ? `${signed(weight.change)} ${props.weightUnit}` : "—"}
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
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <div>
              <p className={cn(LABEL_CLASS, "mb-1.5")}>Training</p>
              <TrainingColumn {...props} />
            </div>
            <div>
              <p className={cn(LABEL_CLASS, "mb-1.5")}>Nutrition</p>
              <NutritionColumn {...props} />
            </div>
            <div>
              <p className={cn(LABEL_CLASS, "mb-1.5")}>Weight</p>
              <WeightColumn {...props} />
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
            />
          </div>
        </div>
      )}
    </div>
  );
}
