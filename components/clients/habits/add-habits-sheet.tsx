"use client";

import { useState } from "react";
import { ListPlus, Loader2, Plus, X } from "lucide-react";
import { toast } from "sonner";
import { Sheet, SheetClose, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { SectionLabel } from "@/components/programs/shared/section-label";
import { isCalendarDay } from "@/lib/date-helpers";
import { useClientHabitChoices, type HabitWrites } from "@/hooks/use-client-habits";
import { choiceDraft, choiceKey, newHabitDraft, readAddBatch, type ChoiceDraft, type NewHabitDraft } from "./add-habits-draft";
import { HabitChoiceRow } from "./habit-choice-row";
import { HabitLoadError } from "./habit-load-error";
import { HabitDayField } from "./habit-schedule-fields";
import { NewHabitCard } from "./new-habit-card";

type AddHabitsSheetProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  clientId: string;
  /** The client's today: the first day the habits can start, and the day they start unless the coach picks a later one. */
  clientToday: string;
  writes: HabitWrites;
};

/**
 * + Add habits: one or more habits at once. **Your habits** lists every habit
 * the coach has given any client, less the ones this client has running or
 * planned (`GET …/habits/choices`) — ticked several at a time, each arriving
 * with its newest version's how-to, days and target to adjust for this
 * client; **New habit** adds habits typed in. One **Starts on** day, floored
 * on the client's today, and one save adds them all: its answer lands and the
 * sheet closes in the same tick; a refusal leaves it open with its reason.
 * At the coach's side-tray width (components/side-tray-width.test.ts). The
 * host keys it by its opening, so each open starts empty.
 */
