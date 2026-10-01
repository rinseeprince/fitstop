"use client";

import { Suspense, useRef } from "react";
import { useSearchParams } from "next/navigation";
import { toast } from "sonner";

import { LockedDayNotice } from "@/components/client-portal/day/locked-day-notice";
import { habitDayGroups } from "@/components/client-portal/habits/habit-day-groups";
import { HabitEntryRow } from "@/components/client-portal/habits/habit-entry-row";
import { HabitsLoadError } from "@/components/client-portal/habits/habits-load-error";
import { SectionLabel } from "@/components/programs/shared/section-label";
import { Skeleton } from "@/components/ui/skeleton";
import {
  MONO,
  TEXT_PRIMARY,
  TEXT_SECONDARY,
  TRAINING_CARD_BORDER,
} from "@/components/clients/training/program-builder/builder-tokens";
import { useClientProfile } from "@/hooks/use-client-profile";
import { HabitEntryError, useClientHabitDayEntries } from "@/hooks/use-client-portal-habits";
import { canEditDay } from "@/lib/daily-log-permissions";
import {
  formatDateOnlyShort,
  getTodayDateStringInTimezone,
  parseDateParamOrToday,
  SHORT_WEEKDAY,
  weekdayOf,
} from "@/lib/date-helpers";
import { cn } from "@/lib/utils";
import type { ClientHabitDayItem, HabitAnswer } from "@/types/habits";

const CARD = cn("rounded-[6px] bg-white px-4", TRAINING_CARD_BORDER);

function HabitsDay() {
  const searchParams = useSearchParams();
  const date = parseDateParamOrToday(searchParams?.get("date") ?? null);

  const { client } = useClientProfile();
  const lockNotice = useRef<HTMLDivElement>(null);
  const timezone = client?.timezone ?? "UTC";
  // The day rule answers once for the whole day: habits lock with it. The
  // words "today" and "this week" are judged on the same calendar.
  const editable = canEditDay(date, client?.logsOpenFrom ?? null, timezone);
  const today = getTodayDateStringInTimezone(timezone);

  // Every habit a version covers on the date, planned that day or not, with
  // the client's changes not yet settled laid over it; no control waits for
  // a write in flight.
  const { day, error, retry, retrying, save, clear } = useClientHabitDayEntries(date);

  /** One write for one habit: the server's sentence on a refusal. */
  async function write(run: () => Promise<void>) {
    try {
      await run();
    } catch (err) {
      if (!(err instanceof HabitEntryError)) {
        // No answer came back: the browser's own words ("Failed to fetch") are
        // not the client's, so the page says what the other log pages say.
        console.error("[habits] entry write failed:", err);
        toast.error("Couldn't update habit", { description: "Network error. Please try again." });
      } else if (err.status === 403) {
        // The day locked underneath us (a check-in sent from another tab): the
        // hook read the day rule again and landed it with the habit it took
        // back, so the notice is on screen and the control just pressed is
        // disabled: the focus goes to the notice.
        toast.error("This day is locked", { description: err.message });
        lockNotice.current?.focus();
      } else {
        toast.error("Couldn't update habit", { description: err.message });
      }
    }
  }

  return (
    <>
      <p className={cn("mt-1 text-[12px]", MONO, TEXT_SECONDARY)}>{`${SHORT_WEEKDAY[weekdayOf(date)]} ${formatDateOnlyShort(date)}`}</p>

      {!editable ? <LockedDayNotice reason="locked" ref={lockNotice} /> : null}

      {/* A day already shown stays through a failed read of it. */}
      {day ? (
        <HabitGroups
          items={day.habits}
          date={date}
          today={today}
          locked={!editable}
          onAnswer={(item, answer) => void write(() => save(item, answer))}
          onClear={(item) => void write(() => clear(item))}
          onNote={(item, answer, note) => void write(() => save(item, answer, note))}
        />
      ) : error ? (
        <HabitsLoadError onRetry={retry} retrying={retrying} />
      ) : (
        <HabitGroupsSkeleton />
      )}
    </>
  );
}

interface HabitGroupsProps {
  items: ClientHabitDayItem[];
  date: string;
  today: string;
  locked: boolean;
  onAnswer: (item: ClientHabitDayItem, answer: HabitAnswer) => void;
  onClear: (item: ClientHabitDayItem) => void;
  onNote: (item: ClientHabitDayItem, answer: HabitAnswer, note: string | null) => void;
}

/** The day's habits in their groups, or the line saying the day has none. */
function HabitGroups({ items, date, today, locked, onAnswer, onClear, onNote }: HabitGroupsProps) {
  const groups = habitDayGroups(items, date, today);
  if (groups.length === 0) {
    return (
      <div className={cn(CARD, "mt-5 py-6")}>
        <p className={cn("text-[13px]", TEXT_SECONDARY)}>No habits on this day</p>
      </div>
    );
  }
  return (
    <div className="mt-5 space-y-5">
      {groups.map((group) => (
        <section key={group.key} aria-label={group.label}>
          <SectionLabel label={group.label} />
          <div className={cn(CARD, "divide-y divide-[rgba(13,148,136,0.06)]")}>
            {group.items.map((item) => (
              <HabitEntryRow
                key={item.habit.id}
                item={item}
                group={group.key}
                today={today}
                locked={locked}
                onAnswer={(answer) => onAnswer(item, answer)}
                onClear={() => onClear(item)}
                onNote={(answer, note) => onNote(item, answer, note)}
                onInvalid={(reason) => toast.error(`Couldn't save ${item.habit.name}`, { description: reason })}
              />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

/** The groups' place while the day's habits load: a group label and rows the height of a tick habit's. */
function HabitGroupsSkeleton() {
  return (
    <div className="mt-5">
      <Skeleton className="mb-3 h-[24.5px] w-full" />
      <div className={cn(CARD, "divide-y divide-[rgba(13,148,136,0.06)]")}>
        {[0, 1, 2].map((i) => (
          <div key={i} className="py-3">
            <Skeleton className="h-5 w-32" />
            <Skeleton className="mt-1 h-[18px] w-48" />
            <Skeleton className="mt-1.5 h-[18px] w-20" />
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * The habits page. Its heading is known before anything is read; the day it
 * names, and everything under it, waits for the address (`?date=`) inside the
 * boundary.
 */
export default function ClientHabitsPage() {
  return (
    <div>
      <h1 className={cn("text-[15px] font-semibold", TEXT_PRIMARY)}>Habits</h1>
      <Suspense
        fallback={
          <>
            <Skeleton className="mt-1 h-[18px] w-24" />
            <HabitGroupsSkeleton />
          </>
        }
      >
        <HabitsDay />
      </Suspense>
    </div>
  );
}
