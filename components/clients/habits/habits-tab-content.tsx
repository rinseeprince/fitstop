"use client";

import { useState } from "react";
import { Settings2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { HabitsManageDrawer } from "./habits-manage-drawer";
import { HabitsWeekNav } from "./habits-week-nav";
import { HabitsSummaryStrip } from "./habits-summary-strip";
import { HabitsWeekTracker } from "./habits-week-tracker";
import { habitFigure } from "./habit-figure";
import { useClientHabitList, useClientHabitWeek, useHabitWrites } from "@/hooks/use-client-habits";
import { addDaysToDateString } from "@/lib/date-helpers";
import type { Client } from "@/types/check-in";

type HabitsTabContentProps = {
  client: Client;
};

/** The days a client week runs. */
const WEEK_DAYS = 7;

/** The tab's Retry, wherever a read failed. */
const RETRY_BUTTON_CLASS = "text-[12px] border-[rgba(13,148,136,0.08)] text-[#5a7d82]";

/**
 * The coach's Habits tab: the week tracker over one client week — the one
 * holding the client's today, or an earlier one paged back to — its summary,
 * and the drawer that adds, changes, stops, deletes and orders the client's
 * habits. Every figure is the server's, from the habit kernel, on the
 * client's calendar.
 */
export const HabitsTabContent = ({ client }: HabitsTabContentProps) => {
  // The first day of the week paged back to; null is the week holding the
  // client's today, which the server resolves.
  const [pagedStart, setPagedStart] = useState<string | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);

  const { list, error: listError, isLoading: listLoading, retry: retryList } = useClientHabitList(client.id);
  const { week, error: weekError, isLoading: weekLoading, retry: retryWeek } = useClientHabitWeek(client.id, pagedStart);
  const writes = useHabitWrites(client.id);

  if (listError && weekError) {
    return (
      <div className="flex flex-col items-center justify-center py-12 space-y-3">
        <p className="text-[14px] font-medium text-[#0c1a1e]">Failed to load habits</p>
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            retryList();
            retryWeek();
          }}
          className={RETRY_BUTTON_CLASS}
        >
          Retry
        </Button>
      </div>
    );
  }

  // The week on screen: the one paged to, known from the click; else the
  // client's current week once the server has said which it is.
  const weekStart = pagedStart ?? week?.start ?? null;
  const weekEnd = weekStart === null ? null : addDaysToDateString(weekStart, WEEK_DAYS - 1);
  const clientToday = week?.clientToday ?? list?.clientToday ?? null;

  const pageBack = () => {
    if (weekStart !== null) setPagedStart(addDaysToDateString(weekStart, -WEEK_DAYS));
  };
  const pageForward = () => {
    if (pagedStart === null || clientToday === null) return;
    const next = addDaysToDateString(pagedStart, WEEK_DAYS);
    // The week holding the client's today is the current one: back to it.
    setPagedStart(addDaysToDateString(next, WEEK_DAYS - 1) >= clientToday ? null : next);
  };

  return (
    // Block flow, not space-y: the week-nav divider owns its own mb-3 (12px
    // below); a space-y margin would collapse against it.
    <div>
      {/* Dark summary strip — hero first, like every other tab (mb-4 = the
          divider spec's 16px above) */}
      <div className="mb-4">
        <HabitsSummaryStrip
          weekPending={weekLoading}
          listPending={listLoading}
          today={week?.today ? habitFigure(week.today.done, week.today.planned) : null}
          weeklyRate={week ? habitFigure(week.totals.met, week.totals.planned) : null}
          activeCount={list ? list.habits.filter((habit) => habit.status === "running").length : null}
        />
      </div>

      {/* Week-nav divider: nav left in the label slot, Manage Habits right */}
      <HabitsWeekNav
        weekStart={weekStart}
        weekEnd={weekEnd}
        canPrev={weekStart !== null}
        canNext={pagedStart !== null && clientToday !== null}
        onPrev={pageBack}
        onNext={pageForward}
        actions={
          // Quiet divider text action sized to the DividerPager meta (11px,
          // muted) — sans, not mono, per the words-are-sans typography rule.
          // A taller control would grow the row past 24.5px and sink the
          // hairline.
          <button
            type="button"
            onClick={() => setDrawerOpen(true)}
            disabled={!list}
            className="inline-flex items-center gap-1.5 whitespace-nowrap text-[11px] font-medium text-[#93b0b4] transition-colors hover:text-[#0d9488] disabled:pointer-events-none disabled:opacity-50"
          >
            <Settings2 className="h-3 w-3" strokeWidth={1.5} />
            Manage habits
          </button>
        }
      />

      {/* Week tracker table */}
      {weekError ? (
        <div className="bg-white rounded-[6px] p-5">
          <div className="h-24 flex flex-col items-center justify-center gap-2">
            <p className="text-[13px] text-[#93b0b4]">Failed to load tracker data</p>
            <Button variant="outline" size="sm" onClick={retryWeek} className={RETRY_BUTTON_CLASS}>
              Retry
            </Button>
          </div>
        </div>
      ) : (
        <HabitsWeekTracker
          habits={week?.habits ?? []}
          weekDays={week?.dates ?? []}
          today={week?.clientToday ?? ""}
          isLoading={weekLoading || !week}
        />
      )}

      {/* Manage drawer */}
      {list && (
        <HabitsManageDrawer open={drawerOpen} onOpenChange={setDrawerOpen} list={list} writes={writes} />
      )}
    </div>
  );
};
