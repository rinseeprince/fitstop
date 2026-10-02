# Habits rebuild — a habit is prescribed like training and nutrition, logged against, and judged by the week

**Status: PLAN, nothing built (2026-09-30).** Seven commits (§6), each with a pasteable prompt, each gated. **Commits 1–3 replace the engine underneath and change nothing a coach asked for except the history fixes**: commit 1 builds the new tables, their write functions, the week kernel and the new routes, used by no screen; commit 2 switches every reader, writer and screen onto them and drops the old tables (every existing habit is test data, so nothing is moved); commit 3 rewrites the docs to the new model. **Commits 4–7 build what was asked**: the coach's habit days, dated changes and reuse of a habit already given to another client (4), the client app (5), habits in the check-in on both sides (6), and the Goals table's habit lines (7). DEV is at migration 202 and in sync with the tree (`migration list --linked`, 2026-09-30); PROD is at 184 owing 185–202. Every fact marked DEV was probed on 2026-09-30 with `npx supabase db query --linked`; every file:line was grepped the same day at `a646cb79`. Row counts are per-database facts and do not travel (CONVENTIONS §8).

**The owner's model (2026-09-30), in their words:** habits should be "a similar shape to training in the sense of the coach creates a habit plan for the client and it gets assigned to the client which they log the habit against"; a coach must be able to reuse a habit for many clients; habits can be prescribed by day and on separate days; habits belong in the check-in, coach side and client side; and "a client should be able to tick habits off on days it wasn't assigned to them because they may have forgotten" (forgot to meditate Monday, did it Tuesday). Two things were proposed and **declined by the owner the same day**: a reusable habit PLAN (a bundle of habits with weeks), and a habit library page — "Habits can be created and re-used on a clients page". So adding habits to a client offers every habit the coach has already given any client, several at once; a step-up is a change dated ahead; and **the client's habits with their days and dates are their habit plan**. The owner also ruled out **habit streaks**: "too much complexity to manage given habits can be set on different cadences". This reverses the 22 Sep ruling ("habits should be completely customized to the client") only as far as reuse goes: a reused habit is copied onto the client, and the copy is the client's own.

**Scope:** the habit model and everything that reads or writes it — the two tables `daily_habits` / `daily_habit_logs` and their replacement, the coach's Habits tab, the Overview's habit row, the attention feed's habit alert and its no-engagement test, the activation card's "Daily habits" item, the client's home card, habits page and Journey habits, the check-in (the client's wizard, the frozen copy, the coach's review, the AI's week), reusing a habit already given to another client, and the Journey → Goals table's habit lines. **Not in scope:** a habit library page and habit streaks (owner, 2026-09-30); reminders or notifications for habits; habits in the program builder or on the training calendar; habit targets tied to training days; converting habit units; any change to the day rule (`lib/daily-log-permissions.ts`), the week anchor (`lib/check-in-week.ts`) or the logged-day definition beyond its habit source; the check-in's other steps.

**How this plan is used.** Each commit's prompt tells a fresh session to read `CONVENTIONS.md` whole, this file whole, and only the ARCHITECTURE sections it names, and to build without a plan review. ARCHITECTURE, CONVENTIONS, `CLIENT-APP-REFERENCE.md` and `docs/CLIENT-PORTAL-REDESIGN.md` describe the old model in the places §4 lists (the portal doc wins over ARCHITECTURE on a client-portal write path, ARCHITECTURE:5): where they do, **§2 wins and the session lists each such line in its handover**; it stops only when a §3 decision it needs is blank, when building as listed would break a CONVENTIONS rule §4 does not mark for rewriting, or when a gate's root fix lies outside its commit. When a commit ships, the session replaces that commit's STATUS line in §6. When every commit has shipped, this document is deleted on the owner's confirmation (ARCHITECTURE holds the shape, git holds this file).

---

## 1. Why the shape changes (verified 2026-09-30)

- **Nothing is reusable.** A habit is a row on one client (`daily_habits.client_id NOT NULL`, `UNIQUE (client_id, name)`, migration 030); no library table exists. "Drink 3 L water" on 30 clients is 30 typed habits.
- **Every habit is every day, open-ended.** No weekday, frequency or end column; "did the habit exist that day" is `effective_date <= date` everywhere it is asked.
- **Stopping a habit rewrites the past.** The Overview's adherence read (`services/client-adherence-service.ts:297-301`), the Habits tab's week read (`services/habits-weekly-service.ts:43-48`) and the attention feed (`services/attention-feed-service.ts:154-164, 386`) select `is_active = true`, so a habit switched off leaves every past week of those screens. Only a sent check-in keeps it (its copy froze `perHabit`, migration 195).
- **Switching one back on corrupts it both ways.** The drawer's Reactivate (`PUT …/habits/[habitId]` `{ isActive: true }`, `hooks/use-client-habits.ts:194-205` → `updateHabit`) keeps the old `effective_date`, so the weeks it was off count as misses; adding a habit with the same name (`createHabit`, `services/daily-habits-service.ts:64-112`) reuses the switched-off row and moves `effective_date` to the client's today, hiding every earlier tick.
- **Targets are labels.** `updateHabit` overwrites `target_value` in place and every reader embeds the current target, so an old week reads against today's number. The client's screen is a switch (`components/client-portal/habits/habit-toggle-row.tsx`) and the page posts `{ dailyHabitId, date, completed }` alone (`app/client/habits/page.tsx:117`), so "3 L water" is recorded as a tick and no number is ever entered from the app; the log route validates `notes` and drops it (`app/api/client/habits/log/route.ts:47-53`, `services/daily-habits-service.ts:257-264`).
- **The figures disagree with each other.** The drop-off alert judges existence by `created_at` (`lib/activity-triggers.ts:38-42`, pinned by `__tests__/lib/attention-triggers.test.ts:363`), every other surface by `effective_date`. The Overview's habit figure is the mean of daily percentages (`client-adherence-service.ts:213-215`), the Habits tab's the pooled rate (`habits-weekly-service.ts:193-204`). The Overview draws a faint "no log" dot on days before any habit existed, because `classifyHabitDay` never returns `none` (`client-adherence-service.ts:76-86`). The Journey's 30-day rate divides a 29-day read by 30 and ignores when a habit began (`components/client-portal/metrics/habits-section.tsx:55-62`). The home card's done count can exceed its total (`services/client-day-service.ts:58`). The tab's all-habits streak reads 0 until every habit is ticked today, while the per-habit streak starts yesterday (`habits-weekly-service.ts:218-256`, `services/daily-habits-logic.ts:17-48`). "Today" is the device's on the tab and the Journey, the coach's on the week figures and the alert, the client's on the Overview. The check-in copy lists habits in database order (`client-adherence-service.ts:297-301` has no order).
- **The plumbing breaks CONVENTIONS.** No habit read sits behind a key builder and an invalidator (§7): the tab's `refreshWeekAfter` (`components/clients/habits/habits-tab-content.tsx:62-71`) is the named anti-pattern, and no habit write refreshes the Overview's adherence row (whose key is not even exported, `hooks/use-client-adherence.ts:13-15`), the feed or the activation card. The coach habit routes use `apiRateLimit`, call `getAuthenticatedCoachId()` without the request and verify ownership their own way — `[habitId]/route.ts:10-22` checks the habit's coach and ignores the path's client (`app/api/clients/[id]/habits/route.ts:26, 68-90`). The stats read is fetched and never rendered (`hooks/use-client-habits.ts:40-73`); the coach `/habits/logs` read has no caller. The drawer's Delete says "This action cannot be undone" of a reversible switch-off (`components/clients/habits/habit-actions.tsx:65-67`), and reordering under a search sends a subset of ids (`habits-manage-drawer.tsx:54-68`).
- **Check-ins.** The client's wizard — Feeling, Metrics, Photos, Training (`lib/check-in/form-fields.ts:26-31`) — and `GET /api/client/check-in-context` carry no habits. The coach's review shows each habit's ticks over its eligible days (`components/check-in/habits-section.tsx`), frozen at Send and fed to the AI, with no target, number, planned day or note.
- **DEV data:** 638 habits on 211 clients (636 switched on), 40,740 logs from 4 Jun 2025 to 25 Sep 2026 — 10,877 unticked, 1,452 carrying a number, none carrying a note, none dated before its habit's start, none whose client differs from its habit's. Four number habits (two "Sleep hours" at 8 h, two "Water intake" at 3 L, on seed clients): 18 of their logs carry no number, and their ticks do not follow their numbers. One tick habit carries a target ("Drink 3L water", 3 L). Two are switched off: "Drink 3 litres" (4 logs, 17–23 Sep, last changed 22 Sep UTC) and one with no logs. **All of it is test data (owner, 2026-09-30), so none of it is moved (D3). PROD: probe at execution.**

## 2. The target shape

### 2.1 Tables

The client's five tables, created by commit 1 (migration 203). Weekdays use the product's one spelling, the lowercase names of `DayOfWeek` (`types/check-in.ts:15`; `DAY_NAMES`, `lib/date-helpers.ts:169`), as `nutrition_plan_daily_targets.day_of_week` does.

