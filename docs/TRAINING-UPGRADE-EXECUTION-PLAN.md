# Training upgrade — execution plan

**Written 2026-09-16 from the owner's decisions. 22 commits, none started. This file replaces
`docs/TRAINING-COMPLETION-EXECUTION-PLAN.md`: that plan's closed decisions are in §4.7 word for word,
and its commits 1–4 are commits 7–10 here. Delete this file when the last commit ships; the shipped
shape then lives in `docs/ARCHITECTURE.md`. There is no status ledger — git history is the record.**

Contents: §1 What we're building · §2 How every commit runs · §3 Before commit 1 · §4 Decided rules ·
§5 What exists today · §6 The commits

---

## 1. What we're building

When this plan is done:

- **A wrong start date is a quick fix.** A coach who placed a program on the wrong day moves it from
  the Plans hero. The whole program moves as it is, with everything customised for that client.
- **Workouts are built from groups.** A session is an ordered list of groups. Each group holds
  exercises and has a format — straight sets, superset/circuit, AMRAP, EMOM or For time — with its
  rounds, time cap and rests. Hybrid and HYROX sessions can be written the way coaches actually
  program them.
- **A day can hold several sessions**, in order, each its own workout — a morning run and an
  evening lift.
- **Completion speaks one vocabulary.** A workout is scheduled or completed; how well it went (Full
  or Partial) lives on its log; every count is completed over prescribed, on every screen.
- **Every exercise measures what it needs.** Coaches choose each exercise's columns — strength
  (load, reps, RPE, RIR, tempo) and endurance (distance, duration, pace, split, cadence, damper,
  heart rate, power, % FTP) — starting from a preset set by the exercise's type: Strength,
  Bodyweight, Endurance, Erg, Carry & sled or Holds.
- **Clients log all of it**, including group scores: AMRAP rounds and For time finish times.
- **Progress charts show each exercise's own markers**, and duplicate-with-progression can progress
  endurance targets.
- **Programs can be periodised** into named, coloured phases (Foundation, Deload, Taper…) shown as
  tabs in the builder, colouring the coach's calendar and the client's program, and named in the
  client's header.

Client blocks don't change.

---

## 2. How every commit runs

