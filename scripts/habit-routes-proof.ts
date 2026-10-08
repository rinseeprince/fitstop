/**
 * Request-level proof of the habit routes commits 1 to 3 build
 * (docs/HABITS-REBUILD-PLAN.md §2.4 and §5) against the linked DEV database
 * through a next dev the script starts on a free port: the full chain, every
 * write and its audit row, and each refusal's status and sentence.
 *
 *   npx tsx --tsconfig ./tsconfig.json scripts/habit-routes-proof.ts
 *
 * A vitest that mocks the services proves nothing about a route's chain or the
 * functions behind it. This drives the real routes: as the owner's coach, on
 * throwaway clients created under that coach and one under the perf coach to
 * attack (their habits, entries and audit rows go at the end — a client's
 * teardown removes both in one statement); as the perf fixture client, on
 * habits the proof adds to it and removes at the end; and as a throwaway
 * client with a login of its own (scripts/auth-fixtures.ts), whose deleted
 * habit the fixture client could never be rid of (the login goes at the end
 * too, and every minted session). Habits are set up through `addHabits`, the
 * path the product will use. Every fixture number is distinct.
 *
 *   1  the chain: no session is refused 401 before the route runs, a write without the Origin is refused
 *   2  another coach's client — one with a habit of its own — is 404 on every coach route and stays untouched;
 *      another client's habit through this URL is 404 and stays
 *   3  a change from a later day — audited once, a repeat writes nothing; the refusals say why
 *   4  a one-date edit — the week holding it reads it — and its reset, each audited; a weekly habit and a past day are refused
 *   5  a stop from a later day — audited; a stop before today is refused
 *   6  the order — every habit named once; a list that misses one is refused
 *   7  the coach's week and the habits offered for reuse
 *   8  the client's day, an entry met and not met, its note kept, and a clear
 *   9  the entry's four refusals: another client's habit 404, a day no version covers 409,
 *      an answer that does not fit 400, a locked day 403
 *  10  the client's week inside one of their weeks, and the Journey's weeks
 *  11  the coach's habit list, and habits added, renamed and deleted (commits 2 and 3): the chain, another coach's
 *      client and another client's habit 404, strict bodies, a repeat rename writes nothing; a habit never logged
 *      goes, a logged one leaves the list from today with its entries and its past weeks kept, no coach write
 *      reaches it after, and it is no longer offered for reuse
 *  11b a deleted habit as its client sees it (commit 3), on a throwaway client the proof signs in as: listed on a
 *      day it ran and not today; an entry on a day it ran saved and cleared, one today 409
 *  12  the audit trail once every row has landed: one per write that changed something, none for a repeat or a refusal
 *
 * The fixture client may hold habits of its own (the scale seed gives it some),
 * so every check on its day and week reads the proof's habits alone.
 *
 * The cleanup counts what is left and fails the run on anything it could not remove.
 */
import "./env-bootstrap";

import { createThrowawayLogin, deleteThrowawayLogin, loginIdFor } from "./auth-fixtures";
import { supabaseAdmin } from "@/services/supabase-admin";
import { addHabits } from "@/services/client-habit-writes-service";
import { getClientTodayString } from "@/services/today-service";
import { getClientWeekAnchor } from "@/services/check-in-week-service";
import { getLogWindow } from "@/services/daily-log-permissions-service";
import { addDaysToDateString, getTrainingWeekDays, weekdayOf } from "@/lib/date-helpers";
import type {
  ClientHabitDay,
  ClientHabitProgress,
  ClientHabitWeek,
  CoachHabitAddResult,
  CoachHabitList,
  CoachHabitWeek,
  CoachHabitWriteResult,
  HabitChoice,
  HabitEntryResult,
} from "@/types/habits";
import { PERF_CLIENT_EMAIL, PERF_CLIENT_ID, PERF_COACH_ID } from "./perf-fixtures";
import { endMintedSessions, mintSession, send, sendSignedOut, PROOF_BASE, type ProofSession } from "./proof-session";
import { startProofServer, stopProofServer } from "./proof-server";

const COACH_EMAIL = "samuel.k@taboola.com";
const EVERY_DAY = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"] as const;

let failures = 0;
function check(label: string, ok: boolean, detail?: unknown): void {
  if (ok) {
    console.info(`  ✓ ${label}`);
  } else {
    failures += 1;
    console.error(`  ✗ ${label}`, detail === undefined ? "" : JSON.stringify(detail).slice(0, 600));
  }
}

type Body<T> = { success: boolean; data: T; error?: string; code?: string };

/**
 * Whether the client's audit rows for an action reach `expected`. The routes
 * record their audit fire-and-forget, after answering, so the row may land a
 * moment after the response: poll briefly before judging.
 */
async function auditedTimes(clientId: string, action: string, expected: number): Promise<boolean> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const { count, error } = await supabaseAdmin
      .from("audit_logs")
      .select("id", { count: "exact", head: true })
      .eq("client_id", clientId)
      .eq("action", action);
    if (error) throw new Error(error.message);
    if ((count ?? 0) === expected) return true;
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  return false;
}

/** A habit's versions as [starts, ends, target], oldest first. */
async function versionsOf(habitId: string): Promise<Array<[string, string | null, number | null]>> {
  const { data, error } = await supabaseAdmin
    .from("client_habit_versions")
    .select("starts_on, ends_on, target")
    .eq("client_habit_id", habitId)
    .order("starts_on");
  if (error) throw new Error(error.message);
  return (data ?? []).map((v) => [v.starts_on, v.ends_on, v.target === null ? null : Number(v.target)]);
}

/** The first day after `from` falling on `weekday`. */
function nextWeekday(from: string, weekday: string): string {
  let day = addDaysToDateString(from, 1);
  while (weekdayOf(day) !== weekday) day = addDaysToDateString(day, 1);
  return day;
}

async function call<T>(session: ProofSession, method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE", path: string, body?: unknown) {
  const res = await send(session, method, path, body);
  return { status: res.status, body: res.json as Body<T> };
}

