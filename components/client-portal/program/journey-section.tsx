"use client";

import { useUnits } from "@/contexts/units-context";
import { formatWeight, type UnitSystem } from "@/utils/unit-conversions";
import { formatBlockDate } from "@/lib/blocks/block-format";
import { daysBetween } from "@/utils/metric-points";
import type { ClientJourney, ClientJourneyBlock } from "@/types/client-journey";

// The client's journey view on the Program tab: the current block (name,
// focus, week-of-total, time progress, block target + long-term goal) and the
// finished blocks with their weight change — the same wording as the coach's
// Journey list, rendered in the client's own unit.
//
// Display parity discipline (see types/client-journey.ts): every delta is
// computed AFTER converting and rounding each endpoint to one decimal in the
// viewer's unit — the coach card subtracts pre-rounded points, and
// round(end − start) can differ from round(end) − round(start) by 0.1.

const signed = (n: number) => (n > 0 ? `+${n.toFixed(1)}` : n.toFixed(1));

/** Converted to the viewer's unit and rounded to 1dp — the coach series'
 *  point precision, so deltas subtract the same numbers the coach's do. */
function displayWeight(kg: number, preference: UnitSystem): number {
  return Number(formatWeight(kg, preference).value.toFixed(1));
}

function blockChange(
  block: ClientJourneyBlock,
  preference: UnitSystem
): number | null {
  if (block.startWeightKg == null || block.endWeightKg == null) return null;
  return (
    displayWeight(block.endWeightKg, preference) -
    displayWeight(block.startWeightKg, preference)
  );
}

/** "89.0 kg by 6 Sep, 0.9 kg to go" — the target-line tail after its label. */
function targetPhrase(
  targetKg: number,
  by: string | null,
  currentKg: number | null,
  preference: UnitSystem,
  unit: string
): string {
  const target = displayWeight(targetKg, preference);
  let phrase = `${target.toFixed(1)} ${unit}`;
  if (by) phrase += ` by ${formatBlockDate(by)}`;
  if (currentKg != null) {
    const toGo = Math.abs(displayWeight(currentKg, preference) - target);
    phrase += `, ${toGo.toFixed(1)} ${unit} to go`;
  }
  return phrase;
}

function TargetLine({ label, phrase }: { label: string; phrase: string }) {
  return (
    <p className="text-xs">
      <span className="font-medium text-foreground">{label}</span>{" "}
      <span className="font-mono-display text-muted-foreground">{phrase}</span>
    </p>
  );
}

/**
 * The coach's notes about the plan changes inside this block.
 *
 * Attribution framing, NOT the coach side's "Visible to X" — that copy tells a
 * coach who else reads the note, which is meaningless on the reader's own
 * screen.
 *
 * Nothing filters here: the wire already decided what the client may see (see
 * `ClientJourneyCurrentBlockNotes`). Rendering `journey.currentBlockNotes`
 * verbatim is the point — a filter here would be the policy leaking back into a
 * renderer, where RN cannot inherit it.
 */
function CoachNotes({ notes }: { notes: ClientJourney["currentBlockNotes"] }) {
  if (!notes || notes.notes.length === 0) return null;

  return (
    <div className="mt-3 space-y-2 border-t border-border pt-3">
      <p className="text-xs font-medium text-foreground">From your coach</p>
      {notes.notes.map((note) => (
        <div key={note.id} className="space-y-0.5">
          <p className="font-mono-display text-xs text-muted-foreground">
            {formatBlockDate(note.effectiveOn)}
          </p>
          <p className="whitespace-pre-wrap text-xs leading-relaxed text-foreground">
            {note.body}
          </p>
        </div>
      ))}
    </div>
  );
}

function CurrentBlockCard({
  block,
  journey,
  preference,
  unit,
}: {
  block: ClientJourneyBlock;
  journey: ClientJourney;
  preference: UnitSystem;
  unit: string;
}) {
  // The same clamped elapsed fraction derivePace uses, anchored on the wire's
  // clientToday — never the device day.
  const totalDays = daysBetween(block.startsOn, block.endsOn);
  const elapsedDays = daysBetween(block.startsOn, journey.clientToday);
  const fraction =
    totalDays <= 0 ? 1 : Math.min(1, Math.max(0, elapsedDays / totalDays));

  return (
    <div className="rounded-md border border-border bg-card p-4">
      <span className="text-sm font-semibold text-foreground">{block.name}</span>
      {block.focus && (
        <p className="mt-0.5 text-xs text-muted-foreground">{block.focus}</p>
      )}
      <p className="mt-1 font-mono-display text-xs text-muted-foreground">
        {block.weekOfTotal &&
          `Week ${block.weekOfTotal.current} of ${block.weekOfTotal.total} · `}
        ends {formatBlockDate(block.endsOn)}
      </p>
      <div className="mt-3 h-2 overflow-hidden rounded-full bg-muted">
        <div
          className="h-full rounded-full bg-primary"
          style={{ width: `${fraction * 100}%` }}
        />
      </div>
      <div className="mt-3 space-y-1">
        {block.targetWeightKg != null && (
          <TargetLine
            label="This block:"
            phrase={targetPhrase(
              block.targetWeightKg,
              block.endsOn,
              journey.currentWeightKg,
              preference,
              unit
            )}
          />
        )}
        {journey.goal.weightKg != null && (
          <TargetLine
            label="Your goal:"
            phrase={targetPhrase(
              journey.goal.weightKg,
              journey.goal.deadline,
              journey.currentWeightKg,
              preference,
              unit
            )}
          />
        )}
      </div>
      <CoachNotes notes={journey.currentBlockNotes} />
    </div>
  );
}

function FinishedBlockRow({
  block,
  preference,
  unit,
}: {
  block: ClientJourneyBlock;
  preference: UnitSystem;
  unit: string;
}) {
  const change = blockChange(block, preference);
  return (
    <div className="flex items-center gap-3 rounded-md border border-border bg-card p-3">
      <div className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium text-foreground">
          {block.name}
        </span>
        <span className="font-mono-display text-xs text-muted-foreground">
          {formatBlockDate(block.startsOn)} – {formatBlockDate(block.endsOn)} ·{" "}
          {block.weeks} {block.weeks === 1 ? "week" : "weeks"}
        </span>
      </div>
      <span className="shrink-0 font-mono-display text-xs text-muted-foreground">
        {change != null ? `${signed(change)} ${unit}` : "—"}
      </span>
    </div>
  );
}

export function JourneySection({ journey }: { journey: ClientJourney }) {
  const { preference } = useUnits();
  const unit = formatWeight(0, preference).unit;

  const current = journey.blocks.find((b) => b.state === "current") ?? null;
  const finished = journey.blocks.filter((b) => b.state === "past");
  if (!current && finished.length === 0) return null;

  return (
    <div className="flex flex-col gap-2">
      {current && (
        <CurrentBlockCard
          block={current}
          journey={journey}
          preference={preference}
          unit={unit}
        />
      )}
      {finished.length > 0 && (
        <div className="flex flex-col gap-2">
          <p className="mt-1 text-xs font-medium text-muted-foreground">
            Finished blocks
          </p>
          {finished.map((block) => (
            <FinishedBlockRow
              key={block.id}
              block={block}
              preference={preference}
              unit={unit}
            />
          ))}
        </div>
      )}
    </div>
  );
}