```sql
CREATE TABLE public.client_habits (            -- the habit: what it is
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id   UUID NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  name        TEXT NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 100),
  how_to      TEXT CHECK (char_length(how_to) <= 500),           -- shown to the client
  measure     TEXT NOT NULL CHECK (measure IN ('tick', 'number')),
  unit        TEXT CHECK (char_length(btrim(unit)) BETWEEN 1 AND 20),
  direction   TEXT CHECK (direction IN ('at_least', 'at_most')),
  position    INTEGER NOT NULL DEFAULT 0,
  created_by  UUID REFERENCES public.coaches(id) ON DELETE SET NULL,
  created_at, updated_at,                                         -- TIMESTAMPTZ NOT NULL DEFAULT now()
  CONSTRAINT client_habits_measure_shape CHECK (
    (measure = 'tick'   AND unit IS NULL AND direction IS NULL) OR
    (measure = 'number' AND direction IS NOT NULL))
);                                                                -- index (client_id, position)

CREATE TABLE public.client_habit_versions (    -- the prescription: a run of days
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_habit_id  UUID NOT NULL REFERENCES public.client_habits(id) ON DELETE CASCADE,
  starts_on        DATE NOT NULL,
  ends_on          DATE,                                          -- NULL: runs on
  target           NUMERIC(10,2) CHECK (target >= 0),             -- a number habit's; NULL on a tick habit
  times_per_week   SMALLINT CHECK (times_per_week BETWEEN 1 AND 7), -- NULL: its weekdays below
  created_by       UUID REFERENCES public.coaches(id) ON DELETE SET NULL,
  created_at, updated_at,
  CONSTRAINT client_habit_versions_dates CHECK (ends_on IS NULL OR ends_on >= starts_on),
  CONSTRAINT client_habit_versions_no_overlap EXCLUDE USING gist
    (client_habit_id WITH =, daterange(starts_on, ends_on, '[]') WITH &&)
);                                                                -- index (client_habit_id, starts_on)

CREATE TABLE public.client_habit_version_days (-- the weekdays a set-days version is planned on
  version_id  UUID NOT NULL REFERENCES public.client_habit_versions(id) ON DELETE CASCADE,
  weekday     TEXT NOT NULL CHECK (weekday IN ('monday','tuesday','wednesday','thursday','friday','saturday','sunday')),
  PRIMARY KEY (version_id, weekday)
);

CREATE TABLE public.client_habit_day_edits (   -- the coach's change to one date
  client_habit_id  UUID NOT NULL REFERENCES public.client_habits(id) ON DELETE CASCADE,
  date             DATE NOT NULL,
  planned          BOOLEAN NOT NULL,                              -- on that day, or off it
  target           NUMERIC(10,2) CHECK (target >= 0),             -- that day's target; NULL: the version's
  coach_id         UUID REFERENCES public.coaches(id) ON DELETE SET NULL,
  created_at, updated_at,
  PRIMARY KEY (client_habit_id, date),
  CONSTRAINT client_habit_day_edits_target_when_planned CHECK (planned OR target IS NULL)
);

CREATE TABLE public.client_habit_logs (        -- the client's entry: one per habit per day
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_habit_id  UUID NOT NULL REFERENCES public.client_habits(id) ON DELETE NO ACTION,
  client_id        UUID NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  date             DATE NOT NULL,
  done             BOOLEAN,                                       -- a tick habit's answer
  value            NUMERIC(10,2) CHECK (value >= 0),              -- a number habit's answer
  note             TEXT CHECK (char_length(note) <= 500),
  created_at, updated_at,
  CONSTRAINT client_habit_logs_one_per_day UNIQUE (client_habit_id, date),
  CONSTRAINT client_habit_logs_one_answer CHECK ((done IS NULL) <> (value IS NULL))
);                                                                -- index (client_id, date)
```

- **`client_habit_version_days` carries no timestamps**: its rows are written and removed with their version and never updated — the comment CONVENTIONS §8 asks of such a table goes on it.
- **Privileges** (CONVENTIONS §8, the goals shape of migration 193): RLS on, no policy; `REVOKE ALL … FROM PUBLIC, anon, authenticated, service_role`; `GRANT SELECT` on the four prescription tables (every write is a function, rule 8) and `GRANT SELECT, INSERT, UPDATE, DELETE` on `client_habit_logs` (the client's own upsert). `updated_at` through the shared `update_updated_at_column()` trigger (193:98-103).
- **`client_habit_logs.client_id` is a sanctioned denormalisation**, as on every client log: the day reads (the logged-day kernel, the feed, the day summary) find a client's entries by `(client_id, date)`; the entry service writes it from the habit it has just proved is the client's. Documented in ARCHITECTURE by commit 3.
- **The entry's foreign key to its habit is `NO ACTION`** (the `check_in_answers` precedent, ARCHITECTURE "The customisable form"): a client's teardown removes entries and habits in one statement, while deleting a habit that has entries fails — the database half of rule 12.
- **No library table** (owner, 2026-09-30: "Habits can be created and re-used on a clients page"): the habits a coach can reuse are read from their clients' own habits by one read function, `coach_habit_choices(p_coach_id, p_client_id, p_today)` — `STABLE`, `SECURITY DEFINER`, `service_role` alone — returning one row per name and way of measuring among the habits not deleted, with the how-to, target and days of its most recent version, less the habits that client has running or planned. The answer is bounded by the coach's habits, not by the size of their roster.
- **Alternatives considered** (CONVENTIONS §8 asks for them): *one row per habit per day* (training's shape) — rejected: a habit-day is never moved, opened or pointed at the way a workout is, so storing 365 rows per habit per year buys nothing and makes every change a re-lay of future rows with a deletion floor, the machinery nutrition deliberately removed (migration 169 onward); *the target and days as columns on `client_habits`, rewritten on change* — today's shape, the cause of §1's history bugs; *the weekdays as an array on the version* — sanctioned by §8 for a closed, never-referenced set, but the join table is §8's first form and its primary key makes a duplicate weekday impossible; *a target copied onto each entry* — rejected for the reason nutrition rejected it (ARCHITECTURE "A logged day carries no target"): a started version never changes, so the copy could only be a second answer; *a library table of the coach's habits, with its own page* — declined by the owner (2026-09-30): a habit is created and re-used on a client's page, and the choices are read from the habits the coach has already given (rule 11).

### 2.2 Rules of the shape (each deletes a rule that exists today)

1. **A client habit is its identity**: name, how-to, how it is measured, its place in the list. Name and how-to are labels, changed any time; a sent check-in keeps the name it froze. **How it is measured never changes**: a tick, or a number with a unit that is *at least* (water, steps, sleep) or *at most* (drinks, screen time); measuring something else is a new habit. A number habit always has a target. (Deletes: `is_boolean` flipping; a target typed on a tick habit.)
2. **Its prescription is its versions.** Each is a run of days with its target and its days — chosen weekdays (every day is all seven) or N times a week. Versions of one habit never overlap and may leave gaps. **A version is never edited once its first day has passed.** Every change starts on a day the coach picks, today or later on the client's calendar: the version running the day before ends then; a version starting on that day is replaced; a version already queued after it stands, and the new one runs until the day before it. **Stopping** ends the running version the day before the chosen day and removes what is queued from it; **starting again** is a new version after the gap — the same habit, one history. (Deletes: `is_active`, `effective_date`, reactivation by name, targets edited in place.)
3. **A day is planned** when a set-days version covers it on one of its weekdays, unless a one-date edit says otherwise. **A one-date edit** is for set-days habits only and only today onward: it takes the day off, puts it on, or sets that day's target. A weekly version (N times a week) plans no particular day.
4. **The client can make an entry on any day a version covers, planned or not** (owner, 2026-09-30). One per habit per day: a tick habit's entry is done or not done, a number habit's is a number of zero or more, and either can carry a note. A day no version covers takes no entry. Every entry obeys the day rule — the week their current check-in covers, and every day since (`assertCanEdit`); the future is locked. (Deletes: a client-supplied `completed` beside a value; dropped notes.)
5. **Met is worked out, never stored.** A tick entry is met when done; a number entry when it meets the day's target in the habit's direction — the one-date edit's target, else the covering version's. Because rule 2 forbids editing a started version and one-date edits are today onward, **every entry is judged against the target its day had, forever** — nutrition's guarantee, with no copy on the entry.
6. **The week is judged; days are shown as they happened.** For each habit and each client week (the check-in-anchored week, `checkInWeekday`): *planned* is the planned days (rule 3), plus, for a weekly version, N capped at the days it covers that week (D2); *done* is the days holding a met entry on a covered day; ***met* = min(done, planned)**. A done day that was not planned therefore counts toward its week up to the planned number — the client who forgot Monday and did it Tuesday is 1 of 1. Every screen shows each day as it happened: the planned Monday reads not done, the Tuesday reads done. The Overview's habit row and the missed-habit alert read days that way alone (D8, D4): a planned day counts as done only by an entry on that day — a client who did Monday's habit on Tuesday can still log it on the Monday itself while their week is open.
7. **One kernel answers every habit figure** (§2.3): the client's day and week, the coach's week tracker and summary, the Overview's row, the missed-habit alert, the check-in's frozen week, the AI's lines, and the words that describe a schedule and a target. Nothing else counts entries (§5's scan). Every habit figure is judged on the **client's** calendar (ARCHITECTURE "Timezone model": whose calendar is this date on?), except the feed's window, which stays the coach's by that section's rule.
8. **Every write of the prescription is a database function** — the goals precedent (migration 193): `SECURITY DEFINER`, `SET search_path = public`, executable by `service_role` alone, one transaction, serialised per client by `pg_advisory_xact_lock(hashtextextended('client_habits:' || p_client_id::text, 0))`, judged against the client's today passed as a required `p_today`, refusing in `'code: message'`, and writing nothing when nothing changed. Optional values are `DEFAULT NULL` and omitted when null (the goal service's idiom, `services/client-goal-writes-service.ts:126-150`). **Entries are the client's own single upsert** on `(client_habit_id, date)`, like the food and wellness logs, after the service proves the habit is the client's, a version covers the day, the answer fits the measure and the day is open.
9. **A sent check-in freezes its habit week** — sent-snapshot version 3: each habit as prescribed that week (its versions overlapping the week), each day's facts (covered, planned, target, the entry, met, the note) and the week's figures, plus the week's totals. Copies saved before (versions 1 and 2) are read into the same shape: a tick habit planned on every day it existed, its rail's ticks as its entries.
10. **A habit's unit is the coach's word**, shown as typed and never converted by anyone's unit preference — as today; a value is stored as entered. CONVENTIONS §20 gains the case beside calories and cadence ("stored and read the same").
11. **Reuse happens on the client's page** (owner, 2026-09-30): adding habits to a client offers every habit the coach has given any client, one line per name and way of measuring, each with the how-to, target and days of its most recent version (`coach_habit_choices`); the coach ticks one or several, adjusts them, and each becomes the client's own copy. Nothing is shared between clients and there is no library to keep: the list is read, never stored, so a habit leaves it only when no client has it any more.
12. **Removing a habit** (D6): any habit can be deleted. One the client never made an entry for is removed completely; one with entries is stopped from today and marked deleted — it leaves the coach's list, the order, the reuse list and the missed-habit alert, no coach write reaches it again, and every read of the past keeps it for the days it ran. Stopping from today keeps an entry the client already made today, counted in no figure — a day no version covers, like a meal on a day with no target.

### 2.3 The kernel — `lib/habits/`, pure and client-safe

It never imports `supabaseAdmin` (`npm run check:service-key` holds that) and is shared by the server, the browser and the seeds. Built in commit 1, with a test and a mutation for every rule.

