"use client";

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
// lines. Checkboxes appear only under the "Pick exercises" scope and toggle by
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
            <div key={row.uid} className="flex items-center gap-2 px-3 py-1.5">
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
                <span className={cn(MONO, "whitespace-nowrap text-[11px]")}>
                  <span className={TEXT_SECONDARY}>{row.before}</span>
                  <span className={TEXT_SECONDARY}> → </span>
                  <span className="font-semibold text-[#0d9488]">{row.after}</span>
                </span>
              ) : (
                <span className={CHIP_NEUTRAL_CLASS}>No change</span>
              )}
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}