async function main(): Promise<void> {
  const { data: coach, error: coachError } = await supabaseAdmin
    .from("coaches")
    .select("id")
    .eq("email", COACH_EMAIL)
    .single();
  if (coachError || !coach) throw new Error(`Coach not found: ${coachError?.message}`);

  const stamp = Date.now();
  const made: string[] = [];
  const logins: Array<{ email: string; userId: string }> = [];
  const perfHabits: string[] = [];
  const makeClient = async (name: string, coachId: string = coach.id) => {
    const { data, error } = await supabaseAdmin
      .from("clients")
      .insert({ coach_id: coachId, name, email: `habit-routes-proof-${made.length}-${stamp}@fixture.local` })
      .select("id")
      .single();
    if (error || !data) throw new Error(`client insert: ${error?.message}`);
    made.push(data.id);
    return data.id;
  };
  /**
   * A throwaway client of the coach's that the proof can sign in as: active,
   * its login made through the invite (scripts/auth-fixtures.ts). Its teardown
   * takes its habits and entries with the client row, then the login.
   */
  const makeClientWithLogin = async (name: string) => {
    const email = `habit-routes-proof-${made.length}-${stamp}@fixture.local`;
    const { data, error } = await supabaseAdmin
      .from("clients")
      .insert({ coach_id: coach.id, name, email, active: true, onboarding_status: "active", timezone: "Europe/London" })
      .select("id")
      .single();
    if (error || !data) throw new Error(`client insert: ${error?.message}`);
    made.push(data.id);
    const { userId } = await createThrowawayLogin({
      role: "client",
      email,
      password: `Habit-proof-${stamp}-${Math.random().toString(36).slice(2)}`,
      clientId: data.id,
    });
    logins.push({ email, userId });
    return { clientId: data.id, email };
  };

  try {
    await startProofServer();
    const A = await makeClient("Habit routes proof A");
    const B = await makeClient("Habit routes proof B");
    const today = await getClientTodayString(A);
    const day = (n: number) => addDaysToDateString(today, n);
    const [water, mobility, sauna] = await addHabits({
      clientId: A,
      today,
      startsOn: today,
      createdBy: coach.id,
      habits: [
        { name: "Proof water", howTo: null, measure: "number", unit: "L", direction: "at_least", target: 3, schedule: { weekdays: [...EVERY_DAY] } },
        { name: "Proof mobility", howTo: null, measure: "tick", unit: null, direction: null, target: null, schedule: { weekdays: ["monday", "wednesday", "friday"] } },
        { name: "Proof sauna", howTo: null, measure: "tick", unit: null, direction: null, target: null, schedule: { timesPerWeek: 3 } },
      ],
    });
    const [reading] = await addHabits({
      clientId: B,
      today,
      startsOn: today,
      createdBy: coach.id,
      habits: [{ name: "Proof reading", howTo: null, measure: "tick", unit: null, direction: null, target: null, schedule: { weekdays: [...EVERY_DAY] } }],
    });

    const coachSession = await mintSession(COACH_EMAIL, "coach");
    const habitsOf = (clientId: string) => `/api/clients/${clientId}/habits`;

    console.info("1. The chain");
    const noSession = await sendSignedOut("GET", `${habitsOf(A)}/week`);
    check("no session is refused 401 before the route runs", noSession.refused, noSession);
    const noOrigin = await fetch(`${PROOF_BASE}${habitsOf(A)}/${water}/stop`, {
      method: "POST",
      headers: { ...coachSession.headers, "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    check("a write without the Origin is refused", noOrigin.status === 403, noOrigin.status);

    console.info("2. Ownership");
    // Another coach's client with a habit of its own, so each call names a habit
    // the functions WOULD find for that client: only the route's gate can refuse it.
    const F = await makeClient("Habit routes proof F", PERF_COACH_ID);
    const fToday = await getClientTodayString(F);
    const [foreignHabit] = await addHabits({
      clientId: F,
      today: fToday,
      startsOn: fToday,
      createdBy: PERF_COACH_ID,
      habits: [{ name: "Proof foreign", howTo: null, measure: "tick", unit: null, direction: null, target: null, schedule: { weekdays: [...EVERY_DAY] } }],
    });
    const foreignCalls = await Promise.all([
      call(coachSession, "GET", `${habitsOf(F)}/week`),
      call(coachSession, "GET", `${habitsOf(F)}/choices`),
      call(coachSession, "POST", `${habitsOf(F)}/${foreignHabit}/change`, { weekdays: ["monday"] }),
      call(coachSession, "POST", `${habitsOf(F)}/${foreignHabit}/stop`, {}),
      call(coachSession, "PUT", `${habitsOf(F)}/order`, { habitIds: [foreignHabit] }),
      call(coachSession, "PUT", `${habitsOf(F)}/${foreignHabit}/days/${addDaysToDateString(fToday, 1)}`, { planned: false }),
      call(coachSession, "DELETE", `${habitsOf(F)}/${foreignHabit}/days/${addDaysToDateString(fToday, 1)}`),
    ]);
    const { count: foreignEdits } = await supabaseAdmin
      .from("client_habit_day_edits")
      .select("date", { count: "exact", head: true })
      .eq("client_habit_id", foreignHabit);
    check(
      "another coach's client is 404 on every coach route, and its habit is untouched",
      foreignCalls.every((r) => r.status === 404) && foreignEdits === 0 &&
        JSON.stringify(await versionsOf(foreignHabit)) === JSON.stringify([[fToday, null, null]]),
      foreignCalls.map((r) => r.status)
    );
    const crossed = await call(coachSession, "POST", `${habitsOf(A)}/${reading}/change`, { weekdays: ["monday"] });
    check(
      "another client's habit through this URL is 404, and stays as it was",
      crossed.status === 404 && JSON.stringify(await versionsOf(reading)) === JSON.stringify([[today, null, null]]),
      crossed
    );

    console.info("3. A change");
    const changed = await call<{ changed: boolean }>(coachSession, "POST", `${habitsOf(A)}/${water}/change`, {
      startsOn: day(7),
      target: 3.5,
      weekdays: [...EVERY_DAY],
    });
    check(
      "200, the running version ends the day before and the new one runs on",
      changed.status === 200 && changed.body.data.changed &&
        JSON.stringify(await versionsOf(water)) === JSON.stringify([[today, day(6), 3], [day(7), null, 3.5]]),
      { changed, versions: await versionsOf(water) }
    );
    check("audited as habit.change", await auditedTimes(A, "habit.change", 1));
    const again = await call<{ changed: boolean }>(coachSession, "POST", `${habitsOf(A)}/${water}/change`, {
      startsOn: day(7),
      target: 3.5,
      weekdays: [...EVERY_DAY],
    });
    check("the same change again writes nothing and is not audited", again.status === 200 && !again.body.data.changed && (await auditedTimes(A, "habit.change", 1)), again);
    const past = await call(coachSession, "POST", `${habitsOf(A)}/${water}/change`, { startsOn: day(-1), target: 4, weekdays: ["monday"] });
    check("a change before today: 409 and its sentence", past.status === 409 && past.body.error === "Pick today or a later day to start from.", past);
    const noTarget = await call(coachSession, "POST", `${habitsOf(A)}/${water}/change`, { weekdays: ["monday"] });
    check("a number habit without a target: 400 and its sentence", noTarget.status === 400 && noTarget.body.error === "A number habit needs a target.", noTarget);
    const both = await call(coachSession, "POST", `${habitsOf(A)}/${water}/change`, { target: 4, weekdays: ["monday"], timesPerWeek: 2 });
    check("weekdays and times a week together: 400 before any write", both.status === 400, both.status);

    console.info("4. A one-date edit");
    const monday = nextWeekday(today, "monday");
    const off = await call<{ changed: boolean }>(coachSession, "PUT", `${habitsOf(A)}/${mobility}/days/${monday}`, { planned: false });
    const { data: edits } = await supabaseAdmin.from("client_habit_day_edits").select("date, planned").eq("client_habit_id", mobility);
    check(
      "200, the planned Monday is taken off",
      off.status === 200 && off.body.data.changed && JSON.stringify(edits) === JSON.stringify([{ date: monday, planned: false }]),
      { off, edits }
    );
    check("audited as habit.day_edit", await auditedTimes(A, "habit.day_edit", 1));
    const editedWeek = await call<CoachHabitWeek>(coachSession, "GET", `${habitsOf(A)}/week?start=${monday}`);
    const editedDay = editedWeek.body.data?.habits
      .find((row) => row.habit.id === mobility)
      ?.days.find((d) => d.date === monday);
    check(
      "the week holding that Monday reads it as edited and not planned",
      editedWeek.status === 200 && editedDay?.edited === true && editedDay.planned === false,
      editedDay
    );
    const weekly = await call(coachSession, "PUT", `${habitsOf(A)}/${sauna}/days/${monday}`, { planned: true });
    check(
      "a weekly habit's day: 409 and its sentence",
      weekly.status === 409 && weekly.body.error === "This habit is done a number of times a week, so it has no set days to change.",
      weekly
    );
    const pastDay = await call(coachSession, "PUT", `${habitsOf(A)}/${mobility}/days/${day(-1)}`, { planned: true });
    check("a day before today: 409 and its sentence", pastDay.status === 409 && pastDay.body.error === "This day has passed, so it can't be changed.", pastDay);
    const reset = await call<{ changed: boolean }>(coachSession, "DELETE", `${habitsOf(A)}/${mobility}/days/${monday}`);
    const { count: editsLeft } = await supabaseAdmin.from("client_habit_day_edits").select("date", { count: "exact", head: true }).eq("client_habit_id", mobility);
    check("the reset removes it — audited", reset.status === 200 && reset.body.data.changed && editsLeft === 0 && (await auditedTimes(A, "habit.day_edit", 2)), reset);

    console.info("5. A stop");
    const stopped = await call<{ changed: boolean }>(coachSession, "POST", `${habitsOf(A)}/${mobility}/stop`, { stopsOn: day(14) });
    check(
      "200, the habit runs to the day before",
      stopped.status === 200 && stopped.body.data.changed && JSON.stringify(await versionsOf(mobility)) === JSON.stringify([[today, day(13), null]]),
      stopped
    );
    check("audited as habit.stop", await auditedTimes(A, "habit.stop", 1));
    const stopPast = await call(coachSession, "POST", `${habitsOf(A)}/${mobility}/stop`, { stopsOn: day(-1) });
    check("a stop before today: 409 and its sentence", stopPast.status === 409 && stopPast.body.error === "Pick today or a later day to stop from.", stopPast);

    console.info("6. The order");
    const ordered = await call<{ changed: boolean }>(coachSession, "PUT", `${habitsOf(A)}/order`, { habitIds: [sauna, mobility, water] });
    const { data: positions } = await supabaseAdmin.from("client_habits").select("id").eq("client_id", A).order("position");
    check(
      "200, the habits in the order given",
      ordered.status === 200 && ordered.body.data.changed && JSON.stringify((positions ?? []).map((p) => p.id)) === JSON.stringify([sauna, mobility, water]),
      { ordered, positions }
    );
    const partial = await call(coachSession, "PUT", `${habitsOf(A)}/order`, { habitIds: [water, sauna] });
    check(
      "a list missing a habit: 409 and its sentence",
      partial.status === 409 && partial.body.error === "The habits have changed since this list was loaded. Reload it and try again.",
      partial
    );

    console.info("7. The coach's week and the habits offered for reuse");
    const week = await call<CoachHabitWeek>(coachSession, "GET", `${habitsOf(A)}/week`);
    const rows = week.body.data?.habits ?? [];
    check(
      "the week holding the client's today: every running habit in the client's order, with its words",
      week.status === 200 && week.body.data.clientToday === today && week.body.data.dates.includes(today) &&
        JSON.stringify(rows.map((r) => r.habit.id)) === JSON.stringify([sauna, mobility, water]) &&
        rows[2]?.words.target === "at least 3 L" && rows[0]?.words.schedule === "3 times a week" && week.body.data.today !== null,
      week.body
    );
    const forB = await call<HabitChoice[]>(coachSession, "GET", `${habitsOf(B)}/choices`);
    const namesForB = (forB.body.data ?? []).map((c) => c.name).filter((n) => n.startsWith("Proof "));
    check(
      "B is offered A's habits, not its own running one",
      forB.status === 200 && ["Proof mobility", "Proof sauna", "Proof water"].every((n) => namesForB.includes(n)) && !namesForB.includes("Proof reading"),
      namesForB
    );
    const waterChoice = (forB.body.data ?? []).find((c) => c.name === "Proof water");
    check("each with its newest version's target, in words", waterChoice?.target === 3.5 && waterChoice.words.target === "at least 3.5 L", waterChoice);
    const forA = await call<HabitChoice[]>(coachSession, "GET", `${habitsOf(A)}/choices`);
    const namesForA = (forA.body.data ?? []).map((c) => c.name).filter((n) => n.startsWith("Proof "));
    check("A is offered B's habit, not its own", namesForA.includes("Proof reading") && !namesForA.includes("Proof water"), namesForA);

    console.info("8. The client's day and entries");
    const pToday = await getClientTodayString(PERF_CLIENT_ID);
    const pDay = (n: number) => addDaysToDateString(pToday, n);
    const { logsOpenFrom } = await getLogWindow(PERF_CLIENT_ID);
    if (logsOpenFrom !== null && logsOpenFrom > pToday) throw new Error("Setup: the fixture client's today is locked");
    const [steps, stretch] = await addHabits({
      clientId: PERF_CLIENT_ID,
      today: pToday,
      startsOn: pToday,
      createdBy: coach.id,
      habits: [
        { name: "Proof steps", howTo: "Any walking counts", measure: "number", unit: "steps", direction: "at_least", target: 6000, schedule: { weekdays: [...EVERY_DAY] } },
        { name: "Proof stretch", howTo: null, measure: "tick", unit: null, direction: null, target: null, schedule: { weekdays: [...EVERY_DAY] } },
      ],
    });
    perfHabits.push(steps, stretch);
    const client = await mintSession(PERF_CLIENT_EMAIL, "client");
    const entryPath = (habitId: string, date: string) => `/api/client/habits/${habitId}/days/${date}`;

    const clientNoSession = await sendSignedOut("GET", `/api/client/habits/day?date=${pToday}`);
    check("no session is refused 401 before the route runs", clientNoSession.refused, clientNoSession);
    const dayRead = await send(client, "GET", `/api/client/habits/day?date=${pToday}`);
    const dayBody = dayRead.json as Body<ClientHabitDay>;
    const ownDay = (dayBody.data?.habits ?? []).filter((item) => perfHabits.includes(item.habit.id));
    const stepsItem = ownDay.find((item) => item.habit.id === steps);
    check(
      "the day lists every habit running on it, with its how-to and the day's target in words",
      dayRead.status === 200 && ownDay.length === 2 && stepsItem?.words.target === "at least 6,000 steps" &&
        stepsItem.day.planned && stepsItem.habit.howTo === "Any walking counts",
      ownDay
    );

    const short = await call<HabitEntryResult>(client, "PUT", entryPath(steps, pToday), { value: 5400 });
    check("a number short of its target is saved, not met", short.status === 200 && short.body.data.day.met === false && short.body.data.day.entry?.value === 5400, short.body);
    const met = await call<HabitEntryResult>(client, "PUT", entryPath(steps, pToday), { value: 6200, note: "Walked to work" });
    check("a number at its target is met, and counts in the week", met.status === 200 && met.body.data.day.met && met.body.data.week.done === 1, met.body);
    const noNote = await call<HabitEntryResult>(client, "PUT", entryPath(steps, pToday), { value: 6300 });
    const { data: stepsRow } = await supabaseAdmin
      .from("client_habit_logs")
      .select("client_id, value, done, note")
      .eq("client_habit_id", steps)
      .eq("date", pToday)
      .single();
    check(
      "one entry per habit per day, on the client, its note kept when none is sent",
      noNote.status === 200 && stepsRow?.client_id === PERF_CLIENT_ID && Number(stepsRow.value) === 6300 && stepsRow.done === null && stepsRow.note === "Walked to work",
      stepsRow
    );
    const cleared = await call<HabitEntryResult>(client, "DELETE", entryPath(steps, pToday));
    const { count: stepsLeft } = await supabaseAdmin.from("client_habit_logs").select("id", { count: "exact", head: true }).eq("client_habit_id", steps);
    check("the entry is cleared", cleared.status === 200 && cleared.body.data.day.entry === null && stepsLeft === 0, cleared.body);
    const ticked = await call<HabitEntryResult>(client, "PUT", entryPath(stretch, pToday), { done: true });
    check("a tick is met", ticked.status === 200 && ticked.body.data.day.met, ticked.body);

    console.info("9. The entry's refusals");
    const notTheirs = await call(client, "PUT", entryPath(water, today), { value: 3.2 });
    const { count: waterEntries } = await supabaseAdmin.from("client_habit_logs").select("id", { count: "exact", head: true }).eq("client_habit_id", water);
    check("another client's habit: 404, nothing written", notTheirs.status === 404 && notTheirs.body.error === "Habit not found." && waterEntries === 0, notTheirs);
    const uncovered = await call(client, "PUT", entryPath(stretch, pDay(-1)), { done: true });
    check("a day no version covers: 409, \"That habit isn't running on that day.\"", uncovered.status === 409 && uncovered.body.error === "That habit isn't running on that day.", uncovered);
    const wrongAnswer = await call(client, "PUT", entryPath(stretch, pToday), { value: 3 });
    const wrongTick = await call(client, "PUT", entryPath(steps, pToday), { done: true });
    check(
      "an answer that does not fit the habit: 400, each with its sentence",
      wrongAnswer.status === 400 && wrongAnswer.body.error === "This habit is ticked, not counted." &&
        wrongTick.status === 400 && wrongTick.body.error === "This habit takes a number.",
      { wrongAnswer, wrongTick }
    );
    const locked = await call(client, "PUT", entryPath(stretch, pDay(1)), { done: true });
    check("a locked day: 403, \"This day is locked.\"", locked.status === 403 && locked.body.error === "This day is locked.", locked);
    const clientNoOrigin = await fetch(`${PROOF_BASE}${entryPath(stretch, pToday)}`, {
      method: "PUT",
      headers: { ...client.headers, "Content-Type": "application/json" },
      body: JSON.stringify({ done: false }),
    });
    check("an entry without the Origin is refused", clientNoOrigin.status === 403, clientNoOrigin.status);

    console.info("10. The client's week and the Journey");
    const anchor = await getClientWeekAnchor(PERF_CLIENT_ID);
    const pWeek = getTrainingWeekDays(pToday, anchor.weekday);
    const clientWeek = await call<ClientHabitWeek>(client, "GET", `/api/client/habits/week?start=${pWeek[0]}&end=${pWeek[6]}`);
    const ownWeek = (clientWeek.body.data?.habits ?? []).filter((row) => perfHabits.includes(row.habit.id));
    check(
      "the week over the client's own week: both habits, the tick counted and the cleared number not",
      clientWeek.status === 200 && ownWeek.length === 2 &&
        ownWeek.find((row) => row.habit.id === stretch)?.figures.done === 1 &&
        ownWeek.find((row) => row.habit.id === steps)?.figures.done === 0,
      ownWeek
    );
    const twoWeeks = await call(client, "GET", `/api/client/habits/week?start=${pWeek[0]}&end=${addDaysToDateString(pWeek[6], 1)}`);
    check("dates over two of the client's weeks: 400, and why", twoWeeks.status === 400 && twoWeeks.body.error === "The dates must be inside one week.", twoWeeks);
    const progress = await call<ClientHabitProgress>(client, "GET", "/api/client/habits/progress?weeks=2");
    const stretchRow = progress.body.data?.habits.find((row) => row.habit.id === stretch);
    check(
      "the Journey: two weeks, the last holding today, and 28 days ending today",
      progress.status === 200 && stretchRow?.weeks.length === 2 && stretchRow.weeks[1].start === pWeek[0] &&
        stretchRow.days.length === 28 && stretchRow.days[27].date === pToday && stretchRow.days[27].met,
      stretchRow
    );

    console.info("11. The coach's habit list, and habits added, renamed and deleted");
    const listed = await call<CoachHabitList>(coachSession, "GET", habitsOf(A));
    const listedHabits = listed.body.data?.habits ?? [];
    check(
      "the list: every habit in the client's order, where each stands today, whether it has entries, its words and its history",
      listed.status === 200 && listed.body.data.clientToday === today &&
        JSON.stringify(listedHabits.map((h) => [h.id, h.status, h.hasEntries])) ===
          JSON.stringify([[sauna, "running", false], [mobility, "running", false], [water, "running", false]]) &&
        listedHabits[2]?.words.target === "at least 3 L" && listedHabits[2]?.versions.length === 2,
      listedHabits.map((h) => [h.name, h.status, h.hasEntries, h.words, h.versions.length])
    );
    const listNoSession = await sendSignedOut("GET", habitsOf(A));
    check("no session is refused 401 before the route runs", listNoSession.refused, listNoSession);
    const journalInput = {
      name: "Proof journal",
      howTo: "Three lines before bed",
      measure: "tick",
      unit: null,
      direction: null,
      target: null,
      weekdays: [...EVERY_DAY],
    };
    const drinksInput = {
      name: "Proof drinks",
      howTo: null,
      measure: "number",
      unit: "drinks",
      direction: "at_most",
      target: 2,
      weekdays: ["friday", "saturday"],
    };
    const withoutOrigin = (method: string, path: string, body?: unknown) =>
      fetch(`${PROOF_BASE}${path}`, {
        method,
        headers: { ...coachSession.headers, "Content-Type": "application/json" },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
    const noOriginWrites = await Promise.all([
      withoutOrigin("POST", habitsOf(A), { habits: [journalInput] }),
      withoutOrigin("PATCH", `${habitsOf(A)}/${water}`, { name: "Proof water", howTo: null }),
      withoutOrigin("DELETE", `${habitsOf(A)}/${water}`),
    ]);
    check("the add, the rename and the delete without the Origin are refused", noOriginWrites.every((r) => r.status === 403), noOriginWrites.map((r) => r.status));

    const foreignNew = await Promise.all([
      call(coachSession, "GET", habitsOf(F)),
      call(coachSession, "POST", habitsOf(F), { habits: [journalInput] }),
      call(coachSession, "PATCH", `${habitsOf(F)}/${foreignHabit}`, { name: "Proof renamed", howTo: null }),
      call(coachSession, "DELETE", `${habitsOf(F)}/${foreignHabit}`),
    ]);
    const { data: foreignRow } = await supabaseAdmin.from("client_habits").select("name").eq("id", foreignHabit).maybeSingle();
    const { count: foreignHabitCount } = await supabaseAdmin
      .from("client_habits")
      .select("id", { count: "exact", head: true })
      .eq("client_id", F);
    check(
      "another coach's client is 404 on the list, the add, the rename and the delete; its habit stays and nothing is added",
      foreignNew.every((r) => r.status === 404) && foreignRow?.name === "Proof foreign" && foreignHabitCount === 1,
      foreignNew.map((r) => r.status)
    );
    const crossedRename = await call(coachSession, "PATCH", `${habitsOf(A)}/${reading}`, { name: "Proof renamed", howTo: null });
    const crossedDelete = await call(coachSession, "DELETE", `${habitsOf(A)}/${reading}`);
    const notAnId = await call(coachSession, "DELETE", `${habitsOf(A)}/not-a-habit`);
    const { data: readingRow } = await supabaseAdmin.from("client_habits").select("name").eq("id", reading).maybeSingle();
    check(
      "another client's habit through this URL is 404 on the rename and the delete and stays; a malformed id is 404",
      crossedRename.status === 404 && crossedDelete.status === 404 && notAnId.status === 404 && readingRow?.name === "Proof reading",
      { crossedRename, crossedDelete, notAnId }
    );

    const added = await call<CoachHabitAddResult>(coachSession, "POST", habitsOf(A), { habits: [journalInput, drinksInput] });
    const [journal, drinks] = added.body.data?.habitIds ?? [];
    // A write answers with the list read back; no list (saved, not read back) fails these checks.
    const addedList = added.body.data?.habits?.habits ?? [];
    check(
      "200: the new habits' ids in order, appended to the list the answer carries, running from today",
      added.status === 200 && added.body.data.habitIds.length === 2 &&
        JSON.stringify(addedList.map((h) => h.id)) === JSON.stringify([sauna, mobility, water, journal, drinks]) &&
        JSON.stringify(await versionsOf(journal)) === JSON.stringify([[today, null, null]]) &&
        JSON.stringify(await versionsOf(drinks)) === JSON.stringify([[today, null, 2]]) &&
        addedList[4]?.words.target === "at most 2 drinks" && addedList[4]?.words.schedule === "Fri, Sat",
      added.body
    );
    check("audited once per habit, as habit.create", await auditedTimes(A, "habit.create", 2));
    const queued = await call<CoachHabitAddResult>(coachSession, "POST", habitsOf(A), {
      startsOn: day(3),
      habits: [{ ...journalInput, name: "Proof later" }],
    });
    const [later] = queued.body.data?.habitIds ?? [];
    check(
      "a habit added from a later day is upcoming until then",
      queued.status === 200 && queued.body.data.habits?.habits.find((h) => h.id === later)?.status === "upcoming" &&
        JSON.stringify(await versionsOf(later)) === JSON.stringify([[day(3), null, null]]) &&
        (await auditedTimes(A, "habit.create", 3)),
      queued.body
    );
    const unknownField = await call(coachSession, "POST", habitsOf(A), { habits: [{ ...journalInput, streak: 3 }] });
    const noTargetAdd = await call(coachSession, "POST", habitsOf(A), { habits: [journalInput, { ...drinksInput, target: null }] });
    const tickTarget = await call(coachSession, "POST", habitsOf(A), { habits: [{ ...journalInput, target: 1 }] });
    const pastStart = await call(coachSession, "POST", habitsOf(A), { startsOn: day(-1), habits: [journalInput] });
    const { count: habitsOfA } = await supabaseAdmin.from("client_habits").select("id", { count: "exact", head: true }).eq("client_id", A);
    check(
      "refused, and nothing added — not even the batch's valid habit: an unknown field 400, a number habit without a target 400, a tick with one 400, a start before today 409",
      unknownField.status === 400 &&
        noTargetAdd.status === 400 && noTargetAdd.body.error === "A number habit needs a target." &&
        tickTarget.status === 400 && tickTarget.body.error === "A tick habit has no target." &&
        pastStart.status === 409 && pastStart.body.error === "Pick today or a later day to start from." &&
        habitsOfA === 6,
      { unknownField: unknownField.status, noTargetAdd, tickTarget, pastStart, habitsOfA }
    );

    const renamed = await call<CoachHabitWriteResult>(coachSession, "PATCH", `${habitsOf(A)}/${water}`, {
      name: "Proof water intake",
      howTo: "A glass with each meal",
    });
    const { data: waterRow } = await supabaseAdmin.from("client_habits").select("name, how_to").eq("id", water).single();
    check(
      "200: both labels changed, and the answer's list carries them",
      renamed.status === 200 && renamed.body.data.changed && waterRow?.name === "Proof water intake" &&
        waterRow.how_to === "A glass with each meal" &&
        renamed.body.data.habits?.habits.find((h) => h.id === water)?.name === "Proof water intake",
      { renamed: renamed.body, waterRow }
    );
    check("audited as habit.rename", await auditedTimes(A, "habit.rename", 1));
    const renamedAgain = await call<CoachHabitWriteResult>(coachSession, "PATCH", `${habitsOf(A)}/${water}`, {
      name: "Proof water intake",
      howTo: "A glass with each meal",
    });
    check(
      "the same labels again write nothing and are not audited",
      renamedAgain.status === 200 && !renamedAgain.body.data.changed && (await auditedTimes(A, "habit.rename", 1)),
      renamedAgain.body
    );
    const oneLabel = await call(coachSession, "PATCH", `${habitsOf(A)}/${water}`, { name: "Proof water" });
    const blankName = await call(coachSession, "PATCH", `${habitsOf(A)}/${water}`, { name: "   ", howTo: null });
    const { data: waterAfter } = await supabaseAdmin.from("client_habits").select("name").eq("id", water).single();
    check(
      "a rename naming one label, or a blank name: 400, the labels as they were",
      oneLabel.status === 400 && blankName.status === 400 && waterAfter?.name === "Proof water intake",
      { oneLabel: oneLabel.status, blankName: blankName.status }
    );

    const deleted = await call<CoachHabitWriteResult>(coachSession, "DELETE", `${habitsOf(A)}/${journal}`);
    const { count: journalLeft } = await supabaseAdmin.from("client_habits").select("id", { count: "exact", head: true }).eq("id", journal);
    const { count: journalVersions } = await supabaseAdmin
      .from("client_habit_versions")
      .select("id", { count: "exact", head: true })
      .eq("client_habit_id", journal);
    check(
      "a habit never logged is deleted with its schedule, and the answer's list no longer has it",
      deleted.status === 200 && deleted.body.data.changed && journalLeft === 0 && journalVersions === 0 &&
        deleted.body.data.habits !== null && !deleted.body.data.habits.habits.some((h) => h.id === journal),
      deleted.body
    );
    check("audited as habit.delete", await auditedTimes(A, "habit.delete", 1));
    const deletedAgain = await call(coachSession, "DELETE", `${habitsOf(A)}/${journal}`);
    check("a habit already deleted: 404", deletedAgain.status === 404 && deletedAgain.body.error === "Habit not found.", deletedAgain);

    // A logged habit: a walk the client has done since three days ago, added
    // as a seed adds history (the function takes the today it is given), with
    // an entry each on the two days before today, as the client would make them.
    const [walk] = await addHabits({
      clientId: A,
      today: day(-3),
      startsOn: day(-3),
      createdBy: coach.id,
      habits: [{ name: "Proof walk", howTo: null, measure: "tick", unit: null, direction: null, target: null, schedule: { weekdays: [...EVERY_DAY] } }],
    });
    const { error: walkEntriesError } = await supabaseAdmin.from("client_habit_logs").insert([
      { client_id: A, client_habit_id: walk, date: day(-2), done: true },
      { client_id: A, client_habit_id: walk, date: day(-1), done: false },
    ]);
    if (walkEntriesError) throw new Error(`Setup: the walk's entries: ${walkEntriesError.message}`);
    const offeredBefore = await call<HabitChoice[]>(coachSession, "GET", `${habitsOf(B)}/choices`);
    const logged = await call<CoachHabitWriteResult>(coachSession, "DELETE", `${habitsOf(A)}/${walk}`);
    const { data: walkRow } = await supabaseAdmin.from("client_habits").select("deleted_at").eq("id", walk).maybeSingle();
    const { data: walkEntries } = await supabaseAdmin
      .from("client_habit_logs")
      .select("date, done")
      .eq("client_habit_id", walk)
      .order("date");
    check(
      "a logged habit: 200, it leaves the answer's list, and it is kept — marked deleted, stopped from today, both entries untouched",
      logged.status === 200 && logged.body.data.changed && logged.body.data.habits !== null &&
        !logged.body.data.habits.habits.some((h) => h.id === walk) &&
        walkRow !== null && walkRow.deleted_at !== null &&
        JSON.stringify(await versionsOf(walk)) === JSON.stringify([[day(-3), day(-1), null]]) &&
        JSON.stringify(walkEntries) === JSON.stringify([{ date: day(-2), done: true }, { date: day(-1), done: false }]),
      { logged: logged.body, walkRow, walkEntries }
    );
    check("audited as habit.delete", await auditedTimes(A, "habit.delete", 2));
    const walkWeek = await call<CoachHabitWeek>(coachSession, "GET", `${habitsOf(A)}/week?start=${day(-2)}`);
    const walkDay = walkWeek.body.data?.habits.find((row) => row.habit.id === walk)?.days.find((d) => d.date === day(-2));
    check(
      "its past stays: the coach's week holding a day it ran lists it, the day done",
      walkWeek.status === 200 && walkDay?.covered === true && walkDay.met && walkDay.entry?.done === true,
      walkDay
    );
    const offeredAfter = await call<HabitChoice[]>(coachSession, "GET", `${habitsOf(B)}/choices`);
    check(
      "it is offered for reuse before its delete and not after",
      (offeredBefore.body.data ?? []).some((c) => c.name === "Proof walk") &&
        offeredAfter.status === 200 && !(offeredAfter.body.data ?? []).some((c) => c.name === "Proof walk"),
      { before: offeredBefore.body.data?.map((c) => c.name), after: offeredAfter.body.data?.map((c) => c.name) }
    );
    const listedAfter = await call<CoachHabitList>(coachSession, "GET", habitsOf(A));
    const writesToDeleted = await Promise.all([
      call(coachSession, "PATCH", `${habitsOf(A)}/${walk}`, { name: "Proof walk again", howTo: null }),
      call(coachSession, "POST", `${habitsOf(A)}/${walk}/change`, { weekdays: [...EVERY_DAY] }),
      call(coachSession, "POST", `${habitsOf(A)}/${walk}/stop`, {}),
      call(coachSession, "PUT", `${habitsOf(A)}/${walk}/days/${day(1)}`, { planned: true }),
      call(coachSession, "DELETE", `${habitsOf(A)}/${walk}/days/${day(1)}`),
      call(coachSession, "DELETE", `${habitsOf(A)}/${walk}`),
    ]);
    const liveIds = (listedAfter.body.data?.habits ?? []).map((h) => h.id);
    const orderNamingIt = await call(coachSession, "PUT", `${habitsOf(A)}/order`, { habitIds: [...liveIds, walk] });
    check(
      "no coach write reaches it after: a rename, a change (starting it again), a stop, a day's edit and its reset, another delete — each 404; an order naming it 409",
      writesToDeleted.every((r) => r.status === 404 && r.body.error === "Habit not found.") &&
        orderNamingIt.status === 409 &&
        JSON.stringify(await versionsOf(walk)) === JSON.stringify([[day(-3), day(-1), null]]),
      { writes: writesToDeleted.map((r) => r.status), order: orderNamingIt.status }
    );

    // A habit started today with the client's entry today: deleting it from
    // today leaves it no day to run on, and the entry stays.
    const { error: saunaEntryError } = await supabaseAdmin
      .from("client_habit_logs")
      .insert({ client_id: A, client_habit_id: sauna, date: today, done: true });
    if (saunaEntryError) throw new Error(`Setup: the sauna's entry: ${saunaEntryError.message}`);
    const saunaDeleted = await call<CoachHabitWriteResult>(coachSession, "DELETE", `${habitsOf(A)}/${sauna}`);
    const { count: saunaEntries } = await supabaseAdmin
      .from("client_habit_logs")
      .select("id", { count: "exact", head: true })
      .eq("client_habit_id", sauna);
    check(
      "a habit logged only today: deleted from today it runs no day, leaves the list, and its entry stays",
      saunaDeleted.status === 200 && saunaDeleted.body.data.habits !== null &&
        !saunaDeleted.body.data.habits.habits.some((h) => h.id === sauna) &&
        (await versionsOf(sauna)).length === 0 && saunaEntries === 1,
      { saunaDeleted: saunaDeleted.body, saunaEntries }
    );

    console.info("11b. A deleted habit, as its client sees it");
    // A client of the coach's the proof signs in as: with no check-in
    // schedule nothing closes a week for them, so every day before today is
    // open to their entries.
    const L = await makeClientWithLogin("Habit routes proof L");
    const lToday = await getClientTodayString(L.clientId);
    const lDay = (n: number) => addDaysToDateString(lToday, n);
    const [yoga] = await addHabits({
      clientId: L.clientId,
      today: lDay(-3),
      startsOn: lDay(-3),
      createdBy: coach.id,
      habits: [{ name: "Proof yoga", howTo: null, measure: "tick", unit: null, direction: null, target: null, schedule: { weekdays: [...EVERY_DAY] } }],
    });
    const { error: yogaEntryError } = await supabaseAdmin
      .from("client_habit_logs")
      .insert({ client_id: L.clientId, client_habit_id: yoga, date: lDay(-3), done: true });
    if (yogaEntryError) throw new Error(`Setup: the yoga's entry: ${yogaEntryError.message}`);
    const yogaDeleted = await call<CoachHabitWriteResult>(coachSession, "DELETE", `${habitsOf(L.clientId)}/${yoga}`);
    const { data: yogaRow } = await supabaseAdmin.from("client_habits").select("deleted_at").eq("id", yoga).maybeSingle();
    check(
      "the coach deletes the client's logged habit: kept, marked deleted, stopped from today",
      yogaDeleted.status === 200 && yogaRow?.deleted_at != null &&
        JSON.stringify(await versionsOf(yoga)) === JSON.stringify([[lDay(-3), lDay(-1), null]]),
      { yogaDeleted: yogaDeleted.body, yogaRow }
    );
    const lClient = await mintSession(L.email, "client L");
    const lEntry = (date: string) => `/api/client/habits/${yoga}/days/${date}`;
    const ranDay = await call<ClientHabitDay>(lClient, "GET", `/api/client/habits/day?date=${lDay(-1)}`);
    const todayRead = await call<ClientHabitDay>(lClient, "GET", `/api/client/habits/day?date=${lToday}`);
    check(
      "the client's day lists it on a day it ran and not today",
      ranDay.status === 200 && ranDay.body.data.habits.some((item) => item.habit.id === yoga) &&
        todayRead.status === 200 && !todayRead.body.data.habits.some((item) => item.habit.id === yoga),
      { ranDay: ranDay.body.data?.habits.map((i) => i.habit.name), today: todayRead.body.data?.habits.map((i) => i.habit.name) }
    );
    const madeUp = await call<HabitEntryResult>(lClient, "PUT", lEntry(lDay(-1)), { done: true });
    const unmade = await call<HabitEntryResult>(lClient, "DELETE", lEntry(lDay(-1)));
    const onToday = await call(lClient, "PUT", lEntry(lToday), { done: true });
    const { count: yogaEntries } = await supabaseAdmin
      .from("client_habit_logs")
      .select("id", { count: "exact", head: true })
      .eq("client_habit_id", yoga);
    check(
      "the client's entry still reaches it on a day it ran — saved and met, then cleared — while today, which it no longer runs, is 409",
      madeUp.status === 200 && madeUp.body.data.day.met && unmade.status === 200 && unmade.body.data.day.entry === null &&
        onToday.status === 409 && onToday.body.error === "That habit isn't running on that day." && yogaEntries === 1,
      { madeUp: madeUp.body, unmade: unmade.status, onToday, yogaEntries }
    );

    console.info("12. The audit trail, once every row has landed");
    // Audit rows are written after the response. By now any a repeated or a
    // refused write had wrongly recorded would be there too.
    const trail = await Promise.all([
      auditedTimes(A, "habit.change", 1),
      auditedTimes(A, "habit.day_edit", 2),
      auditedTimes(A, "habit.stop", 1),
      auditedTimes(A, "habit.create", 3),
      auditedTimes(A, "habit.rename", 1),
      auditedTimes(A, "habit.delete", 3),
    ]);
    const auditsOn = async (clientId: string) => {
      const { count, error } = await supabaseAdmin.from("audit_logs").select("id", { count: "exact", head: true }).eq("client_id", clientId);
      if (error) throw new Error(error.message);
      return count ?? 0;
    };
    const foreignAudits = await auditsOn(F);
    const crossedAudits = await auditsOn(B);
    check(
      "each write that changed something recorded once; the repeats, the refusals and the writes to other clients never",
      trail.every(Boolean) && foreignAudits === 0 && crossedAudits === 0,
      { trail, foreignAudits, crossedAudits }
    );
  } finally {
    const cleanupErrors: string[] = [];
    // The fixture client's entries first: a habit with entries is kept when
    // deleted, one without is removed.
    if (perfHabits.length > 0) {
      const { error: logsError } = await supabaseAdmin.from("client_habit_logs").delete().in("client_habit_id", perfHabits);
      if (logsError) cleanupErrors.push(logsError.message);
      const perfToday = await getClientTodayString(PERF_CLIENT_ID);
      for (const habitId of perfHabits) {
        const { error } = await supabaseAdmin.rpc("delete_client_habit", {
          p_habit_id: habitId,
          p_client_id: PERF_CLIENT_ID,
          p_today: perfToday,
        });
        if (error) cleanupErrors.push(error.message);
      }
    }
    // A client's teardown removes its habits and entries in one statement. The
    // audit rows go after a pause, so one written after the last response lands first.
    if (made.length > 0) {
      await new Promise((resolve) => setTimeout(resolve, 1500));
      const { error: auditError } = await supabaseAdmin.from("audit_logs").delete().in("client_id", made);
      const { error: clientError } = await supabaseAdmin.from("clients").delete().in("id", made);
      if (auditError) cleanupErrors.push(auditError.message);
      if (clientError) cleanupErrors.push(clientError.message);
    }
    // The logins go after their clients, each with its profile and sessions;
    // then every session minted for a real login (the coach's, the fixture client's).
    for (const { email } of logins) {
      try {
        await deleteThrowawayLogin(email);
      } catch (error) {
        cleanupErrors.push(error instanceof Error ? error.message : String(error));
      }
    }
    try {
      await endMintedSessions();
    } catch (error) {
      cleanupErrors.push(error instanceof Error ? error.message : String(error));
    }
    // What is left, counted rather than assumed.
    const count = async (query: PromiseLike<{ count: number | null; error: { message: string } | null }>) => {
      const { count: rows, error } = await query;
      if (error) cleanupErrors.push(error.message);
      return rows ?? 0;
    };
    const left =
      (made.length > 0
        ? (await count(supabaseAdmin.from("clients").select("id", { count: "exact", head: true }).in("id", made))) +
          (await count(supabaseAdmin.from("audit_logs").select("id", { count: "exact", head: true }).in("client_id", made)))
        : 0) +
      (perfHabits.length > 0
        ? await count(supabaseAdmin.from("client_habits").select("id", { count: "exact", head: true }).in("id", perfHabits))
        : 0) +
      (logins.length > 0
        ? await count(supabaseAdmin.from("profiles").select("user_id", { count: "exact", head: true }).in("user_id", logins.map((login) => login.userId)))
        : 0);
    for (const { email } of logins) {
      if (await loginIdFor(email)) cleanupErrors.push(`login ${email} is still there`);
    }
    if (cleanupErrors.length > 0 || left > 0) {
      console.error("Cleanup failed:", { errors: cleanupErrors, rowsLeft: left });
      process.exitCode = 1;
    } else {
      console.info(
        `Cleanup: ${made.length} throwaway clients removed with their habits, entries and audit rows, ${logins.length} login with its profile; ${perfHabits.length} fixture habits removed with their entries; every minted session ended; nothing left.`
      );
    }
    await stopProofServer();
  }

  if (failures > 0) {
    console.error(`${failures} check(s) failed`);
    process.exitCode = 1;
  } else {
    console.info("Every route check holds.");
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