1. **Read first**, in this order: this plan's §1–§5 and your own commit's prompt (skip the other
   commits' prompts); `CONVENTIONS.md` in full; `docs/ARCHITECTURE.md` in full. For UI work,
   `docs/newdesignsystem.md`. When `/api/client/**` changes, `CLIENT-APP-REFERENCE.md` (repo root).
2. **Where this plan changes a shape, the plan wins over `docs/ARCHITECTURE.md`.** That doc
   describes the product as it is today. When your commit deliberately changes something it
   describes, don't let the doc stop you: build the plan's shape, and rewrite that part of
   `ARCHITECTURE.md` in the same commit to describe the new shape (current shape only — no "used to
   be", no dated narrative). Where the plan is silent, `ARCHITECTURE.md` stands. `CONVENTIONS.md`
   always applies; if one of its rules genuinely blocks a decided rule here, stop and ask the owner.
3. **You choose how.** This plan says what we're building and what must be true afterwards. The
   technical approach — names, file layout, functions, queries — is yours. Do your best work: find
   the simplest shape that fixes things at the root, not a patch.
4. **Plan, then wait.** Before editing anything, present:
   - what you'll build;
   - every coach- or client-visible behaviour as one plain sentence the owner can say yes or no to —
     start from §4's rules, don't reopen them, and add a sentence only for a case they genuinely
     don't answer;
   - the data model as an explicit decision, with the alternative you rejected (CONVENTIONS §8);
   - for UI changes, a frame test for each transition: the sources a click changes and every frame
     until the screen settles (one owner per surface, no new animations);
   - any passage of `ARCHITECTURE.md` you'll rewrite, quoted.

   Then stop and wait for the owner's go. A question from the owner pauses the build until it's
   answered.
5. **Build it whole.** No transitional shapes, temporary names or band-aids. When a commit makes
   data visible or editable, nothing elsewhere in the product may hide it or drop it.
6. **Tests and gates.** Test every rule the commit adds, including every path that copies or saves
   the data it changes. Mutation-test the important ones — copy the file to the scratchpad and
   restore from there; never `git stash` or `git checkout --`. Then CONVENTIONS §13 in full:
   `npx tsc --noEmit` (run `rm -rf .next` first after moving or renaming files), `npx eslint .`,
   `npx vitest run` (the set-tracker test is flaky in full runs — re-run before blaming your change),
   `npm run check:labels`, `npm run check:service-key`, `npm run check:rls` when a migration lands,
   `npx knip`. Run and report the CONVENTIONS §2 security/load/performance review whenever it
   triggers.
7. **Migrations.** Take the next free number at execution. Push to DEV only; PROD is the owner's
   call. `brew upgrade supabase` first; `npx supabase db push --dry-run` immediately before the push;
   if the harness refuses the push, ask the owner to run `! npx supabase db push`. Regenerate types
   and commit them with the migration. A destructive change probes the data first — and PROD's data,
   through the owner, before PROD is pushed.
8. **Docs in the same commit:** `docs/ARCHITECTURE.md` (current shape only); `CONVENTIONS.md` where
   a rule changes; `CLIENT-APP-REFERENCE.md` whenever `/api/client/**` changes (the React Native app
   is the real client — the web client is a test harness); `docs/newdesignsystem.md` for any new UI
   pattern.
9. **A smoke list, not the browser.** Don't drive the browser. Hand the owner a click-by-click smoke
   list covering only what changed and can be seen: one action per step, the exact route and control,
   and what the screen shows after it. Seed the data the steps need yourself, designed from the
   steps, and say plainly that the UI is unverified until the owner runs it.
10. **Commit** directly to `main`, in the repo's commit style — one commit per session. If the work
    is too big for one session, say so in your plan and propose the split before building.
11. **Blocks are off-limits.** Don't change client blocks (Journey blocks, table `client_phases`)
    beyond what your commit says.

---

## 3. Before commit 1

- DEV runs ahead of PROD (PROD was at 174 when this was written). Commits push migrations to DEV;
  PROD is the owner's call.

---

## 4. Decided rules

Settled with the owner on 2026-09-16 unless dated otherwise. Don't reopen them. A rule marked
*(confirm)* was proposed but not explicitly confirmed: put it to the owner as a plain sentence in that
commit's plan.

### 4.1 Changing a program's start date (commit 1)

- **Where:** the Training tab's Plans hero, not the plan editor. A pencil to the right of
  "Starts <date>" opens a calendar picker.
- **Starts today:** a program starting today shows "Starts today" with the pencil on its first day,
  until the client logs a workout.
- **Queued behind a running program:** a second hero line under the running program's name —
  "Next: <name>, starts <date>" — with its own pencil.
- **Which programs can move:** only one that hasn't started — its start is on or after the client's
  deletion floor (today, or tomorrow once they've logged a workout today). The picker greys earlier
  days and the server refuses them.
- **What moves:** the whole program exactly as it is on the calendar — edits made for the client,
  day edits, rest days, everything it holds. Same length, same sessions; only the dates change. It
  doesn't regain days that were cut when it was placed.
- **Never shortens anything:** a move that would overlap another program, or put a session on a day
  that already holds one (until commit 5 allows that), is refused with a sentence naming the day.
  Nothing is trimmed to make room.
- **Blocks:** no block behaviour is designed here, but a block must still contain its plans, so a
  move across a block's edge is refused with a sentence. *(confirm)*
- **Confirm step:** picking a day asks to confirm the move first (owner, 2026-09-16, after commit 1's smoke —
  replacing the no-confirm proposal).
- **Nutrition:** targets keep their own dates; training-day calories follow the sessions
  automatically.

### 4.2 Groups (commits 2–4, 14–15)

- **Name:** coaches and clients see a group by its format's name — Superset, Circuit, Straight sets,
  AMRAP, EMOM, For time — and never a letter (owner, 2026-09-16). "Group" is the data's word;
  "Block" is reserved for client blocks.
- **Shape:** a session is an ordered list of groups; a group is an ordered list of exercises; every
  exercise sits in a group. A group with one exercise on straight sets is exactly today's exercise.
- **What the coach sees:** linking is the action — select any exercises, in any mix, and make them a
  superset or circuit; each keeps its own columns. A lone exercise looks like today's exercise; only
  linked exercises get a slim header with the group's name and settings. Coaches never see a group
  around a single exercise.
- **Formats:**
  - *Straight sets* — each exercise's sets in turn.
  - *Superset/circuit* — a loop through the group's exercises, for its rounds.
  - *AMRAP* — as many rounds as possible within the time cap; the score is rounds plus extra reps.
  - *EMOM* — work starts at every interval, for a number of rounds.
  - *For time* — a fixed amount of work as fast as possible, usually with a time cap; the score is
    the finish time, or how far they got when capped.

  "AMRAP" also stays a set type (one set to failure); the context tells them apart.
- **Group settings:** rounds, time cap, EMOM interval, rest between exercises, rest between rounds,
  notes.
- **Rows are rounds:** in a looped group, each row of an exercise is one round, so rounds can have
  different targets (21-15-9) and logging stays one row per round.
- **Data (decided):** a groups table for library programs and one for client plans, mirroring
  sessions and exercises; each exercise records its group and its position in it. A timed group's
  score is stored as that group's result on the workout's log. `superset_group` is removed.
- **Rollout:** straight sets and supersets/circuits arrive in commits 3–4. AMRAP, EMOM and For time
  can be chosen only once clients can score them (commits 14–15).

### 4.3 Several sessions on one day (commits 5–6)

- **Order only:** a day holds sessions in order (1st, 2nd…); no AM/PM. A coach can name a session
  "AM run".
- **Separate workouts:** each session on a day is opened, logged and counted on its own. (A group is
  part of one workout; sessions on a day are separate workouts.)
- **Moves join:** moving a session onto a day that already holds one adds it to that day, last in
  order — for the coach and the client. A swap is two moves.
- **Placement and Edit plan:** placing a program lays each day's sessions on that date in order;
  Edit plan reads and saves every session on a day.
- **Calories add:** a day's training calories add every session's surplus.
- **Refusals go:** every "that day already has a session" refusal is removed, and the database's
  one-scheduled-session-per-day rule (migration 136) is dropped — its own comment says to drop it
  when multi-session days ship.
- **Counts:** sessions per week can exceed 7. Views that show one row per day (the coach's Data table
  and similar) show one row per workout.

### 4.4 Measurement columns, presets and exercise types (commits 11–13, 16–17)

- **Columns are per exercise**, chosen in each exercise's column selector: presets at the top, every
  column below, each ticked or unticked freely.
- **The columns:**
  - *Strength:* Load (kg or lb by the viewer's units, % 1RM or % top set — as today), Reps, RPE, RIR,
    Tempo.
  - *Endurance:* Distance, Duration, Pace (per km or mile, by the viewer's units), Split (per 500 m),
    Cadence (SPM/RPM), Damper/Resistance, HR zone, Target HR (BPM), Power (watts), % FTP.
  - *Framework:* Set type, Rest. Rounds, time cap and intervals are group settings (§4.2).
- **Ranges:** a target can be one value or a range where coaches use ranges (pace, heart rate,
  watts), as reps can today.
- **Presets:** a fixed set — one per exercise type, plus Circuit. A preset applies to one exercise or
  a whole group. Coaches don't save their own. The exact columns in each preset are put to the owner
  in commit 12. *(confirm)*
- **Exercise types:** Strength, Bodyweight, Endurance, Erg, Carry & sled, Holds — on every catalog
  exercise. A new exercise starts on its type's preset; with no type, on Strength. The existing
  free-text Category (compound, isolation, cardio, plyometric) stays separate: "Compounds only" in
  duplicate-with-progression reads it.
- **Classifying the catalog:** compound and isolation become Strength by rule, except carries/sleds
  and holds, which are picked out by name. The cardio and plyometric exercises are classified by hand
  with the owner's review. "Burpee Broad Jump", the one HYROX station missing, is added.
- **Coach-made exercises** start as Strength and get a Type field in the exercise form.
- **Client inputs follow the columns.** Weight shows only when Load is on — today it always shows —
  so a run asks for distance and time, not weight.
- **Clients log every new measurement** from the moment it can be prescribed.
- **Units:** stored canonically — metres and seconds, pace worked out from them, kg as today — and
  converted only on screen by the viewer's units. The app sends canonical values; there is no new
  unit tag (CONVENTIONS §20: "Do not add a third tag"). §20 gains the distance and time rules.
- **Data (decided):** the chosen columns stay a list on the exercise, extended to every column name
  and defined once; existing exercises whose list is empty get today's five, so empty never means
  "all". Per-set targets are new fields in the per-set data (CONVENTIONS §8 names it as allowed JSON).
  Logged results are real columns on the logged set, because they get charted.
- **The AI assistant** applies a preset when it adds an exercise — by type, once types exist.
- **Chart markers by type (commit 16):** Strength — estimated 1RM, top set, volume. Bodyweight —
  best set reps. Endurance — pace, distance, best times. Erg — split, watts, best times. Carry & sled
  — load over distance, time. Holds — longest hold. A chart follows what was actually logged when
  that differs from the type.

### 4.5 Timed groups and scores (commits 14–15)

- **Scores:** AMRAP records rounds plus extra reps; For time records the finish time, or the rounds
  and reps reached when capped; EMOM records its rows like any round-based group. *(confirm the EMOM
  score)*
- **Timers:** simple timers in the web client — a countdown to the time cap, an interval cue for
  EMOM, a stopwatch for For time. The React Native app builds the real ones.
- **Done:** a timed group counts as logged once its score is entered. Whether a capped For time or an
  unfinished EMOM is Partial is put to the owner in commit 15. *(confirm)*

### 4.6 Periodisation phases (commits 18–22)

- **What a phase is:** a name and a colour for a run of whole weeks in a program — nothing more. It
  changes no dates, sessions, nutrition or completion.
- **Builder:** tabs under the Schedule rail, one per phase; each tab shows its weeks; week numbers
  carry on across tabs (Foundation W1–4, Deload W5). A program with no phases looks and works exactly
  as today.
- **Weeks in a tab:** add, delete, duplicate and duplicate-with-progression work inside the open tab;
  a copy stays in the same phase. A phase keeps at least one week: its last week can't be deleted or
  dragged out — remove the tab instead. *(confirm)*
- **Across tabs:** weeks and sessions can be dragged across tabs. Hovering a tab mid-drag opens it. A
  week dropped in another tab joins that phase at the drop position, with its sessions (one phase gets
  a week shorter, the other a week longer). A session dropped onto a day in another tab moves like any
  session move.
- **Colour:** a name from a fixed palette defined in `docs/newdesignsystem.md`, never a hex; it mustn't
  read as the app's danger red or warning amber. The web and React Native apps each map the name to
  their own shades.
- **Data (decided):** one row per phase — its order, name, colour and number of weeks — under the
  library program, and a copy under a client's plan made when the program is placed, like the
  sessions (cut where the program is cut, repeated where it repeats). Adding or removing a week
  changes only that phase's row. No other table carries a phase: nothing on calendar sessions, session
  rows or days.
- **A day's phase is worked out from its date:** the plan covering the date, the week of that plan the
  date falls in (counted from the plan's start), the phase that week belongs to. Days past the plan's
  end have none. One server function answers this for every screen and trims phases to the plan's own
  dates.
- **Library and client:** editing a program's phases in the library never changes a client's plan;
  Edit plan shows the tabs and saves that client's phases; weeks that have started keep today's locks.
- **Coach calendar:** every day of a phase's weeks carries its colour — rest days and days with no
  sessions included — day by day (a program can start on any weekday; calendar rows run Monday to
  Sunday). The phase's name is visible, not only its colour. A moved session takes the colour of the
  day it's on.
- **Client:** the program lists weeks under their phase, in its colour; the header names the current
  phase under the block; with no current block, the phase line appears on the training program card.
  *(confirm)* The client wire sends each phase with its dates already worked out.
- **Open — put to the owner in commit 19:** what removing a tab does (delete its weeks, or merge them
  into the phase before — suggested: merge); how a coach splits an already-built program (suggested:
  "Start a new phase from this week" on a week's menu).
- **Naming:** blocks are stored in a table called `client_phases`; name anything new so it can't be
  confused with it.
- **The library save** stays several separate writes (owner, 2026-09-16); the commit states what's out
  of step if one fails partway (CONVENTIONS §8).
- **Not in this plan:** the phase label on check-ins. It belongs to the check-in rework: worked out
  over the check-in's period, both names when the phase changes mid-week, fixed when the client sends.

### 4.7 Completion — one vocabulary (commits 7–10)

Moved word for word from `docs/TRAINING-COMPLETION-EXECUTION-PLAN.md` (approved by the owner
2026-09-02), which this plan replaces.

**The problem.**

The platform disagrees with itself about whether a partially completed workout counts as
done. For one test client's week of 24–30 Aug 2026 (five prescribed sessions, four logged in
full, one logged partial) the client's check-in reads 4/5, the coach's review page reads 5/5,
and the Overview card and the Training tab read 4/5. Same week, same five rows, three answers.

The owner's rule: **a partial workout counts as completed, everywhere.** The quality (full or
partial) stays visible beside the number on every surface.

The root cause is the shape, not any one counter. `training_events.status` stores two facts in
one word: whether anything happened (`scheduled` is load-bearing — the one-workout-per-day
index, the plan editor's save, the move RPC and placement's window-delete all key on it) and how
much of the prescription was done (`completed` = full, `partial`), which is a copy of
`session_logs.completion_quality`. Every reader that asks "did they train?" has to know two of
the stored values mean yes, which is why the rule was spelled ten different ways. `missed` is
never stored; every screen derives it. `skipped` is an empty log that locks the day.

**The end-state model — CLOSED decisions (owner, 2026-09-02).**

These are settled. A session that finds itself re-arguing one has drifted; stop and re-read.

| # | Decision | Detail |
|---|---|---|
| M1 | **`training_events.status` has two values: `scheduled`, `completed`.** | It answers one question: has the client logged this workout. `completed` means logged, at any quality — the same word and meaning as the product's "5 of 5 completed", the stored `check_ins.workouts_completed`, and the wire's `sessionsCompleted`. Written only by the log link, in the same statement as `session_log_id`, so it cannot drift from the link. `missed` stays derived (scheduled + date passed). `partial`, `skipped`, `missed` leave the constraint. |
| M2 | **Quality lives on the log only.** | `session_logs.completion_quality` ∈ `full`, `partial`. Server-derived from ticked sets (`utils/completion-quality.ts`), unchanged. No copy on the event. |
| M3 | **Screens read quality off the log, embedded on the event read.** | Every event-row reader embeds `session_logs!training_events_session_log_id_fkey(completion_quality, …)` — the FK MUST be named (two relationships exist between the tables; PGRST201 otherwise). A quality cache column on the event is held in reserve only if a *measured* calendar read is slow. |
| M4 | **`skipped` is removed from the product.** | For adherence it is identical to not logging; it locks a day the client might later want to backfill; the reason note it carried belongs in the check-in's Challenges. A save with nothing ticked is refused. "I did not do this after all" is an explicit **Clear log** (delete the log, event back to `scheduled`), an atomic RPC, allowed where the day rule allows editing. The no-engagement alert therefore counts `completed` events as activity (a skip no longer exists to count). |
| M5 | **The per-day schedule shape stops encoding quality and swaps in its status word.** | `ScheduleDay.status` ∈ attendance words only (`scheduled`, `completed`, `missed`, `rest`); `completionQuality` and `isAlternative`, which the shape already carries, say the rest. `partial`, `completed_swap`, `rest_trained` go. The merge of logs that have no calendar workout goes with them — the product stopped producing event-less logs when the receipt model was retired (ARCHITECTURE → "Alternative-session logging"); rows carrying it are pre-retirement test history. |
| M6 | **Counts are `completed / prescribed`, everywhere.** | Prescribed = every calendar workout in the surface's own window (unchanged windows). Full and partial are the breakdown printed beside the number. One pure summariser in a neutral home (`lib/training-adherence.ts`) produces `{ planned, completed, full, partial, missed, pct }` over rows carrying `status` + `completionQuality`. |
| M7 | **The Training-tab hero and the Overview plan card count calendar workouts by date.** | Not session logs by their stored `completed_at`, which does not move when a workout is moved (a 27 Aug workout's log reads 26 Aug on dev). After this, no adherence figure reads `completed_at`. |
| M8 | **Session-level labels say Full / Partial / Missed.** | So "5 of 5 completed" never sits above a pill that says "Completed" for one of them. The word "completed" is reserved for counts. |
| M9 | **The Overview dot rail keeps three states.** | A day whose only workout was partial stays a partial dot beside a number that counts it. Same principle as the review pills. |
| M10 | **The activity-calorie alert follows the rule.** | A partial workout is done, so it no longer counts as skipped activity. A small change in when that alert fires; accepted. |
| M11 | **One `mapEventRow`.** | Two copies exist (`services/training-event-service.ts:10`, `services/training-log-service.ts:314`). They become one because commit 1 touches both anyway. |
| M12 | **No transitional names or shapes.** | The model above is the model from the first commit that touches each part. Safety comes from ordering (every quality reader moves off the status word BEFORE the word's meaning widens) and from tests, never from a temporary value that gets renamed later. |
| M13 | **Historical data is not preserved or reconciled.** | All clients are test clients (owner). Check-ins submitted before commit 4 keep whatever `workouts_completed` they stored; frozen `period_snapshot` JSON keeps its old words and still renders. No backfill. |

**Rejected, so nobody re-derives them:** dropping the status column and deriving attendance from
the link (four write guards key on `scheduled`, and every calendar read would need the join just
to know whether anything happened); a quality cache column on the event (a copy — the shape being
removed); a status word chosen for one commit's convenience (`done`) with a later rename.

*In the table above, "commit 1" and "commit 4" are this plan's commits 7 and 10.*

**Amendments for this upgrade** (owner, 2026-09-16 — confirm each in its commit's plan):

1. **M4 — what counts as logged.** A save with nothing logged is refused. From commit 11, a set with
   any recorded value counts (distance or time, not only a tick with reps); from commit 14, a group's
   score counts. Commit 9 writes the rule so those commits extend it.
2. **M5 — one row per workout.** With several sessions on a day (commits 5–6), the per-day schedule
   shape holds one row per workout; M5's words and fields apply to each row.
3. **Migration 136 is gone.** Commit 5 drops the one-scheduled-session-per-day index, so the old plan's
   "unchanged by this plan" no longer holds. Rules elsewhere that key on `scheduled` still stand.
4. **The old commit 4b** (one report assembly for both check-in views) moves to the check-in rework and
   isn't in this plan. Its full text is in git history:
   `git show f553e9ea:docs/TRAINING-COMPLETION-EXECUTION-PLAN.md`.
5. **Changing a logged workout's status from the check-in never erases its logged sets** — a bug found
   while planning (§5). Commit 9 closes it.

### 4.8 Not in this plan

- Client blocks (Journey blocks, table `client_phases`).
- The check-in rework (check-in figures fixed when the client sends). It takes the old commit 4b, the
  phase label on check-ins, and the new measurements and group scores in its saved record.

---

## 5. What exists today

Verified by reading the code on 2026-09-16. These are starting points, not a checklist — re-check
anything you rely on.

**Programs, weeks and the calendar**
- Library programs (`coach_saved_plans` → `coach_saved_sessions` → `coach_saved_exercises`) and client
  plans (`training_plans` → `training_sessions` → `training_exercises`) mirror each other; placing a
  program copies the library rows.
- Weeks aren't rows: each day's session row carries a `week_index` and a position, counted from the
  plan's start (`effective_from`). A rest day is a session row marked rest.
- The calendar is `training_events`, one row per dated session. A rest day has no event; the coach
  calendar labels any empty upcoming day "Rest".
- A placed program's start never moves today; every later writer only moves its end or archives it.
- A session dropped from the library onto the calendar gets a session row numbered after the plan's
  last slot, not by its date's week. Anything date-based must come from dates.
- One scheduled session per client per day (migration 136). `eventByDay`
  (`services/calendar-day-events.ts`) picks one event per day for Edit plan's read and the client's
  Program tab; Edit plan's save takes one entry per day; the client's week rearranging won't save
  while a day holds more than one; nutrition prices a day from its first session's surplus
  (`utils/build-daily-targets.ts`); `training_plans.frequency_per_week` is checked 1–7.
- The deletion floor (`services/event-deletion-floor.ts`) is the one answer to "from which day can
  training change".
- The move function (migration 150) moves several sessions at once without tripping the one-per-day
  rule, by parking them first.
- The Plans hero (`components/clients/training/training-plan-hero.tsx`) shows "Starts <date>" only
  when no plan covers today (`scheduledFor` on the training GET); a program queued behind a running
  one arrives as `upcomingPlan`.

**Workouts, prescriptions and copies**
- A session is a flat list of exercises in every layer: the builder's draft and model, the four hosts
  of `session-editor-body.tsx`, the AI assistant's shared op module (server executors and client
  replay), duplicate-with-progression, the serializers, and every path that saves or copies exercises.
- Paths that insert or clone exercise rows: the library save (`overwriteSavedPlan` — several separate
  writes, row by row), duplicate, promote from draft, standalone workouts, saving a client session to
  the library, placing a program (from the library and from an edited client draft), dropping a
  session onto the calendar, Edit plan's database function (with an explicit column list), and the
  placed-session tray's save. The log's prescription snapshot copies them too, and a test pins its
  keys.
- Server validators are plain `z.object` schemas that silently strip unknown keys. The assistant's
  draft schemas strip unknown fields and its patch schemas reject unknown keys. A field that isn't
  taught to a path vanishes without an error. Survival tests (`services/set-specs-survival.test.ts`
  and neighbours) cover some paths only; `prescribed_fields` survival is untested on placement,
  duplicate, promote, standalone and the tray's save.
- The per-set prescription is `set_specs` JSON: set type (warm-up, working, AMRAP, drop, failure),
  reps range, load type (absolute, % 1RM, % top set), RPE, tempo (no builder control; only the
  assistant writes it), rest, drops.
- `utils/set-spec-rows.ts` (`buildPrescribedRows`) is the one place a prescription becomes rows. The
  client renderer and the log writer must both use it: `set_logs.set_type` is stamped by row position.
- An exercise's chosen columns are `prescribed_fields`: five names (set type, reps, load, RPE, rest),
  with NULL meaning all five, hard-coded in six places including two database checks (migration 149).
- `superset_group` exists on both exercise tables and nothing reads it.
- The exercise catalog (`exercises`) has name, muscle group, equipment and a free-text category, and no
  type. 1,508 global exercises are seeded from `scripts/data/exercises.csv` (compound 820, isolation
  603, cardio 49, plyometric 37); only "compound" is ever read.

**Logging, completion and analytics**
- A client logs a tick plus reps (1–100), weight (kg) and RPE (1–10) per set. Every save replaces all
  of the log's exercise logs. The client's Weight input always shows.
- Nothing stores time, distance, heart rate, watts, rounds or a score.
- Completion quality is derived in `utils/completion-quality.ts` from ticked working rows. Analytics
  (`services/exercise-analytics-service.ts` and the progression and PR database functions) and the
  check-in AI summary are strength-only.
- Units (CONVENTIONS §20): kg and cm only; no distance or time rules; two wire tags, and "do not add a
  third".
- Completion facts from the 2026-09-02 plan (DEV — re-probe): the log relationship is named
  `training_events_session_log_id_fkey` and must be named in embeds; 209 completed events had no
  linked log (test history, displayed as full); read constraint names from `pg_constraint`, never
  assume them; the old `lib/engagement-triggers.ts:62` site is now `isTrainingLogStatus` in
  `lib/logged-days.ts`.

**Surfaces**
- Builder: `components/clients/training/program-builder/` — the Schedule rail over a weeks × Day 1–7
  grid, weeks sortable, one DndContext; three targets: `library`, `client-draft` and `placed-plan`
  (Edit plan).
- Client: `GET /api/client/training-plan` (`types/client-training-plan.ts`) lays out one entry per day
  with `weekIndex`; the program header is the current block card in
  `components/client-portal/program/journey-section.tsx`.
- `docs/newdesignsystem.md` has no recipe yet for column selectors, presets, grouped exercise lists or
  phase tabs — add one when you build it.

**Bugs found while planning** (from reading code, not run)
- The check-in's training rows stay editable after a workout is logged, and marking one posts a log
  with no exercises; the server replaces all exercise logs on every save, so the logged sets are
  erased. (Commit 9.)
- The client tracker's snapshot fallback reads camelCase keys (`repsMin`, `rpeTarget`, `restSeconds`,
  `id`) from a snake_case snapshot (`set-tracker.tsx`), so a logged workout whose exercise was removed
  shows blank reps, RPE and rest. (Commit 11.)
- An exercise-level `rpeTarget` of 0 passes validation but fails the database check on client plans.
  (Commit 11.)

---

## 6. The commits

| # | Commit | After it |
|---|---|---|
| 1 | Change a program's start date | A coach fixes a wrong start from the Plans hero |
| 2 | Groups: the structure | Every exercise sits in a group; nothing looks different |
| 3 | Groups for the client | Clients see and log supersets and circuits |
| 4 | Groups in the builder | Coaches build straight sets, supersets and circuits |
| 5 | Several sessions a day: showing, moving and saving days | Nothing hides, drops or refuses a second session |
| 6 | Several sessions a day: building programs | Coaches write several sessions a day; placement lays them |
| 7 | Completion 1: quality reads from the log | Nothing reads the status word as quality |
| 8 | Completion 2: one check-in derivation | One summariser; the legacy check-in shape is gone |
| 9 | Completion 3: attendance lives on the calendar workout | No skips; Clear log |
| 10 | Completion 4: the flip | Partials count as completed everywhere |
| 11 | Measurement columns: data, units and client logging | Clients can log every measurement |
| 12 | Measurement columns and presets in the builder | Coaches choose each exercise's columns |
| 13 | Exercise types | New exercises start on their type's preset |
| 14 | Timed groups: scores and client logging | Clients do and score AMRAP, EMOM and For time |
| 15 | Timed groups in the builder, and their completion | Coaches prescribe timed groups |
| 16 | Progress charts by exercise type | Charts show each type's markers |
| 17 | Endurance progression | Duplicate-with-progression moves endurance targets |
| 18 | Phases: the structure | Programs carry phases; nothing looks different |
| 19 | Phases in the builder | Phase tabs in the builder |
| 20 | Drag weeks and sessions across phase tabs | Work moves between phases |
| 21 | Phase colours on the coach calendar | Every day shows its phase |
| 22 | Phases for the client | The client's program and header show phases |

### Commit 1 — Change a program's start date — SHIPPED 2026-09-16

```text
Implement commit 1 of 22 — Change a program's start date — from docs/TRAINING-UPGRADE-EXECUTION-PLAN.md.

Before anything else, read the plan's §1–§5 (skip the other commits' prompts), then CONVENTIONS.md and docs/ARCHITECTURE.md in full, then docs/newdesignsystem.md. Work the way §2 says: ARCHITECTURE.md describes today's product, so where this commit changes a shape it describes, follow the plan and rewrite that part of the doc. Plan first, with plain sentences, and wait for my go.

WHAT WE'RE BUILDING
A coach who customised a program for a client and placed it on the wrong day can move it from the Plans hero, instead of deleting it and redoing the customisation.

WHEN THIS COMMIT IS DONE
- The Training tab's Plans hero shows a pencil to the right of "Starts <date>"; it opens a calendar picker.
- A program starting today reads "Starts today" with the pencil, on its first day, until the client logs a workout.
- A program queued behind a running one shows as a second line under the running program's name — "Next: <name>, starts <date>" — with its own pencil.
- Picking a day moves the whole program: its start, its end and every calendar session shift by the same number of days, together, all or nothing.
- Days before the deletion floor are greyed in the picker and refused by the server.
- A move that would overlap another program, put a session on a day that already holds one, or cross a block's edge is refused with a sentence saying why. Nothing is shortened or trimmed.
- An Edit plan editor open on the moved program refuses its save as stale.
- Everything a training change refreshes today refreshes: the calendar, the nutrition calendar, the Overview, the attention feed, the block card.

RULES: §4.1 — closed except the items marked (confirm).

WATCH FOR
- The program's session rows are positional, counted from its start, so they don't change; its calendar sessions carry dates and do.
- A plain date update trips the one-scheduled-session-per-day index (migration 136); the move function (migration 150) already solves moving many sessions at once.
- resolveEventDeletionFloor is the only answer to the floor.

NOT IN THIS COMMIT: moving a program that has started (Edit plan covers that); nutrition target dates.
```

### Commit 2 — Groups: the structure — SHIPPED 2026-09-16

```text
Implement commit 2 of 22 — Groups: the structure — from docs/TRAINING-UPGRADE-EXECUTION-PLAN.md.

Before anything else, read the plan's §1–§5 (skip the other commits' prompts), then CONVENTIONS.md and docs/ARCHITECTURE.md in full, then CLIENT-APP-REFERENCE.md. Work the way §2 says: ARCHITECTURE.md describes today's product, so where this commit changes a shape it describes, follow the plan and rewrite that part of the doc. Plan first, with plain sentences, and wait for my go.

WHAT WE'RE BUILDING
The foundation for groups: every exercise sits in a group, and every path that saves, copies or reads exercises carries groups. Nothing a coach or client sees changes yet.

WHEN THIS COMMIT IS DONE
- Library and client sessions hold ordered groups, each with a format and the group settings in §4.2; each exercise belongs to one group, with a position in it.
- Every existing exercise has become a straight-sets group of one, in its current order, in library programs and client plans alike.
- superset_group is gone.
- Every path in §5 that saves or copies exercises carries groups exactly — including Edit plan's database function, the placed-session tray, placement from an edited client draft, and the log's prescription snapshot.
- The builder draft, the coach reads and the client wire carry groups; the AI assistant's schemas keep them, so its edits can't erase them.
- Tests prove groups survive every one of those paths. Close the existing prescribed_fields survival gaps (§5) while you're in there.
- Every screen renders exactly as it did.
- ARCHITECTURE.md and CLIENT-APP-REFERENCE.md describe groups.

RULES: §4.2 — closed.

WATCH FOR
- Validators strip unknown keys; the assistant's patch schemas reject them.
- The log snapshot's keys are pinned by a test.
- buildPrescribedRows stays the one place a prescription becomes rows; a group of one must never change how a set is stamped or counted.
- The library save is several separate writes: state what's out of step if it fails partway (CONVENTIONS §8).

NOT IN THIS COMMIT: any visible change (commits 3–4); what AMRAP, EMOM and For time do (commits 14–15).
```

### Commit 3 — Groups for the client — SHIPPED 2026-09-16

```text
Implement commit 3 of 22 — Groups for the client — from docs/TRAINING-UPGRADE-EXECUTION-PLAN.md.

Before anything else, read the plan's §1–§5 (skip the other commits' prompts), then CONVENTIONS.md and docs/ARCHITECTURE.md in full, then docs/newdesignsystem.md and CLIENT-APP-REFERENCE.md. Work the way §2 says: ARCHITECTURE.md describes today's product, so where this commit changes a shape it describes, follow the plan and rewrite that part of the doc. Plan first, with plain sentences, and wait for my go.

WHAT WE'RE BUILDING
Clients see and log grouped exercises. The builder can't make groups until commit 4, so this commit is smoked with seeded supersets and circuits.

WHEN THIS COMMIT IS DONE
- A group of one looks exactly as today.
- A superset or circuit shows its exercises under the group, with its rounds and rests; each exercise's rows are its rounds.
- Logging works as today (tick, reps, weight, RPE per row). The rest timer uses the group's rest between exercises and between rounds.
- Completion counts rows exactly as today.
- The client's program page and day summaries read sensibly for groups.
- The coach's session log view shows the grouping.
- CLIENT-APP-REFERENCE.md documents groups for the React Native app.

RULES: §4.2 — closed.

WATCH FOR
- Set identity is by row position from buildPrescribedRows: a logged round must land on the right row.
- The web client is a test harness; the wire is the contract.

NOT IN THIS COMMIT: building groups (commit 4); AMRAP, EMOM and For time (commits 14–15).
```

### Commit 4 — Groups in the builder — SHIPPED 2026-09-17

```text
Implement commit 4 of 22 — Groups in the builder — from docs/TRAINING-UPGRADE-EXECUTION-PLAN.md.

Before anything else, read the plan's §1–§5 (skip the other commits' prompts), then CONVENTIONS.md and docs/ARCHITECTURE.md in full, then docs/newdesignsystem.md. Work the way §2 says: ARCHITECTURE.md describes today's product, so where this commit changes a shape it describes, follow the plan and rewrite that part of the doc. Plan first, with plain sentences, and wait for my go.

WHAT WE'RE BUILDING
Coaches build straight sets, supersets and circuits.

WHEN THIS COMMIT IS DONE
- In the session editor, a lone exercise looks like today's exercise card. Only linked exercises — a superset or circuit — sit under a slim header showing the group's name and settings. A coach never sees a group around a single exercise.
- A coach can link any exercises into a superset or circuit, unlink them, move exercises into and out of a circuit, and reorder exercises and circuits.
- Group settings: format (straight sets or superset/circuit), rounds, rest between exercises, rest between rounds, notes. In a looped group, each exercise's rows follow the group's rounds, and each round can have its own targets.
- It works everywhere a session is edited: the session sheet, the create slide-over, the placed-session tray, the standalone workout editor, and all three builder targets (library, client draft, Edit plan).
- Summaries — the week grid's day cells, library cards, calendar readouts — read sensibly for groups.
- The AI assistant can create and edit groups; duplicate-with-progression walks groups.
- docs/newdesignsystem.md gains the grouped-exercise recipe.

RULES: §4.2 — closed. Include a frame test for every group interaction (§2).

WATCH FOR
- The assistant's server executors and the client replay share one op module; group operations go into that module, never into one side only.
- The builder's normaliser, clone helpers and locked mutators all assume a flat exercise list.

NOT IN THIS COMMIT: AMRAP, EMOM and For time (commits 14–15).
```

### Commit 5 — Several sessions a day: showing, moving and saving days — SHIPPED 2026-09-17

```text
Implement commit 5 of 22 — Several sessions a day: showing, moving and saving days — from docs/TRAINING-UPGRADE-EXECUTION-PLAN.md.

Before anything else, read the plan's §1–§5 (skip the other commits' prompts), then CONVENTIONS.md and docs/ARCHITECTURE.md in full, then docs/newdesignsystem.md and CLIENT-APP-REFERENCE.md. Work the way §2 says: ARCHITECTURE.md describes today's product, so where this commit changes a shape it describes, follow the plan and rewrite that part of the doc. Plan first, with plain sentences, and wait for my go.

WHAT WE'RE BUILDING
Any day can hold several sessions, and nothing in the product hides one, drops one or refuses a day for having one.

WHEN THIS COMMIT IS DONE
- The database no longer limits a client to one scheduled session per day.
- Every surface that shows a day shows each session on it, in order: the coach calendar, the client's day view and program, check-in lists, and the coach's Data table and other per-day views (one row per workout).
- Moving a session onto a day that holds one joins that day, last in order — the coach's drag, library drops onto the calendar, the client's week rearranging, and changing a program's start date. A swap is two moves.
- Edit plan shows every session on a day, lets the coach open, edit or remove each one, and saves days with several sessions without losing any.
- A day's training calories add every session's surplus.
- CONVENTIONS.md, ARCHITECTURE.md and CLIENT-APP-REFERENCE.md describe the new rule.

RULES: §4.3 — closed.

WATCH FOR
- §5's one-per-day list: migration 136, eventByDay and its readers, Edit plan's one-entry-per-day save, the client's week layout, the occupancy guards, the move function, nutrition's first-session surplus.
- The completion commits (7–10) change the words on the per-day views next. Here, make those views one row per workout and leave their words alone.

NOT IN THIS COMMIT: adding a session to an occupied day in the builder, or placement laying several sessions a day (commit 6).
```

### Commit 6 — Several sessions a day: building programs

```text
Implement commit 6 of 22 — Several sessions a day: building programs — from docs/TRAINING-UPGRADE-EXECUTION-PLAN.md.

Before anything else, read the plan's §1–§5 (skip the other commits' prompts), then CONVENTIONS.md and docs/ARCHITECTURE.md in full, then docs/newdesignsystem.md. Work the way §2 says: ARCHITECTURE.md describes today's product, so where this commit changes a shape it describes, follow the plan and rewrite that part of the doc. Plan first, with plain sentences, and wait for my go.

WHAT WE'RE BUILDING
Coaches write programs with several sessions on a day.

WHEN THIS COMMIT IS DONE
- In the library builder, client drafts and Edit plan, a coach can add a session to a day that already has one, reorder sessions within a day, and drag a session onto an occupied day to join it.
- Placing a program — from the library or from an edited client draft — lays each day's sessions on that date in order.
- A duplicated week keeps each day's sessions and their order.
- Sessions per week can exceed 7 in every stored and shown figure.
- The AI assistant can put a second session on a day.
- The week grid's day cells summarise every session on the day.

RULES: §4.3 — closed. Include a frame test for the day-cell interactions (§2).

WATCH FOR
- Since commit 5 the builder's day slot holds a list of sessions (`DaySlotDraft.sessions`) and Edit plan saves them; the builder still adds a session only to a rest day, a drop onto a day holding one only swaps two lone sessions (`moveSessionToDay`), and a library exercise lands only on a day holding one session.
- Sessions on the same day share a week and day position, so they need an order within the day. Two session rows on the same position were once a corruption bug: make same-day rows legitimate and unambiguous, and make every reader that assumed one row per position handle a list.
- training_plans.frequency_per_week is checked 1–7.

NOT IN THIS COMMIT: anything commit 5 already did.
```

### Commit 7 — Completion 1: quality reads from the log

```text
Implement commit 7 of 22 — Completion 1: quality reads from the log — from docs/TRAINING-UPGRADE-EXECUTION-PLAN.md.

Before anything else, read the plan's §1–§5 (skip the other commits' prompts), then CONVENTIONS.md and docs/ARCHITECTURE.md in full. Work the way §2 says: ARCHITECTURE.md describes today's product, so where this commit changes a shape it describes, follow the plan and rewrite that part of the doc. Plan first, with plain sentences, and wait for my go.

WHAT WE'RE BUILDING
The first of four commits that give training one completion vocabulary (§4.7). This one changes no count and no stored value: every screen stops reading a workout's quality (full or partial) from the status word and reads it from the log.

WHEN THIS COMMIT IS DONE
- Every read of calendar sessions that needs quality embeds the log's quality through the named relationship (§4.7 M3).
- There is one mapEventRow (M11).
- One pure helper turns a calendar session into its display state — scheduled, completed full, completed partial, skipped, missed — and every tick, dash, chip and pill keys on it: the calendar card, the client's day summary, the Data table, the attention feed, the Overview rail, check-in rows. No display reads the status word as quality.
- The per-workout schedule shape follows M5, with amendment 2: its status carries attendance words only, and partial, completed_swap, rest_trained and the merge of logs with no calendar session go.
- The Overview rail classifies a day from its workouts (M9); its count is unchanged here.
- For every quality display, a test with a completed session whose log is partial proves it renders partial. These are commit 10's safety net; mutation-check one.
- Frozen period_snapshot JSON in old check-ins still renders.
- ARCHITECTURE.md describes what's true after this commit.

RULES: §4.7, M1–M13 and the amendments — closed.

WATCH FOR: completed sessions with no linked log (209 on DEV in September — re-probe) display as full.

NOT IN THIS COMMIT: any count change, stored value or label (commit 10); removing skipped (commit 9); the legacy check-in shape (commit 8).
```

### Commit 8 — Completion 2: one check-in derivation

```text
Implement commit 8 of 22 — Completion 2: one per-workout shape, one check-in derivation — from docs/TRAINING-UPGRADE-EXECUTION-PLAN.md.

Before anything else, read the plan's §1–§5 (skip the other commits' prompts), then CONVENTIONS.md and docs/ARCHITECTURE.md in full, then CLIENT-APP-REFERENCE.md. Work the way §2 says: ARCHITECTURE.md describes today's product, so where this commit changes a shape it describes, follow the plan and rewrite that part of the doc. Plan first, with plain sentences, and wait for my go.

WHAT WE'RE BUILDING
The second completion commit. The check-in's legacy per-workout shape goes, and every training figure in a check-in comes from one derivation. Every number on every screen stays the same.

WHEN THIS COMMIT IS DONE
- The legacy session-completion shape (CheckInSessionCompletion and everything built on it) is deleted, not wrapped; both single check-in reads carry the per-workout details the wizard already receives.
- One pure summariser, lib/training-adherence.ts (M6), works over any rows carrying status and quality. The old check-in adherence module goes, and its ownership scan moves beside the new one.
- The check-in context derives its training stats once, from the details it already fetches, and adds a partial count inside the stats (additive for the React Native app). The check-in submit stores workouts_completed through the same derivation.
- The wizard's checklist stops counting. The wizard's fallback to daily logs, which reads a table nothing writes, goes.
- ARCHITECTURE.md, CONVENTIONS.md §8's sentence on workouts_completed, and CLIENT-APP-REFERENCE.md describe it.

RULES: §4.7 — closed.

WATCH FOR: check every consumer of both check-in wires before changing a shape (CONVENTIONS, "API changes cascade").

NOT IN THIS COMMIT: the hero or removing skipped (commit 9); any count change (commit 10).
```

### Commit 9 — Completion 3: attendance lives on the calendar workout

```text
Implement commit 9 of 22 — Completion 3: attendance lives on the calendar workout — from docs/TRAINING-UPGRADE-EXECUTION-PLAN.md.

Before anything else, read the plan's §1–§5 (skip the other commits' prompts), then CONVENTIONS.md and docs/ARCHITECTURE.md in full, then CLIENT-APP-REFERENCE.md. Work the way §2 says: ARCHITECTURE.md describes today's product, so where this commit changes a shape it describes, follow the plan and rewrite that part of the doc. Plan first, with plain sentences, and wait for my go.

WHAT WE'RE BUILDING
The third completion commit. Figures count calendar workouts by date, nothing produces a skip any more, and a client can clear a log they didn't mean to save. Counts don't change.

WHEN THIS COMMIT IS DONE
- The Training-tab hero and the Overview plan card count calendar workouts by date (M7), not logs by their stored date; countEventsInRange goes; the hero's service gets tests on its primary branch.
- Nothing produces a skip (M4): a save with nothing logged is refused with a plain sentence, written so commit 11's measurements and commit 14's group scores can count as logged (amendment 1); the React Native quick path accepts full or partial only; the wizard's selector loses Skipped; every skip display goes (the type value stays until commit 10).
- Clear log ships: one atomic database function plus DELETE /api/client/training/events/[eventId]/log, allowed exactly where the day-edit rule allows editing (read "Date-edit permissions" in ARCHITECTURE.md when you run). It follows CONVENTIONS' route auth chain, is proved against DEV with a real session, and is documented in CLIENT-APP-REFERENCE.md.
- Changing a logged workout's status from the check-in never erases its logged sets (amendment 5; §5).
- ARCHITECTURE.md describes it; TECHNICAL-DEBT.md records that a moved workout leaves its log's stored date behind.

RULES: §4.7 — closed.

NOT IN THIS COMMIT: the status constraint, the type change, the counting change or labels (commit 10).
```

### Commit 10 — Completion 4: the flip

```text
Implement commit 10 of 22 — Completion 4: the flip — from docs/TRAINING-UPGRADE-EXECUTION-PLAN.md.

Before anything else, read the plan's §1–§5 (skip the other commits' prompts), then CONVENTIONS.md and docs/ARCHITECTURE.md in full, then CLIENT-APP-REFERENCE.md. Work the way §2 says: ARCHITECTURE.md describes today's product, so where this commit changes a shape it describes, follow the plan and rewrite that part of the doc. Plan first, with plain sentences, and wait for my go.

WHAT WE'RE BUILDING
The last completion commit. Partial workouts count as completed on every screen, and training speaks one vocabulary.

WHEN THIS COMMIT IS DONE
- Before the migration is written, the data is probed on DEV and on PROD (I run PROD's queries): the status distribution, skipped logs, and the live constraint names.
- A calendar session's status is scheduled or completed: partial becomes completed, skipped and missed become scheduled, and skipped logs are deleted. A log's quality is full or partial. Column comments say what each means.
- The type unions shrink and the log link always writes completed. Let the compiler find the remaining literals, and fix each at the root.
- Every done-count includes partials by construction: check-in stats and the stored workouts_completed, the Overview, the hero and plan card, the summariser, the client week, engagement triggers, the activity-calorie alert (M10), and completed-workout checks.
- Labels follow M8 — Full, Partial or Missed for a workout, "completed" only in counts — and check:labels passes.
- The ownership scan loses its count rule and keeps "no coach surface reads the stored workouts_completed" until the check-in rework.
- Commit 7's partial-render tests pass unchanged. A summariser case with five completed sessions, one partial, reads planned 5, completed 5, full 4, partial 1, missed 0, pct 100.
- ARCHITECTURE.md, CONVENTIONS.md §8 and CLIENT-APP-REFERENCE.md describe the shipped shape, including a rewrite of the stale "Training Session Completion" section in CLIENT-APP-REFERENCE.md.
- PROD: after my DEV smoke passes, I push. Then regenerate types from PROD, diff them against the repo, and re-run the verification queries on PROD.

RULES: §4.7 — closed.

WATCH FOR: migration 136 was dropped in commit 5 — don't reintroduce it; the move function's scheduled check must keep working.

NOT IN THIS COMMIT: one report assembly for both check-in views (the old 4b — the check-in rework).
```

### Commit 11 — Measurement columns: data, units and client logging

```text
Implement commit 11 of 22 — Measurement columns: data, units and client logging — from docs/TRAINING-UPGRADE-EXECUTION-PLAN.md.

Before anything else, read the plan's §1–§5 (skip the other commits' prompts), then CONVENTIONS.md and docs/ARCHITECTURE.md in full, then docs/newdesignsystem.md and CLIENT-APP-REFERENCE.md. Work the way §2 says: ARCHITECTURE.md describes today's product, so where this commit changes a shape it describes, follow the plan and rewrite that part of the doc. Plan first, with plain sentences, and wait for my go.

WHAT WE'RE BUILDING
Everything needed to prescribe and log every measurement in §4.4, except the builder controls. Clients can log the new measurements before coaches can prescribe them, so this commit is smoked with seeded prescriptions.

WHEN THIS COMMIT IS DONE
- The full column list (§4.4) is defined once, and the database check, validators, builder, client and assistant all use it — replacing the five names hard-coded in six places.
- An exercise's column list is never empty: existing empty lists get today's five, and new exercises always carry an explicit list.
- A set's targets can hold every column's value, with ranges where §4.4 says. Validators and database checks agree (including the RPE 0 mismatch in §5).
- A logged set can record every measurement as real columns, with sensible limits for each.
- Distance and time are stored as metres and seconds, pace is worked out from them, and all of it is converted only on screen by the viewer's units. CONVENTIONS §20 gains the distance and time rules, and conversions live in the one units module.
- The client logs whatever the exercise's columns ask for; Weight shows only when Load is on; the log API takes canonical values with no new unit tag; rows still come from buildPrescribedRows.
- A set counts as logged when any value is recorded (§4.7 amendment 1).
- The prescription snapshot carries the new fields, and the client's snapshot fallback reads them with the right key spelling (§5).
- The coach's session log view and the check-in AI summary describe the new measurements sensibly.
- Strength analytics are unchanged for strength sets.
- CLIENT-APP-REFERENCE.md documents all of it.

RULES: §4.4 — closed.

WATCH FOR: every path that copies or saves exercises must carry the new set fields — validators strip unknown keys, so extend the survival tests.

NOT IN THIS COMMIT: the builder's column selector and presets (commit 12); exercise types (commit 13); charts (commit 16).
```

### Commit 12 — Measurement columns and presets in the builder

```text
Implement commit 12 of 22 — Measurement columns and presets in the builder — from docs/TRAINING-UPGRADE-EXECUTION-PLAN.md.

Before anything else, read the plan's §1–§5 (skip the other commits' prompts), then CONVENTIONS.md and docs/ARCHITECTURE.md in full, then docs/newdesignsystem.md. Work the way §2 says: ARCHITECTURE.md describes today's product, so where this commit changes a shape it describes, follow the plan and rewrite that part of the doc. Plan first, with plain sentences, and wait for my go.

WHAT WE'RE BUILDING
Coaches choose what each exercise measures.

WHEN THIS COMMIT IS DONE
- Each exercise's column selector lists the presets first, then every column grouped as Strength, Endurance and Framework; any column can be ticked or unticked.
- The presets are one per exercise type plus Circuit; put each preset's exact columns to me as plain sentences. A preset applies to one exercise or to a whole group.
- Set rows edit every chosen column, including ranges, Pace versus Split, and units by the viewer.
- New exercises start on the Strength preset until commit 13.
- It works everywhere a session is edited and in all three builder targets.
- The AI assistant can set columns and apply presets when it adds or edits an exercise.
- docs/newdesignsystem.md gains the column selector and preset recipe.

RULES: §4.4 — closed. Include a frame test for the selector and presets (§2).

NOT IN THIS COMMIT: exercise types (commit 13).
```

### Commit 13 — Exercise types

```text
Implement commit 13 of 22 — Exercise types — from docs/TRAINING-UPGRADE-EXECUTION-PLAN.md.

Before anything else, read the plan's §1–§5 (skip the other commits' prompts), then CONVENTIONS.md and docs/ARCHITECTURE.md in full, then docs/newdesignsystem.md. Work the way §2 says: ARCHITECTURE.md describes today's product, so where this commit changes a shape it describes, follow the plan and rewrite that part of the doc. Plan first, with plain sentences, and wait for my go.

WHAT WE'RE BUILDING
Every exercise in the catalog knows its type, so a new exercise starts on the right preset — and, from commit 16, the right chart.

WHEN THIS COMMIT IS DONE
- Every catalog exercise has a type from §4.4's list. Coach-made exercises have one too (Strength by default), editable in the exercise form. Put it to me whether the exercises table shows or filters by type.
- Global exercises are classified per §4.4. Before the migration, show me the full proposed classification of the cardio and plyometric exercises, plus every carry, sled and hold picked out by name, and wait for my review.
- "Burpee Broad Jump" is in the catalog.
- A new exercise in the builder starts on its type's preset; the AI assistant sees types and uses them.
- The Category field is unchanged, and the seed data carries types.

RULES: §4.4 — closed.

NOT IN THIS COMMIT: charts (commit 16).
```

### Commit 14 — Timed groups: scores and client logging

```text
Implement commit 14 of 22 — Timed groups: scores and client logging — from docs/TRAINING-UPGRADE-EXECUTION-PLAN.md.

Before anything else, read the plan's §1–§5 (skip the other commits' prompts), then CONVENTIONS.md and docs/ARCHITECTURE.md in full, then docs/newdesignsystem.md and CLIENT-APP-REFERENCE.md. Work the way §2 says: ARCHITECTURE.md describes today's product, so where this commit changes a shape it describes, follow the plan and rewrite that part of the doc. Plan first, with plain sentences, and wait for my go.

WHAT WE'RE BUILDING
Clients can do and score AMRAP, EMOM and For time groups. Coaches can't prescribe them until commit 15, so this commit is smoked with seeded timed groups.

WHEN THIS COMMIT IS DONE
- A logged workout can record each timed group's score: rounds plus extra reps for AMRAP; the finish time for For time, or the rounds and reps reached when capped; EMOM as decided in §4.5.
- The client's workout shows timed groups with simple timers — a countdown to the cap, an EMOM interval cue, a For time stopwatch — and lets the client enter the score.
- The log API accepts group scores, and the prescription snapshot carries the group settings.
- A logged group score counts as logged (§4.7 amendment 1).
- The coach's session log view shows scores.
- CLIENT-APP-REFERENCE.md documents it.

RULES: §4.2 and §4.5 — closed except the items marked (confirm).

NOT IN THIS COMMIT: choosing timed formats in the builder, or Full versus Partial for timed groups (commit 15).
```

### Commit 15 — Timed groups in the builder, and their completion

```text
Implement commit 15 of 22 — Timed groups in the builder, and their completion — from docs/TRAINING-UPGRADE-EXECUTION-PLAN.md.

Before anything else, read the plan's §1–§5 (skip the other commits' prompts), then CONVENTIONS.md and docs/ARCHITECTURE.md in full, then docs/newdesignsystem.md. Work the way §2 says: ARCHITECTURE.md describes today's product, so where this commit changes a shape it describes, follow the plan and rewrite that part of the doc. Plan first, with plain sentences, and wait for my go.

WHAT WE'RE BUILDING
Coaches prescribe AMRAP, EMOM and For time, and completion knows what finishing one means.

WHEN THIS COMMIT IS DONE
- Group settings offer AMRAP, EMOM and For time, each with its time cap, interval and rounds.
- A timed group counts toward Full or Partial per the rule you put to me (§4.5).
- Summaries, the check-in AI summary and the coach's views describe timed groups sensibly.
- The AI assistant can build timed groups.
- docs/newdesignsystem.md covers the timed-group settings.

RULES: §4.2, §4.5 and §4.7 — closed except the items marked (confirm). Include a frame test for the settings (§2).
```

### Commit 16 — Progress charts by exercise type

```text
Implement commit 16 of 22 — Progress charts by exercise type — from docs/TRAINING-UPGRADE-EXECUTION-PLAN.md.

Before anything else, read the plan's §1–§5 (skip the other commits' prompts), then CONVENTIONS.md and docs/ARCHITECTURE.md in full, then docs/newdesignsystem.md. Work the way §2 says: ARCHITECTURE.md describes today's product, so where this commit changes a shape it describes, follow the plan and rewrite that part of the doc. Plan first, with plain sentences, and wait for my go.

WHAT WE'RE BUILDING
Each exercise's progress chart shows the markers that matter for its type.

WHEN THIS COMMIT IS DONE
- The coach's exercise data view and the client's progress view chart each exercise by its type's markers (§4.4); strength charts are unchanged.
- A chart follows what was actually logged when that differs from the type.
- The aggregation lives in the data layer, bounded like the existing progression and PR functions — the React Native app is the real client.
- Overview progress and PR activity keep working. Put it to me whether endurance bests (a fastest 1,000 m row, say) appear as PRs.

RULES: §4.4 — closed.
```

### Commit 17 — Endurance progression

```text
Implement commit 17 of 22 — Endurance progression — from docs/TRAINING-UPGRADE-EXECUTION-PLAN.md.

Before anything else, read the plan's §1–§5 (skip the other commits' prompts), then CONVENTIONS.md and docs/ARCHITECTURE.md in full, then docs/newdesignsystem.md. Work the way §2 says: ARCHITECTURE.md describes today's product, so where this commit changes a shape it describes, follow the plan and rewrite that part of the doc. Plan first, with plain sentences, and wait for my go.

WHAT WE'RE BUILDING
Duplicate-with-progression can progress endurance targets as well as strength ones.

WHEN THIS COMMIT IS DONE
- The progression dialog and the AI assistant's week duplication offer endurance rules beside today's load, reps and sets — for example distance or duration up by an amount or a percentage, pace or split faster by seconds. Put the exact rule set to me as plain sentences.
- The preview shows before and after for those measurements.
- The sets rule no longer adds sets where that makes no sense; put the rule to me.
- Progression walks groups and several sessions a day.

RULES: §4.4 — closed.
```

### Commit 18 — Phases: the structure

```text
Implement commit 18 of 22 — Phases: the structure — from docs/TRAINING-UPGRADE-EXECUTION-PLAN.md.

Before anything else, read the plan's §1–§5 (skip the other commits' prompts), then CONVENTIONS.md and docs/ARCHITECTURE.md in full. Work the way §2 says: ARCHITECTURE.md describes today's product, so where this commit changes a shape it describes, follow the plan and rewrite that part of the doc. Plan first, with plain sentences, and wait for my go.

WHAT WE'RE BUILDING
The foundation for periodisation phases: programs and client plans can hold phases, and every path that saves or copies a program carries them. Nothing a coach or client sees changes yet.

WHEN THIS COMMIT IS DONE
- A library program holds an ordered list of phases (§4.6 data), and a client's plan holds its own copy. A program with no phases is exactly today.
- Every path that saves or copies a program carries its phases: the library save, duplicate, promote from draft, placement from the library and from an edited client draft (cut where the program is cut, repeated where it repeats), and Edit plan's read and its one-function save. A save whose phases don't add up to the plan's weeks is refused.
- One server function answers which phase a date is in — and each phase's date range over a window — for a client's plans, trimmed to each plan's own dates.
- Tests prove phases survive every path.
- ARCHITECTURE.md describes the phase model, including that no other table carries a phase.

RULES: §4.6 — closed.

WATCH FOR
- client_phases is the blocks table; name new things so nobody confuses the two.
- The library save is several separate writes: state what's out of step if it fails partway (CONVENTIONS §8).

NOT IN THIS COMMIT: any visible change (commits 19–22).
```

### Commit 19 — Phases in the builder

```text
Implement commit 19 of 22 — Phases in the builder — from docs/TRAINING-UPGRADE-EXECUTION-PLAN.md.

Before anything else, read the plan's §1–§5 (skip the other commits' prompts), then CONVENTIONS.md and docs/ARCHITECTURE.md in full, then docs/newdesignsystem.md. Work the way §2 says: ARCHITECTURE.md describes today's product, so where this commit changes a shape it describes, follow the plan and rewrite that part of the doc. Plan first, with plain sentences, and wait for my go.

WHAT WE'RE BUILDING
Coaches split a program into phases, shown as tabs.

WHEN THIS COMMIT IS DONE
- A tab row sits under the builder's Schedule rail: one tab per phase, and a way to add a phase.
- Each tab shows only its phase's weeks, and week numbers carry on across tabs.
- Add week, delete week, duplicate and duplicate-with-progression work inside the open tab, and a copy stays in its phase; weeks reorder within a tab.
- A phase can be named and given a colour from the palette, which is added to docs/newdesignsystem.md.
- It works in all three builder targets: applying a client draft carries its phases, and Edit plan shows tabs over the laid plan, with today's locks on weeks that have started.
- The AI assistant's week operations keep phases valid.
- Before building, put §4.6's open questions to me.

RULES: §4.6 — closed except the items marked (confirm). Include a frame test for the tab switch (§2).

NOT IN THIS COMMIT: dragging across tabs (commit 20); calendar and client display (commits 21–22).
```

### Commit 20 — Drag weeks and sessions across phase tabs

```text
Implement commit 20 of 22 — Drag weeks and sessions across phase tabs — from docs/TRAINING-UPGRADE-EXECUTION-PLAN.md.

Before anything else, read the plan's §1–§5 (skip the other commits' prompts), then CONVENTIONS.md and docs/ARCHITECTURE.md in full, then docs/newdesignsystem.md. Work the way §2 says: ARCHITECTURE.md describes today's product, so where this commit changes a shape it describes, follow the plan and rewrite that part of the doc. Plan first, with plain sentences, and wait for my go.

WHAT WE'RE BUILDING
Coaches move weeks and sessions between phases by dragging.

WHEN THIS COMMIT IS DONE
- While a week or a session is being dragged, hovering a tab opens it, and the drag carries on to wherever the coach lets go.
- A week dropped into another tab joins that phase at that position, with its sessions; the phases' week counts and the week numbers update.
- A session dropped onto a day in another tab moves like any session move, joining a day that already holds sessions.
- In Edit plan, today's week rules hold.
- The dragged item stays under the pointer through the tab change, with no flash.

RULES: §4.6 — closed. Include a frame test for a drag across a tab change (§2).
```

### Commit 21 — Phase colours on the coach calendar

```text
Implement commit 21 of 22 — Phase colours on the coach calendar — from docs/TRAINING-UPGRADE-EXECUTION-PLAN.md.

Before anything else, read the plan's §1–§5 (skip the other commits' prompts), then CONVENTIONS.md and docs/ARCHITECTURE.md in full, then docs/newdesignsystem.md. Work the way §2 says: ARCHITECTURE.md describes today's product, so where this commit changes a shape it describes, follow the plan and rewrite that part of the doc. Plan first, with plain sentences, and wait for my go.

WHAT WE'RE BUILDING
The coach's training calendar shows which phase every day is in.

WHEN THIS COMMIT IS DONE
- Every day of a phase's weeks carries the phase colour, day by day, including rest days and days with no sessions.
- The phase name is visible on the calendar, not only its colour.
- A moved session shows the colour of the day it's on.
- Days outside any plan, and plans without phases, look as today.
- The colours come from commit 18's function; nothing is stored per session or per day.

RULES: §4.6 — closed.
```

### Commit 22 — Phases for the client

```text
Implement commit 22 of 22 — Phases for the client — from docs/TRAINING-UPGRADE-EXECUTION-PLAN.md.

Before anything else, read the plan's §1–§5 (skip the other commits' prompts), then CONVENTIONS.md and docs/ARCHITECTURE.md in full, then docs/newdesignsystem.md and CLIENT-APP-REFERENCE.md. Work the way §2 says: ARCHITECTURE.md describes today's product, so where this commit changes a shape it describes, follow the plan and rewrite that part of the doc. Plan first, with plain sentences, and wait for my go.

WHAT WE'RE BUILDING
Clients see their program's phases.

WHEN THIS COMMIT IS DONE
- The client training-plan wire carries each phase with its dates already worked out, and whatever the client needs to place days under phases; CLIENT-APP-REFERENCE.md documents it.
- The client's program lists weeks under their phase, in its colour.
- The program header names the current phase under the block; with no current block, the phase line appears on the training program card (§4.6, confirm).
- This is the last commit: delete this plan file in it, once everything it describes lives in ARCHITECTURE.md.

RULES: §4.6 — closed.
```