| Module | Answers |
|---|---|
| `habit-day.ts` | For a habit and a date: is it covered, is it planned, what is its target, which version — versions, set days, one-date edits; the weekday through `DAY_NAMES` |
| `habit-entry.ts` | Is an entry met, against the day's target, in the habit's direction |
| `habit-week.ts` | A week's figures (planned, done, met; each day's facts) for any list of dates inside one client week — a check-in period clamped to the start date included; a range read day by day (the Overview's 14 days, the alert's 7), each day by its own planned habits (D8, D4) |
| `habit-words.ts` | The words every screen uses: a schedule ("Every day", "Mon, Wed, Fri", "3 times a week"), a target ("at least 3 L", "at most 2 drinks"), a week figure ("2 of 3") |

The DB-reading half is `services/client-habits-service.ts` (a client's habits in order, with versions, their days and one-date edits in one embedded read; entries over a range; the cross-client, chunked and paged reads for the feed through `lib/paged-fetch.ts`), `services/client-habit-writes-service.ts` (the functions, typed `Args`, refusal codes to a `HabitWriteError`; the entry upsert and delete) and `services/client-habit-figures-service.ts` (assembles one client's or many clients' kernel inputs with the client's week anchor — `getClientWeekAnchor` / `checkInWeekday` — and today — `getClientTodayString`, and hands back figures).

### 2.4 Routes

Commit 1 builds every route whose path is new; commit 2 builds the four whose paths the old routes hold, and connects the screens. **Coach routes** run the full chain — `coachApiRateLimit` → CSRF on a write → `requireCoachOwnsClient(clientId, request)` → a strict zod schema → the service scoped to the client — and record `recordAuditEvent` after a write that changed something. **Client routes** run `requireClientAuth` (both tiers) and answer GETs `no-store`.

