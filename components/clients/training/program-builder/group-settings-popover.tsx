"use client";

import { SlidersHorizontal } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { SegmentedControl } from "@/components/programs/shared/segmented-control";
import { cn } from "@/lib/utils";
import { GROUP_NOTES_MAX, GROUP_REST_SECONDS_MAX } from "@/utils/exercise-groups";
import { MAX_SET_SPECS } from "@/utils/exercise-set-specs";
import { groupName } from "@/utils/exercise-group-display";
import type { ExerciseGroupDraft } from "./program-builder-types";
import type { GroupSettingsPatch } from "./program-builder-groups";
import { commitNum } from "./commit-input";
import {
  FOCUS_RING,
  LABEL_CLASS,
  MONO_INPUT_CLASS,
  MONO_LABEL_CLASS,
  TEXT_MUTED,
  TEXT_PRIMARY,
} from "./builder-tokens";

// A linked group's settings, from the settings button on its heading: Superset
// or Circuit (named by its size) or Straight sets, then its rounds, rests and
// notes. Every field writes straight through to the draft on blur, like every
// other field in the session editor, and the heading behind reads the new
// values at once. Rounds and the rest between rounds belong to a superset or
// circuit only.
//
// The inputs are uncontrolled and keyed by the value they show, so a value the
// draft changes — here or by the assistant — remounts them. A blur puts the
// draft's value back before writing: the write, when it lands, remounts the
// input with the new value in the same render; when it is refused (a toast
// says why) the input already shows what the draft still holds.
type GroupSettingsPopoverProps = {
  group: ExerciseGroupDraft;
  onUpdate: (patch: GroupSettingsPatch) => void;
};

const NUMBER_INPUT_CLASS = cn(MONO_INPUT_CLASS, "h-8 w-20 text-xs", FOCUS_RING);

export function GroupSettingsPopover({ group, onUpdate }: GroupSettingsPopoverProps) {
  const name = groupName(group.format, group.exercises.length);
  const looped = group.format === "circuit";
  const loopedName = groupName("circuit", group.exercises.length);

  const commitRest =
    (field: "restBetweenExercisesSeconds" | "restBetweenRoundsSeconds") =>
    (e: React.FocusEvent<HTMLInputElement>) => {
      const value = commitNum(e, { min: 0, max: GROUP_REST_SECONDS_MAX, int: true });
      const current = group[field];
      e.target.value = current == null ? "" : String(current);
      if (value !== current) onUpdate({ [field]: value });
    };

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={`${name} settings`}
          title={`${name} settings`}
          className={cn(
            "rounded p-1 transition-colors hover:text-[#0d9488] data-[state=open]:text-[#0d9488]",
            TEXT_MUTED,
            FOCUS_RING,
          )}
        >
          <SlidersHorizontal className="h-3.5 w-3.5" strokeWidth={1.5} />
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        sideOffset={6}
        className="w-[320px] rounded-[6px] border-[rgba(13,148,136,0.08)] p-0"
      >
        <div className="px-3.5 pb-2 pt-3">
          <div className={cn("text-sm font-semibold", TEXT_PRIMARY)}>{name}</div>
          <div className={cn("mt-0.5", MONO_LABEL_CLASS, "normal-case tracking-normal")}>
            {group.exercises.length} exercises
          </div>
        </div>
        <div className="space-y-3 px-3.5 pb-3.5">
          <SegmentedControl
            fullWidth
            options={[
              { value: "circuit", label: loopedName },
              { value: "straight_sets", label: "Straight sets" },
            ]}
            value={looped ? "circuit" : "straight_sets"}
            onChange={(format) =>
              onUpdate({ format: format === "straight_sets" ? "straight_sets" : "circuit" })
            }
          />
          {looped && (
            <label className="flex items-center justify-between gap-3">
              <span className={LABEL_CLASS}>Rounds</span>
              <Input
                key={`rounds-${group.uid}-${group.rounds}`}
                type="number"
                min={1}
                max={MAX_SET_SPECS}
                step={1}
                aria-label="Rounds"
                defaultValue={group.rounds ?? ""}
                className={NUMBER_INPUT_CLASS}
                onBlur={(e) => {
                  const value = commitNum(e, { min: 1, max: MAX_SET_SPECS, int: true });
                  e.target.value = group.rounds == null ? "" : String(group.rounds);
                  if (value != null && value !== group.rounds) onUpdate({ rounds: value });
                }}
              />
            </label>
          )}
          <label className="flex items-center justify-between gap-3">
            <span className={LABEL_CLASS}>Rest between exercises</span>
            <span className="flex items-center gap-1.5">
              <Input
                key={`rest-exercises-${group.uid}-${group.restBetweenExercisesSeconds}`}
                type="number"
                min={0}
                max={GROUP_REST_SECONDS_MAX}
                step={1}
                aria-label="Rest between exercises in seconds"
                defaultValue={group.restBetweenExercisesSeconds ?? ""}
                className={NUMBER_INPUT_CLASS}
                onBlur={commitRest("restBetweenExercisesSeconds")}
              />
              <span className={cn("text-[11px]", TEXT_MUTED)}>s</span>
            </span>
          </label>
          {looped && (
            <label className="flex items-center justify-between gap-3">
              <span className={LABEL_CLASS}>Rest between rounds</span>
              <span className="flex items-center gap-1.5">
                <Input
                  key={`rest-rounds-${group.uid}-${group.restBetweenRoundsSeconds}`}
                  type="number"
                  min={0}
                  max={GROUP_REST_SECONDS_MAX}
                  step={1}
                  aria-label="Rest between rounds in seconds"
                  defaultValue={group.restBetweenRoundsSeconds ?? ""}
                  className={NUMBER_INPUT_CLASS}
                  onBlur={commitRest("restBetweenRoundsSeconds")}
                />
                <span className={cn("text-[11px]", TEXT_MUTED)}>s</span>
              </span>
            </label>
          )}
          <label className={cn("flex flex-col gap-1", LABEL_CLASS)}>
            Notes
            <Textarea
              key={`notes-${group.uid}-${group.notes}`}
              maxLength={GROUP_NOTES_MAX}
              defaultValue={group.notes ?? ""}
              placeholder="How the client should do these together"
              className={cn("min-h-14 bg-white px-2 py-1.5 text-xs", FOCUS_RING)}
              onBlur={(e) => {
                const value = e.target.value.trim() || null;
                if (value !== group.notes) onUpdate({ notes: value });
              }}
            />
          </label>
        </div>
      </PopoverContent>
    </Popover>
  );
}
