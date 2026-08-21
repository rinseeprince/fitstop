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
import { formatBlockDate, formatDeficitPerDay } from "@/lib/blocks/block-format";
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
  /** The Journey round trip (7.3): the Training empty state becomes the way
   *  into the apply flow. Undefined leaves it as plain text. */
  onPlaceProgram?: () => void;
};

const signed = (n: number) => (n > 0 ? `+${n.toFixed(1)}` : n.toFixed(1));

/**
 * Which blocks get a round-trip affordance on an unset fact: CURRENT and
 * FUTURE only (owner decision 2026-08-21). Elapsed and archived keep plain
 * text — placement writes from a chosen start date, not the block's window, so
 * a click on a finished block leads somewhere confusing, and it matches the
 * read-only posture elapsed blocks already have everywhere else (no delete
 * offered, dates pinned from storage).
 */
export function blockAcceptsSetup(block: ClientBlockView): boolean {
  return block.state !== "past" && block.archivedAt == null;
}

/**
 * The empty state IS the way in (Session 7.3/7.4): one target that names what
 * is unset and offers the gesture that fixes it. The action word stays visible
 * rather than hover-revealed — a coach who has to hover to discover the door
 * is exactly the problem this session exists to fix.
 */
function SetupPrompt({
  missing,
  action,
  onClick,
}: {
  missing: string;
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
      {missing} &mdash;{" "}
      <span className="font-medium text-[#0d9488] group-hover:text-[#0b7f75]">
        {action}
      </span>
    </button>
  );
}

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
  if (factsError) {
    return <p className="text-xs text-[#93b0b4]">Unavailable</p>;
  }
  if (!facts) {
    return factsLoading ? <p className="text-xs text-[#93b0b4]">Loading…</p> : null;
  }
  if (facts.training.length === 0) {
    return onPlaceProgram && blockAcceptsSetup(block) ? (
      <SetupPrompt
        missing="No program placed"
        action="place one"
        onClick={onPlaceProgram}
      />
    ) : (
      <p className="text-xs text-[#93b0b4]">No program placed</p>
    );
  }
  return (
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
  );
}

function NutritionColumn({
  facts,
  factsLoading,
  factsError,
}: Pick<BlockCardProps, "facts" | "factsLoading" | "factsError">) {
  if (factsError) {
    return <p className="text-xs text-[#93b0b4]">Unavailable</p>;
  }
  if (!facts) {
    return factsLoading ? <p className="text-xs text-[#93b0b4]">Loading…</p> : null;
  }
  const fact = facts.nutrition;
  if (!fact) {
    return <p className="text-xs text-[#93b0b4]">Not set</p>;
  }
  const deficit = fact.deficitPerDay;
  return (
    <div className="space-y-0.5">
      <p>
        <span className={cn(MONO, "text-[13px] font-semibold", TEXT_PRIMARY)}>
          {Math.round(fact.calories).toLocaleString()}
        </span>{" "}
        <span className={cn(MONO_META_CLASS, "text-[10px]")}>kcal</span>
      </p>
      {deficit != null && (
        <p className={cn(MONO_META_CLASS, "text-[11px]")}>
          {formatDeficitPerDay(deficit)}
        </p>
      )}
      {fact.changeCount > 0 && (
        <p className={cn(MONO_LABEL_CLASS, "normal-case tracking-normal")}>
          {fact.changeCount === 1 && fact.lastChangedOn
            ? `Changed ${formatBlockDate(fact.lastChangedOn)}`
            : `Changed ${fact.changeCount}×`}
        </p>
      )}
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
                facts?.nutrition ?? null,
                facts?.notes ?? []
              )}
              color={color}
            />
          </div>
        </div>
      )}
    </div>
  );
}