export function AddHabitsSheet({ open, onOpenChange, clientId, clientToday, writes }: AddHabitsSheetProps) {
  const { choices, error, isLoading, retry } = useClientHabitChoices(clientId, open);
  const [picked, setPicked] = useState<Map<string, ChoiceDraft>>(new Map());
  const [added, setAdded] = useState<NewHabitDraft[]>([]);
  const [nextKey, setNextKey] = useState(1);
  const [startsOn, setStartsOn] = useState(clientToday);
  const [isPending, setIsPending] = useState(false);

  const count = picked.size + added.length;

  const toggle = (key: string, draft: ChoiceDraft) =>
    setPicked((current) => {
      const next = new Map(current);
      if (next.has(key)) next.delete(key);
      else next.set(key, draft);
      return next;
    });

  const addNew = () => {
    setAdded((current) => [...current, newHabitDraft(nextKey)]);
    setNextKey((key) => key + 1);
  };

  const save = async () => {
    if (!isCalendarDay(startsOn) || startsOn < clientToday) {
      toast.error("Could not add the habits", { description: "Pick today or a later day to start from." });
      return;
    }
    const batch = readAddBatch(
      (choices ?? []).flatMap((choice) => {
        const draft = picked.get(choiceKey(choice));
        return draft ? [{ choice, draft }] : [];
      }),
      added
    );
    if ("error" in batch) {
      toast.error("Could not add the habits", { description: batch.error });
      return;
    }
    setIsPending(true);
    try {
      const answer = await writes.add(batch.habits, startsOn === clientToday ? undefined : startsOn);
      writes.land(answer);
      onOpenChange(false);
      toast.success(batch.habits.length === 1 ? `"${batch.habits[0].name}" added` : `${batch.habits.length} habits added`);
    } catch (failure) {
      toast.error("Could not add the habits", { description: failure instanceof Error ? failure.message : "Something went wrong" });
      setIsPending(false);
    }
  };

  return (
    <Sheet open={open} onOpenChange={(next) => !isPending && onOpenChange(next)}>
      <SheetContent
        side="right"
        hideClose
        overlayClassName="bg-[rgba(15,32,39,0.35)] backdrop-blur-[2px]"
        // The coach's side-tray width, the nutrition plan tray's
        // (nutrition-settings-drawer.tsx): w-[420px] under the sheet's own cap
        // on a right-hand panel (sm:max-w-sm, sheet.tsx), left in place, so
        // both render 384px on a desktop screen.
        className="w-[420px] bg-[#f4f7f6] p-0 gap-0 flex flex-col inset-y-0 right-0 h-full animate-drawer-slide-in data-[state=closed]:slide-out-to-right data-[state=closed]:duration-300"
      >
        <SheetHeader className="sr-only">
          <SheetTitle>Add habits</SheetTitle>
          <SheetDescription>Your habits, or a new one, from a day.</SheetDescription>
        </SheetHeader>

        {/* Dark header */}
        <div className="bg-[#0f2027] px-6 pt-5 pb-5 flex-shrink-0">
          <div className="flex items-start gap-3">
            <div className="w-[28px] h-[28px] rounded-[6px] bg-[rgba(13,148,136,0.15)] flex items-center justify-center flex-shrink-0">
              <ListPlus className="w-[15px] h-[15px] text-[#0d9488]" strokeWidth={1.5} />
            </div>
            <h2 className="flex-1 min-w-0 text-[16px] font-bold text-white leading-tight">Add habits</h2>
            <SheetClose
              disabled={isPending}
              className="w-[32px] h-[32px] rounded-[6px] bg-[rgba(255,255,255,0.06)] flex items-center justify-center flex-shrink-0 hover:bg-[rgba(255,255,255,0.1)] transition-colors"
            >
              <X className="w-4 h-4 text-[rgba(255,255,255,0.5)]" strokeWidth={1.5} />
              <span className="sr-only">Close</span>
            </SheetClose>
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-5 pt-5 pb-6 space-y-6">
          <section>
            <SectionLabel label="Your habits" />
            {error ? (
              <div className="py-6">
                <HabitLoadError message="Failed to load your habits" onRetry={retry} />
              </div>
            ) : isLoading || choices === null ? (
              <div className="space-y-2" data-testid="habit-choices-loading">
                {Array.from({ length: 3 }).map((_, i) => (
                  <Skeleton key={i} className="h-[54px] w-full" />
                ))}
              </div>
            ) : choices.length === 0 ? (
              <p className="py-4 text-center text-[13px] text-[#93b0b4]">No other habits to reuse yet</p>
            ) : (
              <div className="space-y-2">
                {choices.map((choice, i) => {
                  const key = choiceKey(choice);
                  const draft = picked.get(key) ?? null;
                  return (
                    <HabitChoiceRow
                      key={key}
                      choice={choice}
                      idPrefix={`habit-choice-${i}`}
                      draft={draft}
                      onToggle={() => toggle(key, choiceDraft(choice))}
                      onChange={(next) => setPicked((current) => new Map(current).set(key, next))}
                      disabled={isPending}
                    />
                  );
                })}
              </div>
            )}
          </section>

          <section>
            <SectionLabel label="New habit" />
            <div className="space-y-2">
              {added.map((draft) => (
                <NewHabitCard
                  key={draft.key}
                  draft={draft}
                  onChange={(next) => setAdded((current) => current.map((item) => (item.key === next.key ? next : item)))}
                  onRemove={() => setAdded((current) => current.filter((item) => item.key !== draft.key))}
                  disabled={isPending}
                />
              ))}
              <button
                type="button"
                onClick={addNew}
                disabled={isPending}
                className="flex w-full items-center justify-center gap-1.5 rounded-[6px] border border-dashed border-[rgba(13,148,136,0.25)] py-2 text-xs font-medium text-[#5a7d82] transition-colors hover:border-[#0d9488] hover:bg-[rgba(13,148,136,0.05)] hover:text-[#0a5c55] disabled:cursor-not-allowed disabled:opacity-50"
              >
                <Plus className="h-3.5 w-3.5" strokeWidth={1.5} />
                New habit
              </button>
            </div>
          </section>

          <HabitDayField id="add-habits-starts-on" label="Starts on" value={startsOn} clientToday={clientToday} onChange={setStartsOn} disabled={isPending} />
        </div>

        {/* Footer */}
        <div className="flex flex-shrink-0 items-center justify-end gap-2 border-t border-[rgba(13,148,136,0.08)] bg-white px-5 py-3">
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={isPending}>
            Cancel
          </Button>
          <Button onClick={() => void save()} disabled={isPending || count === 0} className="bg-[#0d9488] text-white hover:bg-[#0b7f75]">
            {isPending && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
            {count > 1 ? `Add ${count} habits` : "Add habit"}
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
