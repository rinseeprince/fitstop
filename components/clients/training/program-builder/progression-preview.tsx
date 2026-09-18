"use client";

import { Fragment } from "react";
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";
import {
  CHIP_NEUTRAL_CLASS,
  MONO,
  MONO_LABEL_CLASS,
  TEXT_PRIMARY,
  TEXT_SECONDARY,
  TRAINING_CARD_BORDER,
} from "./builder-tokens";
import type { ProgressionPreviewSession } from "./progression-preview-model";

// Presentational preview for the duplicate-week progression dialog: one
// section per session, day by day, with per-exercise before → after diff
// lines — one line, or one per set under the name when the sets differ. Checkboxes appear only under the "Pick exercises" scope and toggle by
// scope KEY — the same exercise placed on two days moves together (identity
// semantics).
type ProgressionPreviewProps = {
  sessions: ProgressionPreviewSession[];
  showCheckboxes: boolean;
  selectedKeys: ReadonlySet<string>;
  onToggleKey: (key: string) => void;
};

export function ProgressionPreview({
  sessions,
  showCheckboxes,
  selectedKeys,
  onToggleKey,
}: ProgressionPreviewProps) {
  return (
    <div
      className={cn(
        "max-h-[40vh] overflow-y-auto rounded-[6px] bg-white",
        TRAINING_CARD_BORDER,
      )}
    >
      {sessions.map((session) => (
        // A day can hold several sessions: its day and place key the section.
        <div
          key={`${session.dayIndex}-${session.place}`}
          className="border-b border-[rgba(13,148,136,0.06)] last:border-b-0"
        >
          <div className={cn("px-3 pb-1 pt-2.5", MONO_LABEL_CLASS)}>
            Day {session.dayIndex + 1} · {session.sessionName}
          </div>
          {session.rows.map((row) => (
            <div key={row.uid} className="px-3 py-1.5">
              <div className="flex items-center gap-2">
                {showCheckboxes && (
                  <Checkbox
                    aria-label={`Include ${row.name} (Day ${session.dayIndex + 1})`}
                    checked={selectedKeys.has(row.scopeKey)}
                    onCheckedChange={() => onToggleKey(row.scopeKey)}
                    className="h-3.5 w-3.5"
                  />
                )}
                <span className={cn("min-w-0 flex-1 truncate text-xs font-semibold", TEXT_PRIMARY)}>
                  {row.name}
                </span>
                {row.changed && row.after ? (
                  // One line when one value says it all; the per-set lines
                  // below take over when the sets differ. A line that still
                  // doesn't fit wraps — nothing spills past the card.
                  row.perSet === null && (
                    <span className={cn(MONO, "min-w-0 text-right text-[11px]")}>
                      <span className={TEXT_SECONDARY}>{row.before}</span>
                      <span className={TEXT_SECONDARY}> → </span>
                      <span className="font-semibold text-[#0d9488]">{row.after}</span>
                    </span>
                  )
                ) : (
                  <span className={CHIP_NEUTRAL_CLASS}>No change</span>
                )}
              </div>
              {row.perSet && (
                // The same right-hand column as the one-line diff: one grid
                // pushed to the row's right edge — label · before · arrow ·
                // after — with the arrows lined up, so an exercise whose sets
                // differ sits exactly where its neighbours' diffs sit.
                <div
                  data-testid="per-set-diff"
                  className={cn(
                    MONO,
                    "ml-auto mt-1 grid w-fit max-w-full grid-cols-[auto_auto_auto_auto] items-baseline gap-x-2 gap-y-0.5 text-[11px]",
                  )}
                >
                  {row.perSet.map((line) => (
                    <Fragment key={line.label}>
                      <span className="text-[#93b0b4]">{line.label}</span>
                      <span className={cn("justify-self-end", TEXT_SECONDARY)}>{line.before}</span>
                      <span className={TEXT_SECONDARY}>→</span>
                      <span className="font-semibold text-[#0d9488]">{line.after}</span>
                    </Fragment>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}
