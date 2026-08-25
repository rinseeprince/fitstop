"use client";

import { cn } from "@/lib/utils";
import {
  MONO_LABEL_CLASS,
  TEXT_SECONDARY,
} from "@/components/clients/training/program-builder/builder-tokens";
import { formatBlockDate, formatNutritionEra } from "@/lib/blocks/block-format";
import type { ClientBlockView } from "@/lib/blocks/block-derivations";
import type { BlockNutritionFact, BlockTrainingFact } from "@/types/client-blocks";
import type { NutritionPlanNote } from "@/types/nutrition-plan-notes";

// "What happened" — the expanded block card's vertical timeline. Sources: block
// boundaries (derived), training placements in the window, the nutrition
// prescription era by era, and the coach's plan-save notes — all from the facts
// read. Plan amendments are invisible by design (audit_logs has no readers).

interface BlockTimelineEntry {
  key: string;
  date: string;
  label: string;
  /** Number-bearing data rendered beside the label, in mono. The label stays
   *  word-only and sans, so the two registers do not blur (design system:
   *  split the branches when the states are distinguishable). */
  detail?: string;
  /** The coach's notes explaining this entry, rendered NESTED underneath it —
   *  no dot, no date of their own unless it differs from the host's. A note is
   *  evidence for a prescription change, not a separate event. */
  notes?: NutritionPlanNote[];
}

/**
 * Attach each note to the LATEST nutrition entry dated at or before it.
 *
 * Not an exact-date match, which is the tempting rule and is wrong: `deriveEras`
 * omits an era whose numbers equal the previous one, so a re-save that carried a
 * note but changed no numbers has no same-date host, and under exact-match the
 * note would silently not appear. Hanging it off the preceding prescription
 * keeps it visible and reads correctly — the note accumulates under the targets
 * it discusses — and the nested row shows its own date whenever it differs from
 * its host's, so nothing is lost.
 *
 * A note with no nutrition entry at all to hang from (a block where no version
 * covers the reference date, so `nutrition` is null, or a future block whose
 * eras are skipped) is returned in `orphans` and gets its own dated entry. Rare,
 * but a client-visible note that silently fails to render is the one outcome
 * this feature cannot afford.
 */
function attachNotesToHosts(
  entries: BlockTimelineEntry[],
  notes: NutritionPlanNote[]
): { orphans: NutritionPlanNote[] } {
  const orphans: NutritionPlanNote[] = [];
  for (const note of notes) {
    let host: BlockTimelineEntry | null = null;
    for (const entry of entries) {
      if (entry.date > note.effectiveOn) continue;
      if (!host || entry.date >= host.date) host = entry;
    }
    if (!host) {
      orphans.push(note);
      continue;
    }
    host.notes = [...(host.notes ?? []), note];
  }
  return { orphans };
}

export function deriveTimelineEntries(
  block: Pick<ClientBlockView, "id" | "startsOn" | "endsOn" | "state">,
  training: BlockTrainingFact[],
  nutrition: BlockNutritionFact | null,
  notes: NutritionPlanNote[] = []
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
  // What the client was actually eating, and when it changed — the question a
  // coach reviewing a finished block asks first. Each era carries the numbers
  // off its own plan version, so a later plan save cannot rewrite an entry that
  // has already happened. A future block is skipped for the same reason its
  // "Block started" entry is: nothing has happened yet.
  const nutritionEntries: BlockTimelineEntry[] = [];
  if (block.state !== "future" && nutrition) {
    nutrition.eras.forEach((era, index) => {
      const entry: BlockTimelineEntry = {
        key: `nutrition-${block.id}-${era.from}`,
        date: era.from,
        label: index === 0 ? "Nutrition set" : "Nutrition changed",
        detail: formatNutritionEra(era),
      };
      nutritionEntries.push(entry);
      entries.push(entry);
    });
  }

  // Notes hang off the NUTRITION entries only — they explain a prescription
  // change, so a "Block started" or "Programme started" row is the wrong host.
  const { orphans } = attachNotesToHosts(nutritionEntries, notes);
  for (const note of orphans) {
    entries.push({
      key: `note-${note.id}`,
      date: note.effectiveOn,
      label: "Note",
      notes: [note],
    });
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

/**
 * A note, nested under the entry it explains. No dot and no bullet: the
 * hierarchy is the point — a note is evidence for the change above it, not a
 * separate thing that happened.
 *
 * The date renders only when it differs from the host entry's, which is the
 * ordinary case avoided (a note is usually dated exactly on the prescription
 * change it describes) and the dedup-orphan case served (a re-save that changed
 * no numbers hangs off an earlier era and needs to say when it was written).
 *
 * Body styling follows the established coach note shape from the nutrition
 * calendar's note popover: whitespace preserved, 12.5px, 1.45 leading.
 */
function TimelineNote({
  note,
  hostDate,
}: {
  note: NutritionPlanNote;
  hostDate: string;
}) {
  return (
    <div className="space-y-0.5">
      {note.effectiveOn !== hostDate && (
        <p className={cn(MONO_LABEL_CLASS, "normal-case tracking-normal")}>
          {formatBlockDate(note.effectiveOn)}
        </p>
      )}
      <p className="whitespace-pre-wrap text-[12.5px] leading-[1.45] text-[#0c1a1e]">
        {note.body}
      </p>
    </div>
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
            {entry.detail && (
              <span className={cn(MONO_LABEL_CLASS, "normal-case tracking-normal")}>
                {entry.detail}
              </span>
            )}
          </div>
          {/* Indented to the label column, so a note reads as belonging to the
              row above it rather than as its own dateless event. */}
          {entry.notes && entry.notes.length > 0 && (
            <div className="mt-1.5 space-y-2 pl-[52px]">
              {entry.notes.map((note) => (
                <TimelineNote key={note.id} note={note} hostDate={entry.date} />
              ))}
            </div>
          )}
        </li>
      ))}
    </ul>
  );
}