| Route | Does | Commit |
|---|---|---|
| `GET /api/clients/[id]/habits` | The client's habits but the deleted, in order: identity, versions (the history), one-date edits from the client's today, whether any entry exists, running / upcoming / stopped | 2 |
| `POST /api/clients/[id]/habits` | Add one or more habits from a start day (`add_client_habits`) — audit `habit.create` | 2 |
| `PATCH /api/clients/[id]/habits/[habitId]` | Name and how-to (`rename_client_habit`) — `habit.rename` | 2 |
| `DELETE /api/clients/[id]/habits/[habitId]` | Delete any habit from the client's today: removed with no entries, else stopped and marked deleted (`delete_client_habit`) — `habit.delete` | 2, 3 |
| `POST …/habits/[habitId]/change` | Target and days from a day; also starts a stopped habit again (`change_client_habit`) — `habit.change` | 1 |
| `POST …/habits/[habitId]/stop` | Stop from a day (`stop_client_habit`) — `habit.stop` | 1 |
| `PUT …/habits/order` | The client's habits in their new order (`order_client_habits`) | 1 |
| `PUT` / `DELETE …/habits/[habitId]/days/[date]` | A one-date edit, and its reset (`set_client_habit_day`, `reset_client_habit_day`) — `habit.day_edit` | 1 |
| `GET …/habits/week?start=` | The week tracker and summary: each habit's days and figures, totals, today | 1 |
| `GET /api/client/habits/day?date=` | Every habit a version covers on the date: identity, planned that day, the day's target, the entry, the week's figures, the words | 1 |
| `GET /api/client/habits/week?start=&end=` | The habit week over dates inside one client week (the check-in's step), same figures as the coach's | 1 |
| `PUT` / `DELETE /api/client/habits/[habitId]/days/[date]` | The entry — `{ done }` or `{ value }`, optional `note` — answering with the habit's day and week figures; 404 a habit that is not theirs, 409 "That habit isn't running on that day.", 400 an answer that does not fit the measure, 403 "This day is locked." | 1 |
| `GET /api/client/habits/progress?weeks=` | The Journey: per habit its recent weeks' figures, its last 28 days' facts | 1 |
| `GET /api/clients/[id]/habits/choices` | The habits the coach has given any client and not deleted — one per name and way of measuring, with the latest version's how-to, target and days — less the ones this client has running or planned (`coach_habit_choices`) | 1 |

Wires that change shape: `GET /api/client/day-summary`'s `habits` (commit 2), `GET /api/clients/[id]/adherence`'s `habits` (commit 2), `GET /api/clients/[id]/activation-readiness`'s `hasHabits` meaning (a habit running today or later, commit 2), `GET /api/client/check-in-context` gains `habitWeek` (commit 6), `GET /api/client/check-ins/[id]` gains `habits: { met, planned } | null` (commit 6). The old client habit routes (`GET /api/client/habits`, `…/logs`, `…/logs/today`, `POST …/log`) and coach routes (`…/reorder`, `…/stats`, `…/weekly`, `…/logs`, `PUT …/[habitId]`) are deleted in commit 2. **Every client wire change is written into `CLIENT-APP-REFERENCE.md` in the commit that makes it** — the React Native app is the real client (ARCHITECTURE "The React Native contract"), and these are deliberate contract changes, not drift.

### 2.5 What the screens show

**The coach's Habits tab** (Clients → a client → Daily habits; end state in commit 4):

One client's week — Thursday 24 to Wednesday 30 September — runs through all four sketches. The tab, on the Wednesday morning:

```
 This week 8/13 · Today 0/2 · Habits 3                                         (StatBand)
 ‹ Thu 24 Sep – Wed 30 Sep ›                                             + Add habits
 Habit                               Thu  Fri  Sat  Sun  Mon  Tue  Wed   Week
 Water · at least 3 L · Every day    3.1  3.0  2.1  3.2  2.5  3.0   ·    4/7   ⋯
 Mobility · Mon, Wed, Fri                  ✓              ○    ✓    ·    2/3   ⋯
 Sauna · 3 times a week                    ✓         ✓                   2/3   ⋯
 Stopped: Meditation — stopped 12 Sep                                  Start again
```

Mobility's Monday was planned and not done; its Tuesday was not planned and is done, and counts toward the week. Water's Saturday (2.1) and Monday (2.5) fell short of 3 L. Wednesday is today: two habits planned, nothing entered yet. The row menu ⋯: Change target or days · Stop · Rename · History · Delete. A cell of a set-days habit from the client's today onward opens "This day": Planned / Not planned, that day's target, Reset. **+ Add habits** opens a sheet with **Your habits** — every habit you have given any client, one line each ("Water · at least 3 L · Every day") — and **New habit**: tick several, adjust them, pick the day they start, save once.

**The client's habits page** (`/client/habits?date=`; end state in commit 5) — the same client on the Tuesday, after making up Monday's mobility:

```
 Habits · Tue 29 Sep
 PLANNED TODAY
 Water       [ 3.0 ] L   at least 3 L          4 of 7 this week
 ANY DAY THIS WEEK
 Sauna       [     ]                           2 of 3 this week
 NOT PLANNED TODAY
 Mobility    [  ✓  ]     Mon, Wed, Fri         2 of 3 this week
```

**The client's check-in, a Habits step after Training** (commit 6), shown only when the client had a habit that week — the same client checking in on the Wednesday evening, before filling in the day:

```
 Your habits · 24 – 30 Sep        Thu   Fri   Sat   Sun   Mon   Tue   Wed
 Water · at least 3 L a day       3.1   3.0   2.1   3.2   2.5   3.0  [   ]   4 of 7
 Mobility · Mon, Wed, Fri         [ ]    ✓    [ ]   [ ]   [ ]    ✓    [ ]    2 of 3
 Sauna · 3 times a week           [ ]    ✓    [ ]    ✓    [ ]   [ ]   [ ]    2 of 3
```

Planned days are marked; every day a version covered is open while the day rule allows; the figures move as the client fills a gap.

**The coach's review** (commit 6) of that check-in, after the client entered 3.0 L of water, their mobility and a sauna on the Wednesday: the top strip gains **Habits** after Training ("11/13", its percentage, "habit days done"), and the Habits section becomes the week as it was prescribed:

```
 HABITS                                                        11/13 done
 Habit                           Thu  Fri  Sat  Sun  Mon  Tue  Wed   Week
 Water · at least 3 L            3.1  3.0  2.1  3.2  2.5  3.0  3.0   5/7 · avg 2.8 L
 Mobility · Mon, Wed, Fri         –    ●    –    –    ○    ●    ●    3/3
 Sauna · 3 times a week           –    ●    –    ●    –    –    ●    3/3
 Sat · Water — "Travelling, only had the one bottle"
```

**Copy that changes** (the building session settles the exact words and lists them in its handover; each can be changed at the smoke): the drawer's Delete becomes **Stop** — "Stop Water? It stops from today. Its past stays." — and Reactivate becomes **Start again** (commit 2); the missed-habit alert lines (D4, commit 2); the Habits tab's Streak cell and the Journey's streaks go (D1, commit 2); the coach's check-in Fields card's all-off line (`check-in-form-fields-card.tsx:69-74`) becomes "…still gets the Feeling and Training steps, which confirm their week…" so it stays true beside a Habits step (commit 6).

## 3. Decisions for the owner — answer before commit 1

| # | Decision | Recommendation | Why |
|---|---|---|---|
| D1 | Streaks | **ANSWERED 2026-09-30 (owner): no streaks** — "too much complexity to manage given habits can be set on different cadences". The Habits tab's Streak cell and the client's Journey streaks go in commit 2, with the code that computes them. | — |
| D2 | A weekly habit in a part week | **ANSWERED 2026-09-30 (owner): yes.** **Never ask for more times than the days it runs that week.** "3 times a week" started with 2 days left in the week asks for 2. | Always N marks a new habit a miss in its first week; N × days/7 gives fractions. |
| D3 | Moving today's habits across | **ANSWERED 2026-09-30 (owner): nothing is moved** — every existing habit and entry is test data. Commit 2's migration drops the old tables; the seeds create fresh habits through the new functions. Sent check-ins keep their frozen copies, which still read (rule 9). | — |
| D4 | The habit alert | **ANSWERED 2026-09-30 (owner): missed habits, one line each.** A habit is listed when the client missed 3 or more of its planned days in the last 7 days, in a row or not — "Missed Water 4 days". A missed day is a planned day gone by without the habit done on it; a number short of its target counts as missed. Several habits are several lines under the client's row, which the coach expands to see them all, as with every other alert today (`components/dashboard/needs-attention-feed.tsx`); each line is dismissed on its own — its dismissal keyed by the habit (`attention_dismissals.alert_type` is free text, unique per coach, client and type) — and comes back when the habit is missed again on a later day. A times-a-week habit has no planned days, so it is not in this alert. `HABIT_MISSED_DAYS` (3) and `HABIT_MISSED_WINDOW_DAYS` (7) join `lib/constants.ts`; `HABIT_DROPOFF_DAYS_IN_WEEK` goes; `HABIT_DROPOFF_THRESHOLD_PERCENT` stays for the Overview's "days below 50%". | The owner's words: "if a habit is missed more than 3 days in a row, more than 3 days in a week, it is listed on the attention feed … so samuel has missed X habit for 3+ days, has missed Y habit for 3+ days. and the coach has to expand the needs attention feed row for that client to see." Read as their "3+" — 3 or more — over the last 7 days, which holds three in a row. |
| D5 | A habit library | **ANSWERED 2026-09-30 (owner): no library page** — "Habits can be created and re-used on a clients page" (rule 11). | — |
| D6 | Deleting | **REVISED 2026-09-30 (owner), built in commit 3: every habit can be deleted, and nothing logged is lost.** A habit the client never logged is removed completely (CONVENTIONS §8's hard-delete exceptions gain it: nothing references it). A logged habit is soft-deleted: it leaves the coach's list and the client's habits page from the day it is deleted (it runs no day from then, and cannot be started again), and everything already logged stays exactly where it is: the Habits tab's past weeks, the Overview's past days, the client's Journey, sent check-ins. Commit 2 shipped the first answer (a logged habit could only be stopped); the owner, at commit 2's smoke: "IT'S A FUCKING HABIT. WHAT IS WRONG WITH DELETION?" and "logged data and prescription would be frozen in time no matter what". | Erasing a logged habit would erase its entries with it (each entry belongs to its habit), so a delete keeps the row and marks it. |
| D8 | The Overview's habit dots | **ANSWERED 2026-09-30 (owner): as it is today** — "because a client can go back and log Monday even if they did it on tuesday". Each day's dot is that day's planned habits done on that day; the figure beside the dots and its "days below 50%" line count the same way, with no credit for a habit done on another day. A day with nothing planned is a dash (today a "no log" dot is drawn on days before any habit existed). | — |

**Owner's answers (2026-09-30), every decision answered:** D1 — no streaks · D2 — yes · D3 — nothing is moved, the old habits are test data · D4 — missed-habit lines · D5 — no library page, habits are reused on the client's page · D6 — yes · D8 — as today. D7 and D9 were withdrawn: habit units stay as they work today, and the mislabel on the client's sent check-in card was fixed on its own (`b7389cf8`).

## 4. Blast radius — every dependant, by subsystem

Grepped 2026-09-30 at `a646cb79` (`daily_habits`, `daily_habit_logs`, `DailyHabit*`, `HabitLogWithDetails`, `HabitBreakdown`, `perHabit`, `classifyHabitDay`, `HABIT_DROPOFF`, every habit service, hook and route). **No database function, view or trigger body references either old table** (the last, `transition_phase_atomic`, went in migration 133); the two tables carry their keys, five indexes, two `updated_at` triggers and no policy (migration 201). There is no e2e folder.

| Subsystem | Today | After | Commit |
|---|---|---|---|
| **Old services** — `services/daily-habits-service.ts` (+ test), `daily-habits-logic.ts`, `daily-habits-mappers.ts`, `daily-habits-stats.ts`, `habits-weekly-service.ts` (+ test); `lib/validations/daily-habit.ts`; `types/daily-habit.ts`; `types/history.ts:52-84` (`WeeklyHabit*`, `WeekSummary`) | the old model | deleted once nothing calls them; `lib/check-in-week.test.ts:73`'s exemption for the weekly service goes with it | 2 |
| **New engine** — migration 203; `lib/habits/*`; `types/habits.ts`; `services/client-habits-service.ts`, `client-habit-writes-service.ts`, `client-habit-figures-service.ts`; `lib/validations/client-habits.ts`; `lib/habits/habit-write-response.ts` (refusal → status and sentence, the goals' `goal-write-response.ts` shape); `AUDIT_ACTIONS` (`lib/constants.ts:190-216`) gains the habit actions | — | built, tested, proven; used by the new routes alone | 1 |
| **Coach habit routes** — `app/api/clients/[id]/habits/route.ts` (GET, POST), `[habitId]/route.ts` (PUT, DELETE), `reorder/`, `stats/`, `weekly/`, `logs/` (+ tests) | `apiRateLimit`, no `request`, local ownership (§1); stats and logs read by nothing | §2.4's routes on the full chain; the old files deleted | 1, 2 |
| **Client habit routes** — `app/api/client/habits/route.ts`, `logs/`, `logs/today/`, `log/` (+ `log/route.test.ts`) | the old wire | §2.4's routes; the old files deleted; `CLIENT-APP-REFERENCE.md:170, 179, 287-290, 771-790, 805-811, 911-916` rewritten | 1, 2 |
| **Coach Habits tab** — `components/clients/habits/*` (tab content, summary strip, week nav, week tracker, day cell, manage drawer, add form, edit inline, list item, actions); `hooks/use-client-habits.ts`, `hooks/use-habits-week.ts` | old routes; inline keys; `refreshWeekAfter` | commit 2: the same screens on the new routes, a key builder and an area invalidator, every habit write clearing the Overview, the adherence row, the feed and the activation card; Delete → Stop, Reactivate → Start again, a true Delete for habits with no entries, a direction for number habits, reorder over the whole list, the Streak cell gone (D1). Commit 4: the end state (§2.5), its Add habits sheet listing the coach's habits (rule 11) | 2, 4 |
| **Overview** — `services/client-adherence-service.ts` (habits part, `classifyHabitDay`), `types/coach-overview.ts:98-172` (`HabitBreakdown`, `AdherenceSummary.habits`), `components/clients/overview/adherence-card.tsx:225-240`, `hooks/use-client-adherence.ts` (+ tests `client-adherence-service.test.ts`, `adherence-card.test.tsx`) | active habits only; mean of daily %; no `none` dot; key not exported | the same rail, figure and sub-line as today, each day judged by its own planned habits (D8), a day with nothing planned a dash; the key builder and a clear exported and called by every habit writer | 2 |
| **Attention feed** — `services/attention-feed-service.ts:154-177, 386-392`, `lib/attention-feed-helpers.ts:77-84, 183-227, 280, 307-313, 331-335`, `lib/activity-triggers.ts:17-78`, `lib/engagement-triggers.ts:17, 41`, `lib/attention-alert-copy.ts:42-45, 96`, `lib/constants.ts:181-182`, `types/attention-feed.ts:14` (+ `__tests__/lib/attention-triggers.test.ts:334-412`, `engagement-triggers.test.ts`, `attention-feed-service.test.ts`, `attention-alert-copy.test.ts`) | active habits; `created_at` existence; days under 50% | the cross-client figures read (chunked, paged, degrading as today); D4's rule and words; "prescribed work" = a habit covering a day of the window; habit entries as a logged-day source | 2 |
| **Logged days** — `lib/logged-days.ts:24`, `services/client-adherence-service.ts:145`, `lib/attention-feed-helpers.ts:280` (+ `lib/logged-days-ownership.test.ts`) | every `daily_habit_logs` row | every `client_habit_logs` row (either answer is the client acting; D11 of the measurement workstream unchanged) | 2 |
| **Day summary and readiness** — `services/client-day-service.ts:16-61`, `app/api/client/day-summary/route.ts`, `types/client-day.ts:18`, `app/api/clients/[id]/activation-readiness/route.ts:44-46, 63`, `lib/activation-readiness-items.ts` (+ tests) | `{ totalCount, loggedCount }`; `hasHabits` = any active | `{ plannedToday, doneToday, running }`; `hasHabits` = a habit running today or later | 2 |
| **Client screens** — `app/client/habits/page.tsx` (+ test), `components/client-portal/habits/habit-toggle-row.tsx`, `components/client-portal/day/habits-card-summary.tsx` (+ test), `components/client-portal/metrics/metrics-hub.tsx:100-119, 207`, `habits-section.tsx`, `habit-progress-card.tsx` (+ `metrics-hub.test.tsx`), `app/client/page.tsx` | old routes; a switch; device clocks | commit 2: the new routes (a tick switch, a number box, the day summary refreshed through `clientDaySummaryKey`, the Journey's streaks gone — D1); commit 5: the end state (§2.5) | 2, 5 |
| **Check-in freeze** — `lib/check-in/sent-snapshot.ts:29, 125-191, 208-254` (+ test), `services/check-in-sent-snapshot-service.ts:77-89, 171-174` (+ test), `services/check-in-sent-snapshot-fill.ts:86-154` (+ test), `scripts/fill-check-in-sent-snapshots.ts` | version 2's `habits` from `getClientAdherenceForRange` | version 3 (rule 9) from the figures service over the period; `readSentSnapshot` maps 2 → 3 and 1 → 2 → 3; `period.dates` / `loggedDates` still from the adherence kernel | 2 |
| **Check-in review** — `services/check-in-details-service.ts:71-91`, `app/api/check-in/[id]/route.ts:79-107`, `components/check-in/habits-section.tsx` (+ test), `components/clients/check-ins/check-in-detail-view.tsx:160` (+ test), `components/check-in/kpi-ribbon.tsx:23-33, 153-196` (+ test — `:159-161` finds Training as the last cell by position), `lib/check-in/review-figures.ts` | ticks over eligible days | commit 2: version 3 rendered with today's look; commit 6: the Habits cell and the section of §2.5 | 2, 6 |
| **AI review** — `services/check-in-review-input-service.ts:67, 100`, `types/check-in-review-input.ts:40-41`, `utils/ai-prompt-builder.ts:57-61`, `utils/ai-prompt-week.ts:174-179`, `utils/ai-prompt-day.ts:33-34, 119-123` (+ `utils/ai-prompt-builder.test.ts:93-216, 250, 334`) | "Walk 3/7 days"; "ticked / not ticked" | commit 2: version 3 in, the pinned text unchanged; commit 6: targets, numbers, planned or not, notes | 2, 6 |
| **Client check-in** — `app/client/check-in/page.tsx:53-112, 228-317` (+ test), `lib/check-in/form-fields.ts:26-48, 100-118` (+ test), `hooks/use-check-in-form.ts` (the draft saves its step as an index), `app/api/client/check-in-context/route.ts:105-172` (+ test `:142-160`, the exact key set), `types/check-in.ts:616-658`, `app/api/client/check-ins/[id]/route.ts:72-116` (+ test `:240` — the route reads `check_ins` alone), `app/client/check-in/[id]/page.tsx:265-318`, `components/clients/check-ins/check-in-form-fields-card.tsx:69-74` (+ `check-in-form-sheet.test.tsx:173-177`) | no habits | the Habits step, `habitWeek`, the sent page's Habits line, the Fields card's line | 6 |
| **Goals table** — `services/client-goals-service.ts:169-187`, `lib/goals/goal-history.ts:32-123`, `types/client-goals.ts:51-74`, `components/clients/metrics/goals/goal-lines.tsx:28-69`, `hooks/use-client-goals.ts:129-135` (+ `use-client-goals.test.ts:101-151`, the writers scan) | no habit lines (8d3 left them for this rebuild) | habit added / changed / stopped / started again lines; habit writers clear the table | 7 |
| **Seeds, scripts, proofs** — `scripts/seed/generate.ts:349-365, 720-731, 923-933`, `scripts/seed/model.ts:427`, `scripts/seed/teardown.ts:46, 56`, `scripts/seed-scale-client.ts:145-152, 221-222, 633-650, 829-849`, `scripts/perf-fixtures.ts:17`, `scripts/perf-baseline.ts:32, 136-139, 212-290`, `scripts/check-in-sent-snapshot-proof.ts:157-162, 245`, `scripts/data-api-writes-proof.ts:151-162, 239, 269-296, 367-375, 400-402` | write and count the old tables | habits through `add_client_habits` (a seed passes the historical start as `p_today` — the function's belt trusts its caller, as the goal seeds do), entries written directly; counts and proofs on the new tables | 2 |
| **Memory seeds** — the AI-review smoke's and the 8d1 freeze smoke's DO blocks insert habit rows | the old tables | named in commit 2's handover so their memory records are rewritten (a memory update, not repo work) | 2 |

**Doc lines that describe the old model** — rewritten to the current shape only (a removal leaves no sentence), each in the commit that makes it false:

| File:line | Says today | Commit |
|---|---|---|
| `docs/ARCHITECTURE.md:49, 53` (Data Hierarchy) | `daily_habits`, `daily_habit_logs` | 3: the five tables |
| `docs/ARCHITECTURE.md:205, 211` (Daily logs) | `daily_habit_logs` "keyed the same way"; a habit log ticked or unticked | 3 |
| `docs/ARCHITECTURE.md:943-978, 1011, 1017, 1028, 1032` (Client Portal) | habits write `daily_habit_logs`; the old routes; full-return habits; the Journey's "habit progress + streaks" | 2 (routes, the wire) and 3 (the model) |
| `docs/ARCHITECTURE.md:1079, 1121, 1140, 1176, 1182, 1353` (Coach-side) | `HabitsHistoryTable` (stale); "`habits.perHabit` … died" (stale); `withHabitLogs: false`; the drop-off trigger; `hasHabits` | 3 |
| `docs/ARCHITECTURE.md:1484-1536, 1653-1654, 1731-1790, 1829, 1837-1849, 1879-1881` (Check-in System) | "the habits as they stood"; the section order; the review input's habit figures; `useWellnessData`'s habit logs (stale); "Habits divide by eligible days"; `perHabit` from the habit list | 3 (the copy, the figures) and 6 (the step, the cell, the section, the AI) |
| A new ARCHITECTURE section, **"Habits"**, beside "Nutrition & Training Events" | — | 3; extended by 4–7 |
| `CONVENTIONS.md:583` (the `is_active` pattern names daily habits), `:582` (the hard-delete exceptions, D6), `:585-587` (the lifecycle list gains habits), `:783` ("A habit with this name already exists" — an example of a constraint that goes), §20 (rule 10) | the old model | 3 |
| `docs/CLIENT-PORTAL-REDESIGN.md:15, 38, 47, 59, 113, 123, 135, 243, 281, 306, 312, 335, 370, 389, 401` — among them **:135 "Habits continue to use existing habit-log endpoints"** | the old routes as the portal's write path | 2. This doc **wins over ARCHITECTURE on a client-portal write path**, so these lines are not optional |
| `docs/CLIENT-PORTAL-EXECUTION-PLAN.md:51, 160-181, 685-689, 1141, 1226-1228, 1559-1585, 2477-2542, 2605-2612` | what each session built, dated — including Session 4.1's "Do NOT: Add new habit-log endpoints" | **leave**: a build log, not the model |
| `CLIENT-APP-REFERENCE.md` (the lines in the table above, plus `:31, 51, 57, 95-100, 1054, 1095, 1115, 1126`) | the old wire, a nonexistent `types/habit.ts` | 2, 5, 6 |
| `TECHNICAL-DEBT.md:503` ("N+1 habit stats — Open"; stale, the batch exists and nothing renders it), `:746` (the weekly route's anchor fallback) | debt against code that goes | 2 (deleted with the routes) |
| `docs/perf-baseline.md:18, 200-219` | the `getHabitLogs` baseline | 3 |
| `docs/newdesignsystem.md:673, 683, 936` (648, 658, 911 at `a646cb79`) | the habits tracker as the reference table and the protected pulse | kept true through 4; re-checked at commit 4: all three hold |
| `.claude/agents/*.md` (type-quality-checker :30, convention-enforcer :27, 68, 116-119, 196-199, implementation-planner :60, 83, 118, 151, security-auditor :100) | the old names | 3 |

## 5. Verification that nothing is missed

- **The functions (commit 1): `scripts/habit-functions-proof.ts`**, in the shape of `scripts/goal-functions-proof.ts`: one rolled-back transaction on DEV, fixture clients under the perf coach, and every rule proved twice — it holds on the live function, and it fails on a planted copy of the function with that rule taken out. Rules at least: a start before `p_today` refused; versions of a habit never overlap; a change on a version's first day replaces it; a queued version stands and the new one ends the day before it; stop removes queued versions and one-date edits from its day; starting again after a gap keeps the habit's id; a number habit refused without a target, a tick habit refused one; a one-date edit refused on a weekly version, before today and on a day no version covers; a habit with entries deleted by a mark, stopped from today with its entries kept, and no write but the entry reaching it after (commit 3); the order must name exactly the client's habits; a no-op writes nothing and returns false; a foreign habit id is `not_found`; the choices read returns one row per name and way of measuring with its newest version's defaults, and never another coach's clients' habits; `service_role` holds SELECT alone on the four prescription tables and `anon` / `authenticated` cannot execute a function.
- **The routes (commits 1 and 2): `scripts/habit-routes-proof.ts`**, request-level (a real session via `generateLink` → `verifyOtp`, a running `next dev`): a coach reaching another coach's client, a client writing another client's habit and an entry on a locked day are refused; each write leaves its audit row; the entry route's four refusals answer as §2.4 says.
- **The kernel (commit 1): a test and a mutation per rule** of §2.2 3–6 and D2 — planned by weekday; a one-date edit wins; a weekly version's cap in a part week; a make-up counted up to planned and no further; a number met at least / at most, on a one-date target; an entry on an uncovered day in no figure; a range read day by day with no credit from another day (D8); the missed-days count per habit (D4); a version change mid-week. Mutations from a copy in the scratchpad — never `git stash` or `git checkout --`.
- **The drop (commit 2):** the DEV probe immediately before the push, for the record (the §1 counts); `supabase db push --dry-run` immediately before; after the push, `gen types` and a diff; and **every DEV check-in copy read through `readSentSnapshot` without a throw**, each habit section's props from a version-2 copy equal to what it rendered before (the frozen week must not move). **PROD:** a re-probe of habit rows before the owner's push (a DROP re-probes PROD first — CONVENTIONS §8; the facts do not travel), `migration list` showing its pending files, one push that carries every pending file, PROD types diffed against the repo, `check:rls` on PROD — a checklist handed to the owner by commit 3, not run by any session (PROD at 184 owes 185–202 first).
- **Scans.** New: `lib/habits/habit-figures-ownership.test.ts` — only `services/client-habit*.ts` and the two logged-day assemblers read `client_habit_logs`, and no file under `components/`, `app/` or `utils/ai-prompt-*` counts entries or spells planned / met arithmetic of its own. Kept: `lib/logged-days-ownership.test.ts`, `lib/check-in-week.test.ts` (the new services name the anchor), `lib/training-adherence-ownership.test.ts`, `lib/session-client-ownership.test.ts`, `components/check-in/week-grid.test.tsx:239-251`. Once the old tables leave `types/database.ts`, a `.from("daily_habits")` is a type error and `tsc` is the gate.
- **Frame tests** (CONVENTIONS §7, rule 6) in every commit that moves a surface — 2, 4, 5, 6: per transition, the sources the click changes and every frame to the settled screen.
- **Gates after every commit:** `npx tsc --noEmit`, `npx eslint .`, `npx vitest run`, `npm run check:labels`, `npx knip`, `npm run check:service-key`; `npm run check:rls` for 1 and 2. **The security, load and performance review** (CONVENTIONS §2) is reported for every commit — each adds a migration, a route or a write path.
- **Browser smokes** (the owner runs them; the session seeds only what the UI cannot make in a click or two, from the steps, and hands over the list): 1 — none, the proofs are the evidence; 2 — add a tick and a number habit, stop one and start it again, the Habits tab and the Journey with no streak, the Overview's habit row, the client ticks and types a number, a check-in sent before commit 2 reads as it did, the feed's alert on a seeded client; 3 — none, it changes docs alone; 4 — a Mon/Wed/Fri habit, a 3-times-a-week habit and an at-most number habit, two habits already given to another client added in one go and one of them adjusted (the other client's unchanged), a change dated next week, a one-date edit, a stop dated ahead, History, Delete of a never-ticked habit, and after each save the week card changing in place with no loading bars; 5 — the three groups, a make-up tick moving the week's figure, a number met and missed, a note, the home card, the Journey's weeks; 6 — a gap filled in the Habits step, Back and Next keep it, Send, the sent page's Habits line, the review's cell, section and a regenerated AI review, then a coach change after Send moves nothing; 7 — a goal's row listing a habit added, changed and stopped. A client-app step signs in as "Test intake form bug" (`c1211893…`).

## 6. The commits

Each prompt is complete on its own. Paste it into a fresh session. **The session builds without a plan review** (owner, 2026-09-30): it stops only for the reasons its prompt names, and it hands over when everything the commit lists is built and every gate passes, with the browser smoke list and its seed data for the owner.

### Commit 1 — `feat(habits): the habit engine — five tables, their write functions, the week kernel and the new routes, used by no screen yet`

**STATUS: SHIPPED `978ec389` 2026-09-30.** Migrations 203 and 204 (204 corrects three of 203's catalog comments) on DEV; PROD at 184 owes 185–204, so commit 2's migration is 205. The decisions this plan left open are in the commit body.

- Migration (the next free number, 203 at planning): §2.1's five tables with their keys, CHECKs, the no-overlap exclusion (`btree_gist` is installed — migrations 144, 164, 167), indexes, `updated_at` triggers and privileges; the eight functions of rule 8 — `add_client_habits` (one or more habits from a start day, as JSON input: name, how-to, measure, unit, direction, target, weekdays or times per week; appended in order), `change_client_habit`, `stop_client_habit`, `delete_client_habit`, `rename_client_habit`, `order_client_habits`, `set_client_habit_day`, `reset_client_habit_day` — and the read function `coach_habit_choices` (§2.1), each `REVOKE`d from PUBLIC, anon and authenticated and granted to `service_role` by full signature. No data moved; the old tables untouched.
- The kernel (§2.3) with its tests and mutations; `types/habits.ts`; the three services; `lib/validations/client-habits.ts` (strict objects); the refusal map; the habit `AUDIT_ACTIONS`.
- The routes of §2.4 marked 1, with their tests (the chain, a foreign client 404, zod 400, each refusal's status and sentence).
- `scripts/habit-functions-proof.ts` and `scripts/habit-routes-proof.ts` (§5), run on DEV, their output in the commit body.
- No screen, no doc beyond the migration's own header and the code's comments: nothing in the product uses the engine until commit 2, so the docs describe it from commits 2 and 3.

```text
Read CONVENTIONS.md (whole) and docs/HABITS-REBUILD-PLAN.md (whole). From
docs/ARCHITECTURE.md read only: "Nutrition & Training Events" → "The window is
the row" (the computed-day precedent); "Client Goals & Body Metrics" →
"client_goals table" (the write-functions precedent); "Daily logs (the
day-form)"; "Client Portal Architecture" → "Date-edit permissions" and "Timezone
model"; "Check-in System" → "The week anchor". Also read
supabase/migrations/193_goals_one_row_per_goal.sql,
scripts/goal-functions-proof.ts and services/client-goal-writes-service.ts as
the shape to copy. Open another section only when something you touch points to
it.

Job: Commit 1 of docs/HABITS-REBUILD-PLAN.md §6 — `feat(habits): the habit
engine — five tables, their write functions, the week kernel and the new routes,
used by no screen yet`. Build exactly what that section lists: the migration,
the kernel, the services, the routes marked 1 in §2.4, the two proofs. Nothing
in the product may call the new code yet; the old tables and routes stay exactly
as they are.

You have my go: don't show me a plan and don't wait for my review. Plan for
yourself, build it, and hand over when it is done. Stop and ask me only if a §3
decision this commit needs is still blank on the owner's-answers line, if
building exactly what this commit lists would break a CONVENTIONS.md rule that
§4 does not mark for rewriting, or if a gate fails and its root fix lies outside
this commit. Where ARCHITECTURE, CLIENT-APP-REFERENCE.md or
docs/CLIENT-PORTAL-REDESIGN.md still describe the old habit model, §2 wins:
build to §2 and list each such line in the handover.

Done when: everything that section lists is built;
scripts/habit-functions-proof.ts and scripts/habit-routes-proof.ts pass on DEV,
every function rule holding on the live function and failing on its planted
copy; an independent review of the whole diff, docs included, has run and every
finding is fixed at the root; and every gate passes after the build and again
after the review's fixes: npx tsc --noEmit, npx eslint ., npx vitest run, npm
run check:labels, npx knip, npm run check:service-key, npm run check:rls. Never
skip, weaken or delete a test to make a gate pass. Report the security, load and
performance review (CONVENTIONS §2).

Working method: the Edit tool, not shell edit scripts; grep at execution time
for every dependant (§4 is a map, not a promise); a test and a mutation for
every new rule, each mutation from a cp backup in the scratchpad, never git
stash or git checkout --; supabase db push --dry-run immediately before the push
(from the Bash tool the push confirms itself; if it is classifier-blocked, hand
it to me with !), then gen types and a diff.

Then commit directly to main, replace this commit's STATUS line in §6 with
SHIPPED, the hash and the date, and hand over: what shipped; anything you
decided that the plan did not say; every coach- or client-visible rule you
built, one plain sentence each; and the two proofs' results. There is no browser
smoke for this commit: the proofs are the evidence.
```

### Commit 2 — `feat(habits): every reader, writer and screen switches to the new habits, the old tables go, and the history stops moving`

**STATUS: SHIPPED `500bea7e` 2026-09-30.** Migration 205 on DEV; PROD at 184 owes 185–205, and 205 must not reach PROD before this code is live there. The owner's smoke passed; decisions the plan left open are in the commit body. The delete for a logged habit moved to commit 3 (D6 revised).

- Migration (the next free number): drops `daily_habit_logs` and `daily_habits`, their indexes and triggers with them. Nothing is moved — every existing habit is test data (D3) — so it runs after the §5 probe and copies nothing; the seeds (§4) create fresh habits through the new functions.
- The four routes marked 2 in §2.4, built on commit 1's services; every old habit route deleted (§2.4).
- Every reader and writer of §4 marked 2 switched: the Overview's habit row (D8) with its key builder and clear; the feed (D4, the no-engagement test, the logged-day source) and the alert's words; the day summary; the activation card's `hasHabits`; the check-in copy (version 3, rule 9 — built at Send and by the fill from the figures service; versions 1 and 2 read into version 3) and the review's Habits section rendering it with today's look; the AI's input from version 3 with the pinned text unchanged; the coach's Habits tab and the client's habits page, home card and Journey on the new routes, as §4's rows describe, their streaks removed (D1) — the end-state screens are commits 4 and 5, and nothing here builds ahead of them.
- The old services, types, validation and hooks deleted; `useWellnessData`'s dead `withHabitLogs` removed; the seeds, scripts and proofs of §4 moved to the new tables; `CLIENT-APP-REFERENCE.md` and `docs/CLIENT-PORTAL-REDESIGN.md` rewritten where the wire or the write path changed; `TECHNICAL-DEBT.md:503` and `:746` deleted with their routes.
- Handover names the two memory seed recipes that insert habit rows (§4).

```text
Read CONVENTIONS.md (whole) and docs/HABITS-REBUILD-PLAN.md (whole). From
docs/ARCHITECTURE.md read only: "Daily logs (the day-form)"; "Client Portal
Architecture" → "Data model", "API surface", "Date-edit permissions";
"Coach-side Data Flow" → "Coach client Overview" and "Attention feed"; "Check-in
System" → "A sent check-in is frozen", "The coach review surface" (the
paragraphs on what the review is given and "The figures, and what they divide
by"), "The React Native contract". Read the habit passages of
docs/CLIENT-PORTAL-REDESIGN.md and CLIENT-APP-REFERENCE.md that §4 lists. Open
another section only when something you touch points to it.

Job: Commit 2 of docs/HABITS-REBUILD-PLAN.md §6 — `feat(habits): every reader,
writer and screen switches to the new habits, the old tables go, and the history
stops moving`. Build exactly what that section lists, in this order: the DEV
probe (§5); the drop migration; the four routes; every reader and writer in §4
marked 2, the screens only as far as §4 says; the check-in copy's version 3 with
versions 1 and 2 read into it, then every DEV copy read through
readSentSnapshot; the deletions; the seeds and scripts; the RN reference and the
portal doc. Nothing is moved: every existing habit is test data (D3).

You have my go: don't show me a plan and don't wait for my review. Plan for
yourself, build it, and hand over when it is done. Stop and ask me only if a §3
decision this commit needs is still blank on the owner's-answers line, if
building exactly what this commit lists would break a CONVENTIONS.md rule that
§4 does not mark for rewriting, or if a gate fails and its root fix lies outside
this commit. Where ARCHITECTURE, CLIENT-APP-REFERENCE.md or
docs/CLIENT-PORTAL-REDESIGN.md still describe the old habit model, §2 wins:
build to §2 and list each such line in the handover.

Done when: everything that section lists is built; the old tables are gone and
the generated types no longer name them; every DEV check-in copy reads through
readSentSnapshot, and a version-2 copy's habits render as they did before; the
request-level proof passes for the four new routes; an independent review of the
whole diff, docs included, has run and every finding is fixed at the root; and
every gate passes after the build and again after the review's fixes: npx tsc
--noEmit, npx eslint ., npx vitest run, npm run check:labels, npx knip, npm run
check:service-key, npm run check:rls. Never skip, weaken or delete a test to
make a gate pass. Report the security, load and performance review (CONVENTIONS
§2).

Working method: the Edit tool, not shell edit scripts; grep at execution time
for every dependant (§4 is a map, not a promise); a test and a mutation for
every new rule, each mutation from a cp backup in the scratchpad, never git
stash or git checkout --; supabase db push --dry-run immediately before the push
(from the Bash tool the push confirms itself; if it is classifier-blocked, hand
it to me with !), then gen types and a diff; a frame test for every transition
this commit moves (CONVENTIONS §7).

Then commit directly to main, replace this commit's STATUS line in §6 with
SHIPPED, the hash and the date, and hand over: what shipped; anything you
decided that the plan did not say; every coach- or client-visible rule you
built, one plain sentence each; and the name of each memory seed recipe that
inserts habit rows, so it can be rewritten. Seed what §5's smoke for commit 2
needs, designed from its steps and run just before you hand over, and give me
the smoke list. The browser smoke is mine: write the list to my smoke standard,
5 to 12 steps, one action each, the exact route, what I should see in plain
words, no database edits and no faked dates.
```

### Commit 3 — `feat(habits): any habit can be deleted and its past stays; the docs describe the new habit model`

**STATUS: SHIPPED `cda71803` 2026-09-30.** Migrations 206 (the delete) and 207 (a catalog comment) on DEV; PROD at 184 owes 185–207, and 206 must reach PROD together with this code. The owner's smoke passed; decisions the plan left open are in the commit body.

- **Delete for every habit (D6 as revised, owner 2026-09-30; added here at commit 2's close).** A migration (206 at planning) gives `client_habits` a deleted marker and changes `delete_client_habit` to take the client's today: a habit with no entries is removed as now; a habit with entries is stopped from today (the stop's own rules: the running version ends the day before, queued versions and one-date edits from today go) and marked deleted, never erased, its versions and entries untouched. A deleted habit leaves the coach's habit list, the order (`order_client_habits` counts the client's habits without it), `coach_habit_choices`, and the missed-habit alert; every write to it but an entry answers `not_found`. Every read of the past keeps it for the days it ran: the Habits tab's weeks, the Overview's row, the client's day and Journey, the check-in's frozen week. The drawer's ⋯ menu offers Delete on every habit; its confirm reads "Delete Walk?" and "Everything the client has logged against this habit will stay.", one sentence for every habit. Proofs: `scripts/habit-functions-proof.ts` and `scripts/habit-routes-proof.ts` updated (a logged habit's delete keeps its entries and leaves the list); a browser smoke for the delete.
- Docs to the current shape (§4's doc table marked 3): ARCHITECTURE's Data Hierarchy, Daily logs, Client Portal, Coach-side and Check-in lines, and its new **"Habits"** section (the model of §2 — tables, rules, the kernel, the functions, the entry, the figures, the frozen week, what each screen reads); CONVENTIONS (the `is_active` bullet, the lifecycle list, the hard-delete exceptions per D6, the §10 example, §20 per rule 10); `docs/perf-baseline.md`; the `.claude/agents/*.md` mentions.
- The PROD checklist of §5 handed to the owner, not run.

```text
Read CONVENTIONS.md (whole) and docs/HABITS-REBUILD-PLAN.md (whole), then every
docs/ARCHITECTURE.md passage that §4's doc table marks 3.

Job: Commit 3 of docs/HABITS-REBUILD-PLAN.md §6 — `feat(habits): any habit can
be deleted and its past stays; the docs describe the new habit model`. First
build the delete for every habit exactly as that section's first bullet and D6
say (the migration, the function, the reads, the drawer's menu and confirm, the
proofs). Then rewrite every line §4's doc table marks 3 to the current shape
only (no "used to"; a removal leaves no sentence), and add ARCHITECTURE's
"Habits" section, describing the delete as built. Rewrite a CONVENTIONS or
ARCHITECTURE rule only as §2 and §3 say, and list each change in the commit
body. Never run anything against PROD.

You have my go: don't show me a plan and don't wait for my review. Plan for
yourself, build it, and hand over when it is done. Stop and ask me only if a §3
decision this commit needs is still blank on the owner's-answers line, if
building exactly what this commit lists would break a CONVENTIONS.md rule that
§4 does not mark for rewriting, or if a gate fails and its root fix lies outside
this commit. Where ARCHITECTURE, CLIENT-APP-REFERENCE.md or
docs/CLIENT-PORTAL-REDESIGN.md still describe the old habit model, §2 wins:
build to §2 and list each such line in the handover.

Done when: everything that section lists is built; an independent review of the
whole diff, docs included, has run and every finding is fixed at the root; and
every gate passes after the build and again after the review's fixes: npx tsc
--noEmit, npx eslint ., npx vitest run, npm run check:labels, npx knip, npm run
check:service-key, npm run check:rls; and the two habit proofs pass on DEV.
Never skip, weaken or delete a test to make a gate pass. Report the security,
load and performance review (CONVENTIONS §2).

Working method: the Edit tool, not shell edit scripts; grep at execution time
for every dependant (§4 is a map, not a promise); a test and a mutation for
every new rule, each mutation from a cp backup in the scratchpad, never git
stash or git checkout --; supabase db push --dry-run immediately before the push
(from the Bash tool the push confirms itself; if it is classifier-blocked, hand
it to me with !), then gen types and a diff.

Then commit directly to main, replace this commit's STATUS line in §6 with
SHIPPED, the hash and the date, and hand over: what shipped; anything you
decided that the plan did not say; every coach- or client-visible rule you
built, one plain sentence each; §5's PROD checklist for me to run, not run by
you; and a browser smoke for the delete, to my smoke standard.
```

### Commit 4 — `feat(habits): the coach sets a habit's days and changes it from a day — one-date edits, History, reuse from other clients, and the week as it happened`

**STATUS: SHIPPED `7e5e5538` 2026-09-30.** No migration; DEV stays at 207, and PROD at 184 owes 185–207, with 206 reaching PROD together with this code (it reads `deleted_at`). The owner's smoke passed (2026-10-02); decisions the plan left open are in the commit body.

- The Habits tab's end state (§2.5): **Add habits** — a sheet adding one or more habits at once: **Your habits** (every habit the coach has given any client, from `GET …/habits/choices`, ticked several at a time, each arriving with its latest version's how-to, target and days, adjustable before the save) and **New habit** (name, how-to, tick or number with its unit, at least / at most and target; days: every day, chosen weekdays — a weekday toggle row, which the design system does not have yet and this commit adds — or N times a week), a **Starts on** day floored on the client's today (default today); one save adds them all and closes the sheet. The row menu: **Change target or days** (from a day, today or later), **Stop** (from a day), **Start again** (a stopped habit, from a day, its last target and days offered), **Rename**, **History** (the habit's versions in words: "5 Oct – 18 Oct · at least 6,000 steps · Every day", "From 19 Oct · …", "Stopped 2 Nov"), **Delete** (any habit, as commit 3 built it).
- The week tracker: each day as it happened (a make-up on its own day, a weekly habit's done days, days no version covers blank), the week's figure per habit, and **"This day"** on a set-days habit's cell from the client's today on (Planned / Not planned, that day's target, Reset), marked as edited on the cell. The week is the client's week holding the client's today, and the coach can page forward to later weeks to plan one-date changes.
- The summary as `StatBand` (the design system's, in place of the hand-rolled strip): This week, Today, Habits.
- **Every habit save changes the card in place** (CONVENTIONS §7 → "Refreshing after a write": the write's own answer, put on screen in the same tick). Today a save lands the client's habits in the drawer and wipes the tracker's weeks, so the summary and the table show their loading state until the week reloads. Every coach habit write — add, rename, change and start again, stop, delete, the order, a one-date edit and its reset — answers through one shared step with the client's habits and the week the tracker shows, which the page names with the write (that week's start; none: the client's current week). `useHabitWrites().land` puts both on screen in the same tick and clears the other weeks it holds, with the Overview, its adherence row, the feed and the activation card as now. The one-date edit's two routes answer that way in place of `{ changed }`. A write that saved but could not be read back still answers as saved, with neither, and the page reloads both. ARCHITECTURE's "Habits" says so.
- Uses commit 1's routes, their answers extended as above; no migration. Frame tests for the add sheet, each row dialog, "This day", the week paging, and the card after every save.

```text
Read CONVENTIONS.md (whole) and docs/HABITS-REBUILD-PLAN.md (whole), and
docs/ARCHITECTURE.md's "Habits" section and "Coach-side Data Flow" → "Client
page tab structure". From docs/newdesignsystem.md read the Tables, StatBand,
Sheet and dialog, "Loading & async states" and Segmented control sections. Open
another section only when something you touch points to it.

Job: Commit 4 of docs/HABITS-REBUILD-PLAN.md §6 — the Habits tab's end state as
that section and §2.5 describe, the Add habits sheet's list of the coach's
habits included. No migration and no new route: commit 1's routes serve it,
every habit write answering with the week on screen as that section says, so a
save changes the card in place with no loading state between. Build the screens
as §2.5 sketches them; where the sketch leaves a detail open, follow
docs/newdesignsystem.md and say what you chose in the handover.

You have my go: don't show me a plan and don't wait for my review. Plan for
yourself, build it, and hand over when it is done. Stop and ask me only if a §3
decision this commit needs is still blank on the owner's-answers line, if
building exactly what this commit lists would break a CONVENTIONS.md rule that
§4 does not mark for rewriting, or if a gate fails and its root fix lies outside
this commit. Where ARCHITECTURE, CLIENT-APP-REFERENCE.md or
docs/CLIENT-PORTAL-REDESIGN.md still describe the old habit model, §2 wins:
build to §2 and list each such line in the handover.

Done when: everything that section lists is built; an independent review of the
whole diff, docs included, has run and every finding is fixed at the root; and
every gate passes after the build and again after the review's fixes: npx tsc
--noEmit, npx eslint ., npx vitest run, npm run check:labels, npx knip, npm run
check:service-key. Never skip, weaken or delete a test to make a gate pass.
Report the security, load and performance review (CONVENTIONS §2).

Working method: the Edit tool, not shell edit scripts; grep at execution time
for every dependant (§4 is a map, not a promise); a test and a mutation for
every new rule, each mutation from a cp backup in the scratchpad, never git
stash or git checkout --; a frame test for every transition this commit moves
(CONVENTIONS §7).

Then commit directly to main, replace this commit's STATUS line in §6 with
SHIPPED, the hash and the date, and hand over: what shipped; anything you
decided that the plan did not say; every coach- or client-visible rule you
built, one plain sentence each; and the smoke list for §5's commit 4. The coach
can make every state in the UI, so seed nothing unless a step needs a past date.
The browser smoke is mine: write the list to my smoke standard, 5 to 12 steps,
one action each, the exact route, what I should see in plain words, no database
edits and no faked dates.
```

### Commit 5 — `feat(habits): the client sees every habit every day, logs a number against its target, and makes up a missed day`

**STATUS: SHIPPED `e6a8a41a` 2026-10-02.** No migration; DEV stays at 207, and PROD at 184 owes 185–207. The owner's smoke passed (2026-10-02); decisions the plan left open are in the commit body.

- The habits page's end state (§2.5): Planned today, Any day this week, Not planned today; each habit's entry — a tick, or a number box with its unit and the day's target in words — its week's figure and an optional note, each saved on its own (a tick at once, a number or a note on leaving the box), answering with the habit's day and week figures, which update the page in the same tick. Locked and future days as today.
- The home card: "2 of 3 done today", "Nothing planned today · 1 to do this week", "No habits to track"; the day summary refreshed through its key builder.
- Journey habits: each habit's words, this week's figure and its recent weeks as bars — from `GET /api/client/habits/progress`, on the client's calendar (never the device's).
- `CLIENT-APP-REFERENCE.md`'s habit screens and payloads; `docs/CLIENT-PORTAL-REDESIGN.md`'s habit passages.

```text
Read CONVENTIONS.md (whole) and docs/HABITS-REBUILD-PLAN.md (whole), and
docs/ARCHITECTURE.md's "Habits" section and "Client Portal Architecture". Read
docs/CLIENT-PORTAL-REDESIGN.md's habit passages (§4) and
CLIENT-APP-REFERENCE.md's habit sections; for a client-portal write path those
docs win over ARCHITECTURE. Open another section only when something you touch
points to it.

Job: Commit 5 of docs/HABITS-REBUILD-PLAN.md §6 — the client's habit screens'
end state, exactly as that section lists. The RN app is the real client: build
to the routes, and write every payload change into the RN reference. Build the
screens as §2.5 sketches them; where the sketch leaves a detail open, follow
docs/newdesignsystem.md and say what you chose in the handover.

You have my go: don't show me a plan and don't wait for my review. Plan for
yourself, build it, and hand over when it is done. Stop and ask me only if a §3
decision this commit needs is still blank on the owner's-answers line, if
building exactly what this commit lists would break a CONVENTIONS.md rule that
§4 does not mark for rewriting, or if a gate fails and its root fix lies outside
this commit. Where ARCHITECTURE, CLIENT-APP-REFERENCE.md or
docs/CLIENT-PORTAL-REDESIGN.md still describe the old habit model, §2 wins:
build to §2 and list each such line in the handover.

Done when: everything that section lists is built; an independent review of the
whole diff, docs included, has run and every finding is fixed at the root; and
every gate passes after the build and again after the review's fixes: npx tsc
--noEmit, npx eslint ., npx vitest run, npm run check:labels, npx knip, npm run
check:service-key. Never skip, weaken or delete a test to make a gate pass.
Report the security, load and performance review (CONVENTIONS §2).

Working method: the Edit tool, not shell edit scripts; grep at execution time
for every dependant (§4 is a map, not a promise); a test and a mutation for
every new rule, each mutation from a cp backup in the scratchpad, never git
stash or git checkout --; a frame test for every transition this commit moves
(CONVENTIONS §7).

Then commit directly to main, replace this commit's STATUS line in §6 with
SHIPPED, the hash and the date, and hand over: what shipped; anything you
decided that the plan did not say; every coach- or client-visible rule you
built, one plain sentence each; and the smoke list for §5's commit 5. Seed the
past weeks of entries its steps need on "Test intake form bug" (c1211893…), run
just before you hand over. The browser smoke is mine: write the list to my smoke
standard, 5 to 12 steps, one action each, the exact route, what I should see in
plain words, no database edits and no faked dates.
```

### Commit 6 — `feat(check-ins): habits in the check-in — the client's Habits step, and the coach's Habits cell, week and AI lines`

**STATUS: SHIPPED `49f27d80` 2026-10-02.** No migration; DEV stays at 207, and PROD at 184 owes 185–207. The owner's smoke is owed; decisions the plan left open are in the commit body.

- **Client.** `GET /api/client/check-in-context` gains `habitWeek` — the period's habit week from the figures service (additive; `CheckInContextResponse` and the route test's exact key set updated deliberately). The wizard appends a **Habits** step after Training when `habitWeek` holds a habit — appended last, so a restored draft's step index keeps its kind; the step list is decided by that one read. The step (§2.5) uses commit 5's entry controls and the entry route; each write joins the page's pending writes, which Send flushes (the training checklist's "Pin 3", now shared by both steps and **tested**); the step's figures survive Back and Next — the week is an SWR read (`/api/client/habits/week`, key builder and invalidator) whose first answer is the context's `habitWeek`, each write's answer seeded into it in the same tick — so the training checklist's stale-row gap is not copied. The coach's check-in Fields card keeps looping the form's steps, which do not gain one; its all-off line changes (§2.5).
- **The client's sent check-in.** `GET /api/client/check-ins/[id]` gains `habits: { met, planned } | null` from the copy (additive; the route still reads `check_ins` alone); the card shows Habits.
- **Coach.** The top strip's **Habits** cell after Training (five cells; the test's positional lookup replaced by a named one); the Habits section of §2.5 from the frozen week — each habit's words as they stood, a cell per day as it happened with a number habit's numbers, the week's figure and a number habit's average, the client's notes under the table; the habit figure's words spelled once in `lib/check-in/review-figures.ts` beside the goal rows and read by the cell, the section and the AI.
- **The AI.** Each habit's week line with its schedule, target, figure and, for a number habit, its average; each day's line with every habit that day — planned or not, the entry against its target, met or not, the note. The brief unchanged; the pinned prompt updated; `npm run print:check-in-prompt` checked on a real check-in.
- The RN reference's check-in sections; ARCHITECTURE's Check-in System.

```text
Read CONVENTIONS.md (whole) and docs/HABITS-REBUILD-PLAN.md (whole), and
docs/ARCHITECTURE.md's "Habits" section and its whole "Check-in System" section.
Read CLIENT-APP-REFERENCE.md's check-in sections. Open another section only when
something you touch points to it.

Job: Commit 6 of docs/HABITS-REBUILD-PLAN.md §6 — habits in the check-in, client
side and coach side, exactly as that section lists. Nothing new is frozen: the
copy's version 3 already holds the week (commit 2). A sent check-in never moves.
Build the step, the cell and the section as §2.5 sketches them; where the sketch
leaves a detail open, follow docs/newdesignsystem.md and say what you chose in
the handover.

You have my go: don't show me a plan and don't wait for my review. Plan for
yourself, build it, and hand over when it is done. Stop and ask me only if a §3
decision this commit needs is still blank on the owner's-answers line, if
building exactly what this commit lists would break a CONVENTIONS.md rule that
§4 does not mark for rewriting, or if a gate fails and its root fix lies outside
this commit. Where ARCHITECTURE, CLIENT-APP-REFERENCE.md or
docs/CLIENT-PORTAL-REDESIGN.md still describe the old habit model, §2 wins:
build to §2 and list each such line in the handover.

Done when: everything that section lists is built; a test proves Send waits for
every pending habit and training write; the check-in-context route test's exact
key set includes habitWeek; an independent review of the whole diff, docs
included, has run and every finding is fixed at the root; and every gate passes
after the build and again after the review's fixes: npx tsc --noEmit, npx eslint
., npx vitest run, npm run check:labels, npx knip, npm run check:service-key.
Never skip, weaken or delete a test to make a gate pass. Report the security,
load and performance review (CONVENTIONS §2).

Working method: the Edit tool, not shell edit scripts; grep at execution time
for every dependant (§4 is a map, not a promise); a test and a mutation for
every new rule, each mutation from a cp backup in the scratchpad, never git
stash or git checkout --; a frame test for every transition this commit moves
(CONVENTIONS §7).

Then commit directly to main, replace this commit's STATUS line in §6 with
SHIPPED, the hash and the date, and hand over: what shipped; anything you
decided that the plan did not say; every coach- or client-visible rule you
built, one plain sentence each; and the smoke list for §5's commit 6. Seed a
client whose check-in is due, with a week of habits (a set-days, a weekly and a
number habit, one made-up day and one gap), run just before you hand over. The
browser smoke is mine: write the list to my smoke standard, 5 to 12 steps, one
action each, the exact route, what I should see in plain words, no database
edits and no faked dates.
```

### Commit 7 — `feat(goals): the goals table lists the habits added, changed and stopped during each goal`

**STATUS: not started.**

- `getGoalHistory` reads the client's habit versions over the goals' span (one read); `goalHistoryRows` gives each goal the lines whose day falls in its days — a habit **added** (its first version), **changed** (a version following one without a gap: target or days), **stopped** (a version ending with nothing after), **started again** (a version after a gap) — worded by `lib/habits/habit-words.ts`, ranked with the other lines of a day; `goal-lines.tsx`'s label map gains the kinds.
- Every habit writer clears the goals table (`useClearClientGoalHistory`; the writers scan in `hooks/use-client-goals.test.ts` holds it).
- ARCHITECTURE's "The goals table (Journey → Goals)".

```text
Read CONVENTIONS.md (whole) and docs/HABITS-REBUILD-PLAN.md (whole), and
docs/ARCHITECTURE.md's "Habits" section and "Client Goals & Body Metrics" → "The
goals table (Journey → Goals)".

Job: Commit 7 of docs/HABITS-REBUILD-PLAN.md §6 — the goals table's habit lines,
exactly as that section lists. Nothing new is stored.

You have my go: don't show me a plan and don't wait for my review. Plan for
yourself, build it, and hand over when it is done. Stop and ask me only if a §3
decision this commit needs is still blank on the owner's-answers line, if
building exactly what this commit lists would break a CONVENTIONS.md rule that
§4 does not mark for rewriting, or if a gate fails and its root fix lies outside
this commit. Where ARCHITECTURE, CLIENT-APP-REFERENCE.md or
docs/CLIENT-PORTAL-REDESIGN.md still describe the old habit model, §2 wins:
build to §2 and list each such line in the handover.

Done when: everything that section lists is built; an independent review of the
whole diff, docs included, has run and every finding is fixed at the root; and
every gate passes after the build and again after the review's fixes: npx tsc
--noEmit, npx eslint ., npx vitest run, npm run check:labels, npx knip, npm run
check:service-key. Never skip, weaken or delete a test to make a gate pass.
Report the security, load and performance review (CONVENTIONS §2).

Working method: the Edit tool, not shell edit scripts; grep at execution time
for every dependant (§4 is a map, not a promise); a test and a mutation for
every new rule, each mutation from a cp backup in the scratchpad, never git
stash or git checkout --.

Then commit directly to main, replace this commit's STATUS line in §6 with
SHIPPED, the hash and the date, and hand over: what shipped; anything you
decided that the plan did not say; every coach- or client-visible rule you
built, one plain sentence each; and the smoke list for §5's commit 7. Seed a
goal whose days hold a habit added, changed and stopped, run just before you
hand over. The browser smoke is mine: write the list to my smoke standard, 5 to
12 steps, one action each, the exact route, what I should see in plain words, no
database edits and no faked dates.
```
