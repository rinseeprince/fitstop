"use client";

import { SlidersHorizontal } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import {
  GROUP_FORMAT_SETTINGS,
  GROUP_INTERVAL_SECONDS_MAX,
  GROUP_NOTES_MAX,
  GROUP_REST_SECONDS_MAX,
  GROUP_TIME_CAP_SECONDS_MAX,
  type GroupFormat,
  type GroupSetting,
} from "@/utils/exercise-groups";
import { MAX_SET_SPECS } from "@/utils/exercise-set-specs";
import { formatDuration } from "@/utils/unit-conversions";
import { groupName } from "@/utils/exercise-group-display";
import type { ExerciseGroupDraft } from "./program-builder-types";
import type { GroupSettingsPatch } from "./program-builder-groups";
import { commitDuration, commitNum } from "./commit-input";
import {
  FOCUS_RING,
  LABEL_CLASS,
  MONO_INPUT_CLASS,
  MONO_LABEL_CLASS,
  TEXT_MUTED,
  TEXT_PRIMARY,
} from "./builder-tokens";

// A group's settings, from the settings button on its heading: its format —
// Superset or Circuit (named by its size), Straight sets, AMRAP, EMOM or For
// time — then the settings that format uses (GROUP_FORMAT_SETTINGS, the one
// table): rounds where the rows are rounds, a time cap and an interval typed as
// minutes or m:ss and read back as m:ss, rests typed in seconds, and notes.
// Every control on the card is one width, and a box says its grammar as its
// placeholder ("m:ss", "s") rather than beside it (owner, 2026-09-19). Every
// field writes straight through to the draft on blur, like every other field
// in the session editor, and the heading behind reads the new values at once.
// A format switch is one edit, so the heading, the grid and these rows change
// in one render.
//
// The card stays open until the coach clicks outside it or presses Escape
// (owner, 2026-09-19). Focus leaving it never closes it: a commit remounts the
// box it came from and can re-lay the grid behind, and the card must survive
// both — `onFocusOutside` is declined for that reason.
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

// One width for every control, so the card's boxes line up.
const CONTROL_WIDTH = "w-[140px]";
const NUMBER_INPUT_CLASS = cn(MONO_INPUT_CLASS, "h-8 text-xs", CONTROL_WIDTH, FOCUS_RING);
const ROW_CLASS = "flex items-center justify-between gap-3";

// The formats the dropdown offers, in this order; a superset or circuit only
// from two exercises. Straight sets on a group of one returns the exercise to
// a plain exercise.
const FORMATS: readonly GroupFormat[] = ["circuit", "straight_sets", "amrap", "emom", "for_time"];

export function GroupSettingsPopover({ group, onUpdate }: GroupSettingsPopoverProps) {
  const count = group.exercises.length;
  const name = groupName(group.format, count);
  const uses = new Set<GroupSetting>(GROUP_FORMAT_SETTINGS[group.format].uses);
  const formats = FORMATS.filter((format) => format !== "circuit" || count > 1);

  const commitRest =
    (field: "restBetweenExercisesSeconds" | "restBetweenRoundsSeconds") =>
    (e: React.FocusEvent<HTMLInputElement>) => {
      const value = commitNum(e, { min: 0, max: GROUP_REST_SECONDS_MAX, int: true });
      const current = group[field];
      e.target.value = current == null ? "" : String(current);
      if (value !== current) onUpdate({ [field]: value });
    };

  // A clock box: the AMRAP's cap and the EMOM's interval are what the format
  // is, so an emptied box is put back; a For time's cap is optional.
  const commitClock =
    (field: "timeCapSeconds" | "intervalSeconds", max: number, required: boolean) =>
    (e: React.FocusEvent<HTMLInputElement>) => {
      const current = group[field];
      const result = commitDuration(e, current, { min: 1, max, allowEmpty: !required });
      e.target.value = current == null ? "" : formatDuration(current);
      if (result.changed && result.seconds !== current) onUpdate({ [field]: result.seconds });
    };

  const clockRow = (
    field: "timeCapSeconds" | "intervalSeconds",
    label: string,
    max: number,
    required: boolean,
  ) => (
    <label className={ROW_CLASS}>
      <span className={LABEL_CLASS}>{label}</span>
      <Input
        key={`${field}-${group.uid}-${group[field]}`}
        type="text"
        inputMode="numeric"
        aria-label={`${label} in minutes and seconds`}
        placeholder="m:ss"
        defaultValue={group[field] == null ? "" : formatDuration(group[field])}
        className={NUMBER_INPUT_CLASS}
        onBlur={commitClock(field, max, required)}
      />
    </label>
  );

  const restRow = (
    field: "restBetweenExercisesSeconds" | "restBetweenRoundsSeconds",
    label: string,
  ) => (
    <label className={ROW_CLASS}>
      <span className={LABEL_CLASS}>{label}</span>
      <Input
        key={`${field}-${group.uid}-${group[field]}`}
        type="number"
        min={0}
        max={GROUP_REST_SECONDS_MAX}
        step={1}
        aria-label={`${label} in seconds`}
        placeholder="s"
        defaultValue={group[field] ?? ""}
        className={NUMBER_INPUT_CLASS}
        onBlur={commitRest(field)}
      />
    </label>
  );

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
        onFocusOutside={(event) => event.preventDefault()}
      >
        <div className="px-3.5 pb-2 pt-3">
          <div className={cn("text-sm font-semibold", TEXT_PRIMARY)}>{name}</div>
          <div className={cn("mt-0.5", MONO_LABEL_CLASS, "normal-case tracking-normal")}>
            {count} {count === 1 ? "exercise" : "exercises"}
          </div>
        </div>
        <div className="space-y-3 px-3.5 pb-3.5">
          <div className={ROW_CLASS}>
            <span className={LABEL_CLASS}>Format</span>
            <Select
              value={group.format}
              onValueChange={(format) => onUpdate({ format: format as GroupFormat })}
            >
              <SelectTrigger aria-label="Format" className={cn("h-8 text-xs", CONTROL_WIDTH)}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {formats.map((format) => (
                  <SelectItem key={format} value={format}>
                    {groupName(format, count)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {uses.has("rounds") && (
            <label className={ROW_CLASS}>
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
          {uses.has("timeCapSeconds") &&
            clockRow("timeCapSeconds", "Time cap", GROUP_TIME_CAP_SECONDS_MAX, group.format === "amrap")}
          {uses.has("intervalSeconds") &&
            clockRow("intervalSeconds", "Interval", GROUP_INTERVAL_SECONDS_MAX, true)}
          {uses.has("restBetweenExercisesSeconds") &&
            restRow("restBetweenExercisesSeconds", "Rest between exercises")}
          {uses.has("restBetweenRoundsSeconds") &&
            restRow("restBetweenRoundsSeconds", "Rest between rounds")}
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
