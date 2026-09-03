# Training completion — one vocabulary (execution plan)

**Status: APPROVED 2026-09-02 (owner). No code written. Five commits, each with a pasteable
prompt in §5 — commit 4b was added 2026-09-03 (owner) and runs last, after commit 4 and after
measurement-log commit 8c (a submitted check-in closes its period), which ships before this
plan begins. Delete this file after commit 4b ships; the model then lives in
`docs/ARCHITECTURE.md` and the STATUS ledger below lives in git history. Migration numbers in
this file were written when dev was at 157; the measurement log has since taken 158–162, so
every "158" and "159" below reads "the next free number at execution time" (163 and 164 at
the time of the 4b edit).**

## STATUS

| Commit | State | Shipped as | Deviations / notes |
|---|---|---|---|
| 1 — Quality reads from the log | not started | | |
| 2 — One per-workout shape, one check-in derivation | not started | | |
| 3 — Attendance lives on the calendar workout | not started | | |
| 4 — The flip: one vocabulary | not started | | |
| 4b — One report assembly for both check-in views (added 2026-09-03; after 4, and after measurement-log commit 8c) | not started | | |

Each session updates its row when it finishes: the commit hash, and anything it did
differently from this plan and why. A later session reads this table before its prompt.

---

## 0. The problem

The platform disagrees with itself about whether a partially completed workout counts as
done. For one test client's week of 24–30 Aug 2026 (five prescribed sessions, four logged in
full, one logged partial) the client's check-in reads 4/5, the coach's review page reads 5/5,
and the Overview card and the Training tab read 4/5. Same week, same five rows, three answers.

The owner's rule: **a partial workout counts as completed, everywhere.** The quality (full or
partial) stays visible beside the number on every surface.

The root cause is the shape, not any one counter. `training_events.status` stores two facts in
one word: whether anything happened (`scheduled` is load-bearing — the one-workout-per-day
index, the amendment lock, the move RPC and placement's window-delete all key on it) and how
much of the prescription was done (`completed` = full, `partial`), which is a copy of
`session_logs.completion_quality`. Every reader that asks "did they train?" has to know two of
the stored values mean yes, which is why the rule was spelled ten different ways. `missed` is
never stored; every screen derives it. `skipped` is an empty log that locks the day.

## 1. The end-state model — CLOSED decisions (owner, 2026-09-02)

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

## 2. Verified facts (dev, 2026-09-02)

Counts do not travel between databases. Commit 4 re-probes prod before it pushes.

| Fact | Value |
|---|---|
| Dev project / prod project | `aeaphsslctwcmebldrzx` / `etezzztgafcotyahgijk` |
| Migrations applied on dev and prod | 162 on both since 2026-09-03 (`162_measurement_order_by_recorded_at.sql` is the latest file; the measurement log took 158–162). Next numbers at the 4b edit: 163 (commit 3's RPC), 164 (the flip) — take the next free numbers at execution time, never these by rote |
| `training_events` status distribution (dev) | completed 7,688 (209 with **no** linked log — two test clients, rows created 22 May–4 Jun 2026); partial 1,851 (all with logs); scheduled 2,055; skipped 0; missed 0 |
| Status constraint (live name) | `training_events_status_check` — `status IN ('scheduled','completed','partial','missed','skipped')` |
| Log FK (live name) | `training_events_session_log_id_fkey` — `session_log_id → session_logs(id) ON DELETE SET NULL` |
| Other live constraints on `training_events` | `uq_training_events_session_date UNIQUE (client_id, training_session_id, date)` (mig 076); partial unique index on `(client_id, date) WHERE status = 'scheduled'` (mig 136) — **unchanged by this plan** |
| Writers of a non-`scheduled` status | exactly one: `linkSessionLogToEvent` (`services/training-event-service.ts:286`) via `mapCompletionQualityToEventStatus` (`:252`), called from `services/training-log-service.ts:729-734`. Placement/walk/calendar writes write `scheduled` only. No coach path writes a status. |
| Readers of `session_logs.completed_at` for a figure | `services/training-week-summary-service.ts:40-41` (the hero — M7 retires this); `app/api/clients/[id]/history/training/route.ts:55-57, 114-117` (earliest-activity bound + unlinked-log merge — M5 retires the merge); `services/training-event-layout-service.ts:108-111` (a move guard — untouched) |
| Supabase CLI | 2.105.0 installed, 2.116.0 available. `brew upgrade supabase` before any migration push (an old CLI has broken multi-statement function migrations here before) |
| `db push` | Sometimes classifier-blocked in this harness. Always `--dry-run` immediately before; it auto-confirms under non-TTY stdin. If refused, the owner runs it by typing `! npx supabase db push` |

## 3. Inventory — starting points, not a deletion source

Grep at execution time. These are the sites verified on 2026-09-02; a session must re-find them.

**Done-decisions (status → did they train?)**
`services/check-in-context-service.ts` `getCheckInTrainingPeriodStats` (`.eq("status","completed")`) ·
`components/check-in/training-session-checklist.tsx:79` (count) and `:129` (row tint) ·
`services/client-adherence-service.ts:21-24` (`classifyTrainingDay`), `:75` (count), `:176` (its own select) ·
`services/training-week-summary-service.ts:36-54` (logs by `completed_at`, quality `full`, `countEventsInRange`) ·
`lib/check-in/adherence.ts` (`classifySession`, `summariseSessions`) ·
`utils/ai-prompt-builder.ts:83-87` (mapping), `:115` (branch), `:136-142` (dead fallback over `sessionCompletions`) ·
`services/check-in-details-service.ts:113-135` (`deriveSessionCompletionsForCheckIn`) ·
`services/client-training-week-service.ts:17` (`deriveState`) ·
`lib/engagement-triggers.ts:62` · `lib/activity-triggers.ts:109` · `lib/tracking-triggers.ts:130, 157, 166` ·
`services/training-event-occupancy.ts:109` (`.in("status", ["completed","partial"])`) ·
`utils/training-event-helpers.ts:40` (`STATUS_PRIORITY`, `Record<string, number>`), `:88` (swap detection), `:161` (`resolveEventStatus`).

**Quality displays (read the status word as full/partial today)**
`utils/training-event-helpers.ts:161` `resolveEventStatus` → `ScheduleDay.completionQuality` (data table via `app/api/clients/[id]/history/training/route.ts`, snapshot via `services/check-in-snapshot-service.ts`, AI prompt via `utils/ai-prompt-builder.ts:240-246`) ·
`components/clients/training/calendar/calendar-tokens.ts:25` `STATUS_THUMB: Record<TrainingEventStatus, …>` used by `calendar-event-card.tsx:67` ·
`services/training-event-service.ts:312` `mapStatusToCompletionQuality` → `:435` (client day summaries → `components/client-portal/day/training-card-summary.tsx:65`) ·
`components/clients/training/training-history-table.tsx:33-72` (chip switch on `completion_quality`) ·
`components/clients/training/session-log-detail-dialog.tsx:77` ·
`components/check-in/training-section.tsx:34-37` (`STATUS_META`) · `components/check-in/kpi-ribbon.tsx:120-145`.

**The legacy per-workout shape (deleted in commit 2)**
`types/check-in.ts:101` `CheckInSessionCompletion`, `:173` (`CheckInFormData.sessionCompletions`), `:821` (`CheckInWithDetails.sessionCompletions`) ·
`lib/validations/check-in.ts:56-64` `sessionCompletionSchema`, `:137` ·
`app/api/client/check-ins/route.ts:128, 304` (ignored pass-through; `services/check-in-service.ts:47` says so) ·
`app/api/check-in/[id]/route.ts:79` · `app/api/client/check-ins/[id]/route.ts:46` ·
`services/check-in-details-service.ts:270-278` (composition) ·
`components/clients/check-ins/check-in-detail-view.tsx:97` · `components/check-in/training-section.tsx:42, 70` ·
`lib/check-in/adherence-ownership.test.ts` (coach-only scan; excludes the wizard checklist by name) · `lib/check-in/adherence.test.ts`.

**The wizard's second count**
`components/check-in/daily-logs-training-summary.tsx:24` (fallback to `aggregateDailyLogs`) and its "Planned/Extra activities" rows, fed by `utils/daily-logs-aggregation.ts:36-40, 71-90` reading `training_logs.trained` / `training_data` — a column **no service writes** (`services/daily-log-permissions-service.ts:120` says so; the only daily-log routes are `nutrition` and `wellness`). `hooks/use-check-in-form.ts` and `services/check-in-service.ts` import other exports of that util and stay.

**Types and docs**
`types/training.ts:112` `TrainingEventStatus` · `types/check-in.ts:80` `SessionCompletionQuality`, `:85` `CheckInTrainingEventDetail` · `types/schedule.ts:11` `TrainingDayStatus` · `types/history.ts:36` `TrainingWeekSummary` · `types/coach-overview.ts:88-95, 112` · `lib/attention-feed-helpers.ts:42-45` (`TrainingEventRow.status: string`) ·
`docs/ARCHITECTURE.md`: Training Completion Hierarchy (~374-440, esp. 436), Client Portal → Workout logging / Alternative-session handling (~635-654, the sentence "Adherence counts `training_events.status='completed'`"), Coach client Overview (~747-804), The coach review surface (~1214-1395: "The session count is derived" ~1268, "Training is deliberately NOT on that wire" ~1334-1353), Check-in System → The customisable form (the Training step's checklist), The React Native contract (~1395-1416) ·
`CONVENTIONS.md` §8: "Events-as-SOT → Deferred debt → Adherence is not unified"; "Denormalisation is allowed only when named" (`check_ins.workouts_completed`); "One scheduled session per client per day" and "A logged day's prescription is frozen" (both key on `scheduled` and are **unchanged**) ·
`CLIENT-APP-REFERENCE.md` (repo root): 386 (log payload), 390 / 438 (quality type), 504 (Training Session Completion — stale, mentions Daily Pulse) · `TECHNICAL-DEBT.md` (repo root).

**Tests carrying `status: "completed"` / `"partial"` / `"skipped"` on events (21 files)**
`app/api/clients/[id]/training/[planId]/sessions/[sessionId]/route.test.ts`, `components/check-in/training-session-checklist.test.tsx`, `components/clients/training/calendar/placed-session-editor.test.tsx`, `components/clients/training/program-builder/placed-serialize.test.ts`, `components/clients/training/program-builder/program-builder-lock-model.test.ts`, `hooks/use-calendar-dnd.test.ts`, `services/ai-service.test.ts`, `services/attention-feed-service.test.ts`, `services/check-in-context-service.test.ts`, `services/check-in-details-service.test.ts`, `services/client-adherence-service.test.ts`, `services/plan-amendment-service.test.ts`, `services/training-event-calendar-service.test.ts`, `services/training-event-layout-service.test.ts`, `services/training-event-occupancy.test.ts`, `services/training-event-service.test.ts`, `services/training-log-service.test.ts`, `services/training-session-replace-service.test.ts`, `services/training-session-service.test.ts`, `utils/__tests__/training-event-helpers.test.ts`, `utils/ai-prompt-builder.test.ts`. Plus `components/check-in/kpi-ribbon.test.tsx`, `components/clients/overview/adherence-card.test.tsx`, `components/clients/overview/plan-training-card.test.tsx`, `components/clients/training/training-summary-hero.test.tsx`, `app/api/client/check-ins/[id]/route.test.ts`, `app/api/client/check-in-context/route.test.ts` (asserts the exact top-level key set — adding a key *inside* `trainingPeriodStats` does not change it).

## 4. The four commits

Each passes the full CONVENTIONS §13 checklist on its own before the next starts. Commits 1–3
change no stored value and no count; commit 4 is the only one after which partials count.

| # | Commit | Migration | Behaviour after it |
|---|---|---|---|
| 1 | **Quality reads from the log.** Every event-row read embeds the log's quality; one `mapEventRow`; one pure display-state helper that every tick/dash/chip/pill keys on; the per-day schedule shape per M5; the client day summary reads quality from the event; the attention feed and the Overview rail read quality from the embed. | none | Unchanged. Nothing anywhere reads the status word as full/partial any more. |
| 2 | **One per-workout shape, one check-in derivation.** The legacy session-completion shape is deleted; both check-in detail wires carry `trainingEventDetails`; the summariser moves to `lib/training-adherence.ts`; the context route derives the training stats once from the details it already fetched and the checklist header reads them; the wizard's daily-log fallback goes. | none | Unchanged. Two queries fewer per check-in open. |
| 3 | **Attendance lives on the calendar workout.** The hero counts calendar workouts by date; `countEventsInRange` is deleted; skipped stops being produced (zero-set saves refused, the fill-in selector loses Skipped, the RN quick path accepts full/partial); **Clear log** ships as an atomic RPC + `DELETE …/events/[eventId]/log`. | the next free number (163 at the 4b edit) — the Clear log RPC | Unchanged counts. A client can un-log; nothing produces a skip. |
| 4 | **The flip.** The migration (the next free number, 164 at the 4b edit) tightens both constraints and rewrites the values; the type unions shrink; the log link always writes `completed`; every done-count now includes partials by construction; the ownership scan loses its count half; labels per M8; the docs say the shipped shape and nothing else. | the next free number (164 at the 4b edit) | **Partials count everywhere.** The test week reads 5 of 5 with 1 partial on every surface. |
| 4b | **One report assembly for both check-in views.** After commit 4, and after measurement-log commit 8c (a submitted check-in closes its period, so the figures frozen at submit can no longer go stale). The report core — the check-in with its readings, its period, the headline figures FROM THE CHECK-IN ROW, the period detail from the locked logs, the client's answers — is built once and read by the coach's `GET /api/check-in/[id]` and the client's `GET /api/client/check-ins/[id]`, each route adding only its audience's parts; the client wire byte-identical, the coach wire shape-kept; the ownership scan's "no coach read of the stored column" rule retired. | none | Unchanged numbers on a week submitted after commit 4. The client's page and the coach's page cannot disagree, by construction. |

---

## 5. Prompts — one per commit, pasteable into a fresh session

Each prompt is self-contained. Paste it whole. The session must present its plan and wait for
approval before editing (the owner's standing rule), and must update the STATUS table in this
file when it finishes.

### Prompt — Commit 1 of 4: Quality reads from the log

```text
You are executing COMMIT 1 OF 4 of docs/TRAINING-COMPLETION-EXECUTION-PLAN.md in this repo.

Read, in full and in this order, before doing anything else:
1. docs/TRAINING-COMPLETION-EXECUTION-PLAN.md — the whole file. §1 is the end-state model and every decision in it is CLOSED; §2 holds verified facts; §3 is the inventory (a starting point — grep at execution time, never treat it as a deletion source); §4 says what this commit is and is not.
2. docs/ARCHITECTURE.md — in full.
3. CONVENTIONS.md (repo root) — in full. It says it is mandatory reading and it means it.

THIS WORKSTREAM CHANGES THE SHAPE THOSE TWO DOCS DESCRIBE. Where a rule, invariant, sentence or diagram in ARCHITECTURE.md or CONVENTIONS.md contradicts the end-state model in the plan's §1, do NOT follow it and do NOT silently rewrite it. Put a numbered list at the top of your plan: file, section, the sentence quoted, and what the new shape says instead. I will review that list before you touch code. Everything in those docs that is not about the changing shape stands as written and you follow it.

Plan before code: present your plan for this commit — the contradiction list, the files you will touch and why, the tests you will add — and STOP. Wait for my approval. Do not edit anything before I say go.

WHAT THIS COMMIT DELIVERS (behaviour-preserving; no stored value changes; no migration; no count changes):

A. Every reader that maps a training_events row embeds the linked log's quality. The FK MUST be named — there are two relationships between training_events and session_logs, so an unnamed embed is a PGRST201 error: session_logs!training_events_session_log_id_fkey(completion_quality). TrainingEvent gains completionQuality ("full" | "partial" | "skipped" | null — skipped still exists until commit 4; null when no log is linked). Always destructure and log the supabase error on every query you touch.

B. One mapEventRow. Two copies exist (services/training-event-service.ts:10 and services/training-log-service.ts:314). Make it one; surface which callers move, per CONVENTIONS "Don't silently change working code".

C. One pure display-state helper in utils/training-event-helpers.ts that turns an event (status + completionQuality + date + today) into its display state: scheduled / completed-full / completed-partial / skipped / missed. For a completed event with no linked log (209 such rows on dev, see plan §2) the display is full — that is what those rows show today. EVERY quality display keys on this helper and never on event.status: the calendar thumb (components/clients/training/calendar/calendar-tokens.ts STATUS_THUMB — re-key it on the display state; calendar-event-card.tsx:67), resolveEventStatus (utils/training-event-helpers.ts:161), the client day summary (services/training-event-service.ts:312 mapStatusToCompletionQuality is DELETED; the summary reads the event's completionQuality; components/client-portal/day/training-card-summary.tsx keeps its label), and anything else the grep finds. The data-table chip (training-history-table.tsx) and the log dialog switch on completion_quality already — verify that value now originates from the log via the embed, not from the status word.

D. The per-day schedule shape (types/schedule.ts ScheduleDay / TrainingDayStatus) per plan §1 M5: status carries attendance words only — scheduled, completed, missed, rest; completionQuality and isAlternative, which the shape already has, carry quality and swap. Remove the values partial, completed_swap and rest_trained from the type and from mapEventsToScheduleDays. Remove the merge of unlinked logs (the unlinkedLogs parameter and its branch) and the history route's read of session_logs for it (app/api/clients/[id]/history/training/route.ts ~111-117); the product no longer produces event-less logs (ARCHITECTURE → Alternative-session logging) and the rows that carry them are pre-retirement test history. Re-derive is_logged in that route from status === "completed". getEarliestActivityDate in the same route can then bound on events alone — do it only if it deletes code. The AI prompt's snapshot printer (utils/ai-prompt-builder.ts ~240-246) prints attendance + quality (+ swap) per day; old check-ins' frozen period_snapshot JSON keeps old words and must still print without error. The snapshot builder (services/check-in-snapshot-service.ts) needs no change beyond the shape.

E. The Overview kernel's rail (services/client-adherence-service.ts classifyTrainingDay ~:21) classifies a day from (status, quality) per event: complete = every workout completed AND full; partial = any workout completed (any quality) but not all full; missed = none. Its select (~:176) gains the embed or moves to the shared range reader — whichever deletes code. Its COUNT (~:75) is unchanged in this commit (still status === "completed"; the meaning widens in commit 4).

F. The attention feed's event read (services/attention-feed-service.ts ~:132) embeds quality; lib/attention-feed-helpers.ts TrainingEventRow.status becomes TrainingEventStatus (it is a plain string today, which is how stale literals hide from the compiler); lib/tracking-triggers.ts evaluatePartialTrainingPattern counts PARTIAL QUALITY on completed events, not status === "partial", and its status === "missed" branch (~:130) is dead — nothing ever stores missed (plan §2) — so it goes.

G. Tests. For EVERY quality display above, add a test whose fixture is a status "completed" event whose embedded log quality is "partial" and assert it renders as partial (dash / Partial chip / Partial pill / "Logged as partial"). These tests are the safety net commit 4 relies on: after this commit nothing reads the status word as full, and these prove it. Update the helper, calendar, day-summary, history-route, snapshot, attention-feed and kernel tests for the new shapes. Mutation-check one of them: temporarily make a display read event.status again and confirm its test fails, then restore it and say so in the commit message.

H. Docs, current shape only (ARCHITECTURE never carries "used to be" narratives): Training Completion Hierarchy — quality is read from the log through the named embed; the display-state helper is the ONE place an event becomes a display state; the per-day shape and what its three fields mean. Do not describe commit 4's shape yet; describe what is true after this commit.

NOT IN THIS COMMIT: any change to what counts as completed; any change to stored status values; the check-in's legacy per-workout shape (commit 2); the hero (commit 3); skipped removal (commit 3); the constraint (commit 4); labels (commit 4).

Landmines from this repo's history: after moving/renaming ≥5 files run rm -rf .next before judging tsc; never git stash or git checkout -- to test a mutation, copy the file to the scratchpad and restore from there; the set-tracker test is known-flaky in full runs, re-run before blaming your change; keep every "use client" module free of value-imports from services (npm run check:service-key).

Finish: CONVENTIONS §13 commit-ready checklist in full — npx tsc --noEmit, npx eslint ., npx vitest run, npm run check:labels, npm run check:service-key, grep the changed files for "as any" and TODO/FIXME/HACK/DEBUG, npx knip. Then run the CONVENTIONS §2 security/load/performance review (this commit crosses the ≥5-files-touching-data-flow trigger) and report it. Commit directly to main in this repo's commit style (look at git log for the convention; a refactor scope with "commit 1 of 4" in the subject). Update the STATUS row for commit 1 in docs/TRAINING-COMPLETION-EXECUTION-PLAN.md with the hash and any deviation. Do not drive the browser: hand me a short smoke checklist (calendar tick/dash on a completed and a partial day, the data table chips, the client home "Logged as partial", the Overview rail) and say plainly that the UI is unverified.
```

### Prompt — Commit 2 of 4: One per-workout shape, one check-in derivation

```text
You are executing COMMIT 2 OF 4 of docs/TRAINING-COMPLETION-EXECUTION-PLAN.md in this repo. Commit 1 has shipped; read its STATUS row first.

Read, in full and in this order, before doing anything else:
1. docs/TRAINING-COMPLETION-EXECUTION-PLAN.md — the whole file. §1 is the end-state model and every decision in it is CLOSED; §2 holds verified facts; §3 is the inventory (a starting point — grep at execution time, never treat it as a deletion source); §4 says what this commit is and is not.
2. docs/ARCHITECTURE.md — in full.
3. CONVENTIONS.md (repo root) — in full.

THIS WORKSTREAM CHANGES THE SHAPE THOSE TWO DOCS DESCRIBE. Where a rule, invariant or sentence in ARCHITECTURE.md or CONVENTIONS.md contradicts the end-state model in the plan's §1, do NOT follow it and do NOT silently rewrite it. Put a numbered list at the top of your plan: file, section, the sentence quoted, and what the new shape says instead. I will review that list before you touch code. Everything else in those docs stands and you follow it.

Plan before code: present your plan — the contradiction list, the files, the tests — and STOP. Wait for my approval.

WHAT THIS COMMIT DELIVERS (behaviour-preserving; no stored value changes; no migration; every number on every screen is the same before and after):

A. The legacy per-workout shape is deleted, not wrapped. CheckInSessionCompletion (types/check-in.ts ~:101) and every use of it: deriveSessionCompletionsForCheckIn (services/check-in-details-service.ts), the sessionCompletions fields on CheckInFormData and CheckInWithDetails, sessionCompletionSchema and the sessionCompletions field in lib/validations/check-in.ts, the ignored pass-through in app/api/client/check-ins/route.ts (~:304; services/check-in-service.ts:47 documents that the server ignores it), and the AI prompt's fallback branch over current.sessionCompletions (utils/ai-prompt-builder.ts ~:136-142 — the N2 follow-up already found this branch dead). Both single-check-in reads — GET /api/check-in/[id] (coach) and GET /api/client/check-ins/[id] (client) — carry trainingEventDetails (the CheckInTrainingEventDetail shape the wizard already receives from getTrainingEventDetailsForPeriod) instead. The client detail page does not render the old key today; verify with grep, and verify every consumer of the coach wire (hooks/use-check-in-detail-data.ts, check-in-detail-view.tsx, training-section.tsx, kpi-ribbon.tsx) before changing the response shape (CONVENTIONS "API changes cascade").

B. The summariser moves to a neutral home: lib/training-adherence.ts (pure, browser-safe — the review page and the wizard import it). It takes rows carrying { status, completionQuality } — event rows, CheckInTrainingEventDetail, ScheduleDay all qualify — and returns { planned, completed, full, partial, missed, pct }, plus a per-row classifier returning "full" | "partial" | "missed" for pills. In THIS commit completed still means status === "completed" (full only) and partial means status === "partial"; the widening happens in commit 4 when the status word changes meaning. lib/check-in/adherence.ts and its test are deleted; lib/check-in/adherence-ownership.test.ts moves beside the new module, keeps both of its rules for now, and loses its by-name exclusion of the wizard checklist because after (D) that file no longer counts anything.

C. getTrainingEventDetailsForPeriod (services/check-in-context-service.ts) no longer needs its own batched session_logs read for quality, notes and the performed session if the range reader's embed (commit 1) carries them: widen the embed to (completion_quality, notes, training_session_id) and delete the second read. If mapEventsToScheduleDays's separate sessionLogMap can then go too, take it; do neither if it only adds abstraction.

D. One derivation in the check-in. GET /api/client/check-in-context derives trainingPeriodStats from the trainingEventDetails it already fetched, through the summariser, and no longer calls getCheckInTrainingPeriodStats — two count queries per open become zero. Add sessionsPartial INSIDE trainingPeriodStats (additive; the RN contract allows additive keys; app/api/client/check-in-context/route.test.ts asserts the top-level key set — prove it still passes). getCheckInTrainingPeriodStats itself becomes range-reader + summariser (submitCheckIn still calls it for workouts_completed, so the screen and the stored number are one derivation). components/check-in/training-session-checklist.tsx stops counting: its header takes the stats as a prop from step-training.tsx; its row tint keys on the display-state helper from commit 1. components/check-in/daily-logs-training-summary.tsx reads the wire only: delete its fallback to aggregateDailyLogs.sessionsCompleted / totalPlannedSessions and the two "Planned activities" / "Extra activities" rows — they read training_logs.trained / training_data, which no service writes (plan §3) — and delete those fields from utils/daily-logs-aggregation.ts; the util's other exports stay (hooks/use-check-in-form.ts and services/check-in-service.ts import them). The line reads "N/M completed · k partial" (k omitted when zero); numerals through the mono tokens per docs/newdesignsystem.md; npm run check:labels must pass.

E. Tests: check-in-details-service, both single-check-in route tests, check-in-context-service, check-in-context route, check-in-service (workouts_completed derivation), training-session-checklist, daily-logs-training-summary, ai-prompt-builder (the fallback-branch test goes), kpi-ribbon and check-in-detail-view where props change, the new lib/training-adherence.test.ts (port the old cases; add one proving the summariser works over CheckInTrainingEventDetail and over ScheduleDay without adapters).

F. Docs, current shape only: ARCHITECTURE → The coach review surface (the derived session count, the wire the review reads, the ownership scan's scope), Check-in System (the Training step reads one derivation from the wire), The React Native contract (sessionsPartial is additive), and remove every mention of sessionCompletions / the dropped completions table shape. CONVENTIONS §8's sanctioned-denormalisation sentence for check_ins.workouts_completed names its single writer.

NOT IN THIS COMMIT: the hero (commit 3); skipped (commit 3); any count-rule change or stored value change (commit 4); labels (commit 4).

Landmines: rm -rf .next after large renames before judging tsc; never git stash / git checkout -- for mutation tests (copy to the scratchpad); when adding or removing exports, update every test that mocks the module (CONVENTIONS "Don't break the mock contract"); the set-tracker test is known-flaky in full runs.

Finish: the full CONVENTIONS §13 checklist (tsc, eslint, vitest, check:labels, check:service-key, as-any and marker greps on changed files, knip — knip must exit clean, so every orphan this deletion creates is deleted too). Run and report the §2 security/load/performance review (a response shape changed on two routes). Commit directly to main in the repo's style with "commit 2 of 4" in the subject. Update the STATUS row for commit 2 in the plan with the hash and any deviation. Do not drive the browser; hand me a smoke checklist (the wizard's Training step header and summary line, the coach review ribbon and pills, the client's own check-in detail page) and say the UI is unverified.
```

### Prompt — Commit 3 of 4: Attendance lives on the calendar workout

```text
You are executing COMMIT 3 OF 4 of docs/TRAINING-COMPLETION-EXECUTION-PLAN.md in this repo. Commits 1 and 2 have shipped; read their STATUS rows first.

Read, in full and in this order, before doing anything else:
1. docs/TRAINING-COMPLETION-EXECUTION-PLAN.md — the whole file. §1 is the end-state model and every decision in it is CLOSED; §2 holds verified facts; §3 is the inventory (grep at execution time); §4 says what this commit is and is not.
2. docs/ARCHITECTURE.md — in full.
3. CONVENTIONS.md (repo root) — in full. §8 "Migration workflow", "Multi-table writes are atomic" and the route auth chain in §8/§10 apply directly here.

THIS WORKSTREAM CHANGES THE SHAPE THOSE TWO DOCS DESCRIBE. Where a rule, invariant or sentence in ARCHITECTURE.md or CONVENTIONS.md contradicts the end-state model in the plan's §1, do NOT follow it and do NOT silently rewrite it. Put a numbered list at the top of your plan: file, section, the sentence quoted, and what the new shape says instead. I will review that list before you touch code. Everything else in those docs stands and you follow it.

Plan before code: present your plan — the contradiction list, the migration SQL described in words, the route, the files, the tests — and STOP. Wait for my approval.

WHAT THIS COMMIT DELIVERS (counts unchanged; one migration; one new route):

A. The Training-tab hero counts calendar workouts by date. services/training-week-summary-service.ts stops reading session_logs by completed_at and stops calling countEventsInRange: it reads the week's events through the shared range reader and derives completed (status === "completed" — still full-only until commit 4, so today's numbers do not move), plannedUpToToday (events dated up to the coach-local today), totalPlanned (the week's events) and missed (plannedUpToToday − completed). Same response shape (types/history.ts TrainingWeekSummary; the route app/api/clients/[id]/history/training/summary/route.ts; consumers components/clients/training/training-summary-hero.tsx and services/overview-plan-summary-service.ts ~:308 via buildTrainingSummary). Delete countEventsInRange once nothing calls it (knip will tell you). This service has NO test file today: write one, and test the primary branch, not a fallback (a prior fix here shipped to a dead branch). Rewrite the stale comment in components/clients/overview/plan-training-card.tsx (~:94-105) that still explains a Signals card and a "session_logs vs events" split; the hero's header comment likewise.

B. Nothing produces a skip any more (plan §1 M4). utils/completion-quality.ts deriveCompletionQuality returns "full" | "partial" only; a payload whose exercises carry zero ticked sets is refused by POST /api/client/training/events/[eventId]/log with a 400 and a plain sentence ("Tick at least one set, or clear the log."); the explicit completionQuality on the no-exercises quick path (the RN shape) accepts "full" | "partial" (lib/validations/training… — find the schema). The check-in wizard's fill-in selector (components/check-in/training-session-checklist.tsx QUALITY_OPTIONS) loses Skipped — an unlogged past day simply stays "Not logged". Every display and prompt line that renders a skip goes: the calendar's dimmed cardClass, the data-table chip branch, the review pill mapping, utils/ai-prompt-builder.ts "Skipped (reason: …)", lib/tracking-triggers.ts's resolved filter, the display-state helper's skipped state. Leave the TYPE value "skipped" in the unions for this commit — the constraint and the unions change together in commit 4, and the compiler then flags anything you missed here.

C. Clear log. A new client route DELETE /api/client/training/events/[eventId]/log, following the mandatory chain in CONVENTIONS §8/§10 exactly (client rate-limit first tier, CSRF, getAuthenticatedClientId passing request, per-client second tier, the IDOR check that the event belongs to the authed client, then the write). It is allowed exactly where the day rule allows editing: assertCanEdit (services/daily-log-permissions-service.ts). Read that rule from ARCHITECTURE → "Date-edit permissions" when you run, not from memory — measurement-log commit 8c, which ships before this plan begins, makes it "a day is locked once it falls on or before the last submitted check-in's period_end, or after today", so a mistaken log inside the open period CAN be cleared and one inside a closed period cannot. Do not change the rule here. The write touches two tables (delete the session_log — exercise_logs and set_logs cascade — and reset the event: status "scheduled", session_log_id NULL, updated_at), so it is ONE RPC, at the next free migration number (163 at the 4b edit; the measurement log took 158–162): clear_training_event_log_atomic(p_event_id uuid, p_client_id uuid), no optional params, proves in SQL that the event belongs to p_client_id and that a log is linked, raises a readable error otherwise, GRANT EXECUTE … TO service_role, drops as IF EXISTS so a failed push is re-runnable. Migration workflow per CONVENTIONS §8: brew upgrade supabase first (an old CLI has broken multi-statement function migrations here); npx supabase db push --dry-run immediately before npx supabase db push (it auto-confirms under non-TTY stdin); if the push is refused by the harness, stop and tell me to run "! npx supabase db push"; then regenerate types (npx supabase gen types typescript --linked > types/database.ts), skim the diff, and commit migration + types together. The service wrapper lives in services/training-log-service.ts beside the writer. Add the route to CLIENT-APP-REFERENCE.md (repo root) beside the log route, and invalidate the client's SWR areas the way the log route's caller does.

D. Tests: the new week-summary test file; the log route's zero-set refusal and the quick-path schema; the wizard selector; the Clear log route (401, 403 on a foreign event, 403 on a locked day, 200 resets the event — mock the RPC and assert its arguments; this is a vitest mock, so it proves the route's chain, not the SQL — say so); deriveCompletionQuality; every display test from commit 1 that had a skipped fixture. Prove the RPC against dev with a real event (log one, clear it, read both tables) and put the two queries in the commit message.

E. Docs, current shape only: ARCHITECTURE → Client Portal → Workout logging (zero-set refusal; Clear log; the day rule it obeys), Training Completion Hierarchy (the log link is the only writer of a non-scheduled status; no skip), the Training tab / hero wherever it is described as logs-versus-events, and the line in Alternative-session handling that reads "Adherence counts training_events.status='completed'" (true, and after commit 4 it will mean more — describe what is true now). TECHNICAL-DEBT.md: one entry that a moved workout leaves its log's completed_at behind (now cosmetic — no figure reads it; the layout guard and the history bound still do, name them).

NOT IN THIS COMMIT: the status constraint, the type-union change, the count widening, labels (all commit 4).

Landmines: the two DBs — dev aeaphsslctwcmebldrzx is linked; do NOT re-link to prod in this commit; npx supabase db query --linked "<sql>" is password-free read access for probes; a migration file renamed after a push blocks the next push (repair --status reverted <old>, then push; never mark-applied); rm -rf .next before judging tsc after large moves; never git stash / git checkout --; the set-tracker test is known-flaky.

Finish: the full CONVENTIONS §13 checklist (tsc, eslint, vitest, check:labels, check:service-key, check:rls — a new function, so confirm RLS posture and the grant, as-any and marker greps, knip). Run and report the §2 security/load/performance review in full — a new migration AND a new route AND a new write path all trip it; cite file:line for each of the six security items and state the worst-case row count for the delete. Commit directly to main with "commit 3 of 4" in the subject. Update the STATUS row for commit 3 with the hash, the migration number and any deviation. Do not drive the browser; hand me a smoke checklist (log a session today, Clear log, log it again; a logged day inside the open check-in period shows Clear and a day inside a closed period does not; the wizard row offers Completed / Partial only; the Training tab's numbers unchanged for this week) and say the UI is unverified.
```

### Prompt — Commit 4 of 4: The flip — one vocabulary

```text
You are executing COMMIT 4 OF 4 of docs/TRAINING-COMPLETION-EXECUTION-PLAN.md in this repo — the only commit after which partial workouts count as completed. Commits 1–3 have shipped; read their STATUS rows first.

Read, in full and in this order, before doing anything else:
1. docs/TRAINING-COMPLETION-EXECUTION-PLAN.md — the whole file. §1 is the end-state model and every decision in it is CLOSED; §2 holds verified facts (dev-only — you re-probe prod below); §3 is the inventory (grep at execution time; the 21 test files listed there carry the old values); §4 says what this commit is.
2. docs/ARCHITECTURE.md — in full.
3. CONVENTIONS.md (repo root) — in full. §8 "Migration workflow" and "A destructive change re-probes PROD first" apply directly.

THIS COMMIT IS THE ONE THAT MAKES THE DOCS' DESCRIPTION OF training_events.status FALSE. Where a rule, invariant or sentence in ARCHITECTURE.md or CONVENTIONS.md contradicts the end-state model in the plan's §1, do NOT follow it. List every such contradiction at the top of your plan (file, section, the sentence quoted, what the new shape says) for my review, and in THIS commit rewrite each of those passages to describe the shipped shape — current shape only, no "used to be", no dated change narrative. Everything else in those docs stands.

Plan before code: present your plan — the contradiction list, the migration described in words, the probe results from BOTH databases, the files, the tests, the label copy — and STOP. Wait for my approval.

PRE-FLIGHT, before the plan: (1) npx supabase migration list --linked must show dev at commit 3's migration (163 at the 4b edit — read commit 3's STATUS row for the number it took). (2) Probe dev with npx supabase db query --linked: the status distribution of training_events; the count of session_logs whose completion_quality = 'skipped' and whether each is linked to an event; the live names of training_events_status_check and of the CHECK on session_logs.completion_quality (select conname, pg_get_constraintdef(oid) from pg_constraint where conrelid = 'public.session_logs'::regclass — never assume a constraint name). (3) Probe PROD for the same facts before you write the migration: link is dev-only in this harness, so tell me the exact queries and I will run them against prod, or run them if you have a sanctioned path. Counts do not travel between databases and prod has drifted from the migration tree before. (4) brew upgrade supabase.

WHAT THIS COMMIT DELIVERS:

A. The migration — the next free number, 164 at the 4b edit — in this order inside one file, every drop IF EXISTS so a failed push is re-runnable: (i) drop both CHECKs (training_events status; session_logs completion_quality — use the live names from the probe). (ii) delete every session_log whose completion_quality is 'skipped', linked or not — a skipped log carries no sets, its child tables cascade, and the event's FK is ON DELETE SET NULL so session_log_id clears itself. (iii) training_events: update 'skipped' → 'scheduled'; update 'partial' → 'completed'; update any 'missed' → 'scheduled' (none exist on dev; prod may differ); add the CHECK status IN ('scheduled','completed'); COMMENT ON COLUMN saying what completed means and who writes it. (iv) session_logs: add the CHECK completion_quality IN ('full','partial'). (iii) The migration-136 partial unique index on (client_id, date) WHERE status = 'scheduled' and the migration-150 RPC's status <> 'scheduled' test are UNCHANGED and must keep working — say so in the file. Dry-run, push to dev, regenerate types (expect no diff — CHECK constraints are not emitted — and say so), and run the verification queries: zero rows with a status outside the two values, zero logs outside the two qualities, every completed event with a session_log_id pointing at a live log except the 209 log-less test rows (plan §2), which stay completed.

B. The unions shrink: TrainingEventStatus = "scheduled" | "completed" (types/training.ts:112); SessionCompletionQuality = "full" | "partial" (types/check-in.ts ~:80) and the matching union on TrainingEvent.completionQuality; the display-state helper loses its skipped state; lib/attention-feed-helpers.ts's row type already uses the union (commit 1). Now let the compiler drive: every remaining literal "partial", "skipped" or "missed" compared against an event status is a build error — fix each at the root, never by widening a type back.

C. The writer: linkSessionLogToEvent (services/training-event-service.ts) always writes status "completed" in the same statement as session_log_id; mapCompletionQualityToEventStatus is deleted; the caller in services/training-log-service.ts (~:729-734) follows.

D. The readers whose meaning widens — verify each, do not just compile: getCheckInTrainingPeriodStats and therefore check_ins.workouts_completed; the Overview kernel's count (services/client-adherence-service.ts) — its rail was done in commit 1; the Training-tab hero and the Overview plan card (commit 3 made them count events; now completed includes partial); the summariser in lib/training-adherence.ts (completed = status "completed"; full/partial from the log's quality; a completed event with no quality counts as full, plan §2's 209 rows); the client week's deriveState (services/client-training-week-service.ts); lib/engagement-triggers.ts (completed events are activity — plan §1 M4); lib/activity-triggers.ts (plan §1 M10: only a not-completed event's calories count as skipped activity — say in the commit message that this alert now fires less often for partial days); services/training-event-occupancy.ts hasCompletedWorkoutOn (.eq("status","completed")); utils/training-event-helpers.ts STATUS_PRIORITY typed Record<TrainingEventStatus, number> with completed > scheduled, and its swap detection. Grep the whole tree for any "completed" | "partial" status literal outside the kernel and the helpers and account for each in your plan.

E. The ownership scan (moved in commit 2) loses its "no hand-rolled count" rule — with no partial status a count cannot leave partials out, so the guard has nothing to guard — and keeps its "no coach surface reads the stored workouts_completed column" rule for THIS commit only — a check-in submitted before this flip keeps a full-only stored number (plan §1 M13) and the review still derives live — and commit 4b retires that rule when both check-in views read one assembly. Mutation-test the surviving rule (plant a coach read of workoutsCompleted, watch it fail, remove it, say so).

F. Labels (plan §1 M8): every single-workout or single-day label says Full / Partial / Missed — components/check-in/training-section.tsx STATUS_META ("Completed" → "Full"), components/clients/training/training-history-table.tsx renderStatus (a past unlogged prescribed day is "Missed"; "Not Logged" stays for a future/today unlogged one only if the row can be one — check), the calendar thumb legend if one exists, components/client-portal/day/training-card-summary.tsx ("Logged as partial" stays). The classifier's state names follow ("full" | "partial" | "missed"). The word "completed" appears only in counts. npm run check:labels must pass.

G. Tests: the 21 fixture files in plan §3 plus the ribbon/adherence-card/plan-card/hero/route tests move to the new values; the display tests from commit 1 keep their meaning (a completed event with a partial log renders partial) with no fixture change needed — that is the point of them; add one summariser case: five completed events, one with partial quality → { planned 5, completed 5, full 4, partial 1, missed 0, pct 100 }.

H. Docs, current shape only, in this commit: ARCHITECTURE → Training Completion Hierarchy (two statuses, quality on the log, the one writer, the adherence rule, the display-state helper), Client Portal → Workout logging and Alternative-session handling (the "Adherence counts …" sentence), Coach client Overview (the adherence row; the rail's three states), The coach review surface (delete the "two conventions", "full-only column", "counts full AND partial" and wizard-exclusion passages; state the rule once and where the scan lives), Check-in System (the Training step), The React Native contract (status and quality values changed; Clear log added in commit 3). CONVENTIONS §8: replace the "Adherence is not unified" deferred-debt bullet with the rule and a pointer to lib/training-adherence.ts; the sanctioned-denormalisation sentence names what workouts_completed counts; "One scheduled session per client per day" and "A logged day's prescription is frozen" are unchanged — confirm. CLIENT-APP-REFERENCE.md: status values, quality values, the log payload's accepted qualities, and rewrite the stale "Training Session Completion" section (it still describes Daily Pulse). types/coach-overview.ts and components/clients/overview/plan-training-card.tsx: delete the comments that explain the old split.

I. Prod. After the dev smoke below passes: I will run the prod push myself if the harness refuses it; in either case, after the prod push, regenerate types from prod and diff them against the repo (prod has drifted before), and re-run the verification queries against prod. Record both DBs' migration state in the STATUS row.

Landmines: the two DBs (dev aeaphsslctwcmebldrzx, prod etezzztgafcotyahgijk); db push --dry-run immediately before every push, and "! npx supabase db push" from me if refused; a migration renamed after a push blocks the next push; rm -rf .next before judging tsc — this commit renames values across the tree; never git stash / git checkout --; the set-tracker test is known-flaky.

Finish: the full CONVENTIONS §13 checklist (tsc, eslint, vitest, check:labels, check:service-key, check:rls, as-any and marker greps, knip). Run and report the §2 security/load/performance review in full — a migration trips it; expected findings: none new, since the only changed write is the existing log link writing a shorter word and reads per request went down in commits 2 and 3. Commit directly to main with "commit 4 of 4" in the subject. Update the STATUS row for commit 4 with the hash, the migration number, both DBs' state and any deviation. Commit 4b follows; the plan file is deleted after it, not after this commit. Do not drive the browser; hand me this smoke checklist and say the UI is unverified: on the Europe/London "Samuel James" (id ed5cb82c-30ea-488d-96d8-eb34e8ae09fa on dev) for the week of 24–30 Aug 2026 — the check-in Training step reads 5/5 completed · 1 partial with all five rows locked and Full/Partial labels; after submitting, the client's check-in card reads Workouts 5; the coach review ribbon reads 5/5 with "1 partial" and a Partial pill on Tue 25; the Overview card reads 5 of 5 with a partial dot on Tue 25; the Training tab hero counts this week's calendar workouts; the calendar shows a tick on the four full days and a dash on Tue 25; Clear log still works on today.
```

### Prompt — Commit 4b: One report assembly for both check-in views

```text
You are executing COMMIT 4B of docs/TRAINING-COMPLETION-EXECUTION-PLAN.md in this repo — the last commit of the plan. Commits 1–4 have shipped; read their STATUS rows first. This commit also depends on measurement-log commit 8c (a submitted check-in closes its period), which shipped before this plan began; its shape lives in docs/ARCHITECTURE.md → "Date-edit permissions" and "Check-in System". Do not look for the measurement-log plan: it is deleted.

Read, in full and in this order, before doing anything else:
1. docs/TRAINING-COMPLETION-EXECUTION-PLAN.md — the whole file. §1 is CLOSED; §4's 4b row says what this commit is and is not.
2. docs/ARCHITECTURE.md — in full, and again: Check-in System → "The coach review surface", "The React Native contract", and "Date-edit permissions".
3. CONVENTIONS.md (repo root) — in full.
4. CLIENT-APP-REFERENCE.md (repo root) — the client check-in routes.

Where a rule, invariant or sentence in ARCHITECTURE.md or CONVENTIONS.md contradicts what this commit builds, do NOT follow it and do NOT silently rewrite it. Put a numbered list at the top of your plan: file, section, the sentence quoted, and what the new shape says instead. I will review that list before you touch code.

Plan before code: present your plan — the contradiction list, the files, the wire proofs, the tests — and STOP. Wait for my approval.

THE RULE THIS COMMIT BUILDS ON, stated here because the plan that decided it is gone: a submitted check-in closes its period — a day on or before the last submitted check-in's period_end can no longer be logged, moved or changed by the client — and commit 4 of this plan made every done-count include partials. So the figures a check-in froze at submit (workouts_completed, adherence_percentage, nutrition_days_on_target, the five wellness averages, period_snapshot) can no longer go stale and can no longer be counted differently from a live read. That is what lets the report be built once.

WHAT IS THERE TODAY, by grep on 2026-09-03 — re-grep, commits 1–4 will have moved lines: the coach's GET /api/check-in/[id] (app/api/check-in/[id]/route.ts over services/check-in-details-service.ts) assembles the check-in with its readings and derives the training figures live over the period's events, and the review page reads the window's daily and habit logs and nutrition targets live; the client's GET /api/client/check-ins/[id] (app/api/client/check-ins/[id]/route.ts) builds its own payload by hand, deriving the training details live while reading the stored workouts_completed / adherence_percentage / nutrition_days_on_target — a mix; the client list GET /api/client/check-ins reads the stored figures; app/client/check-in/[id]/page.tsx renders the client's page; the adherence ownership scan (moved in commit 2, trimmed in commit 4) forbids a coach surface from reading the stored workouts_completed column. Two assemblies of one report is how two answers happen.

WHAT THIS COMMIT DELIVERS (no migration; the client wire byte-identical; the coach wire shape-kept; no number changes on a week submitted after commit 4):

A. One assembly. A function in services/check-in-details-service.ts — or a sibling named for the report; one file, your call — that builds the REPORT CORE for a check-in id: the check-in object with its readings folded in; its period; the headline figures FROM THE CHECK-IN ROW — workouts completed over prescribed, nutrition days on target and adherence, the five wellness averages; the period detail from the (now locked) logs — the per-workout rows with full / partial / missed through lib/training-adherence.ts, the window's daily wellness and habit logs, the nutrition days; and the client's answers. Headline numbers come from the row and never from a fresh count; per-day detail comes from the logs; the full/partial breakdown over the locked events is the one place the partial count is derived.

B. Two routes call it and add only their audience's parts. Coach: GET /api/check-in/[id] keeps its shape and adds what it adds today — the comparison stays on its own …/comparison read, the AI review and the reply composer's data stay coach-only. Client: GET /api/client/check-ins/[id] is byte-identical — the coach's reply, no goal progress, no comparison, no AI coach actions. The client list route keeps reading the stored figures; verify it needs nothing from the assembly. Check every consumer of both wires before touching a shape (CONVENTIONS "API changes cascade").

C. The ownership scan: retire the "no coach surface reads the stored workouts_completed column" rule — its two reasons ended with 8c (nothing can be backfilled after submit) and commit 4 (one counting rule); keep the "one summariser" rule and mutation-test it.

D. Transition (plan §1 M13): a check-in submitted before commit 4 keeps its full-only stored number, and after this commit BOTH pages show it. No backfill, no special case; say so in the commit message.

E. Tests, each with a mutation: the assembly — headline figures from the row (mutation: recount from the events), per-day detail from the logs, a check-in with one partial workout reads completed 5 of 5 with 1 partial, a check-in with no training in its period; both routes over the mocked assembly — the coach route adds its parts, the client route adds the reply and nothing coach-only (mutation: leak the AI coach actions onto the client payload); the scan's surviving rule; the client page renders unchanged.

F. Wire proofs. scripts/wire-proof-measurements.ts records GET /api/client/check-ins, GET /api/client/check-ins/[id], GET /api/check-in/[id] and …/comparison for two subjects through a running next dev with sessions minted by generateLink → verifyOtp; record "before" on the untouched tree, "after" at the end, and diff: every client recording byte-identical, the coach detail shape-kept. Use the never-smoked fixture client 5ca1ec1e-0000-4000-8000-000000000001 as a subject; a subject whose data moves between recordings (a submitted check-in, an edit) breaks byte-identity for reasons that are not yours.

G. Docs, current shape only: ARCHITECTURE → The coach review surface (one assembly, what each audience adds, the headline numbers read the check-in row), Check-in System (the frozen figures are the report, and why they cannot go stale), The React Native contract (unchanged shape — say so), the scan's description wherever it appears. CLIENT-APP-REFERENCE.md if any sentence describes how the client detail is derived.

NOT IN THIS COMMIT: any change to what counts as completed (commit 4 did that); any change to the client wire's shape; the lock itself (8c, already shipped).

Landmines: rm -rf .next after large moves before judging tsc; never git stash / git checkout -- (copy to the scratchpad for mutation tests); when adding or removing exports, update every test that mocks the module; the set-tracker test is known-flaky in full runs; the wire harness needs next dev on port 3000 and the linked DEV project in .env.local.

Finish: the full CONVENTIONS §13 checklist (tsc, eslint, vitest, check:labels, check:service-key, as-any and marker greps on changed files, knip clean). Run and report the §2 security/load/performance review — two routes' assembly changed and the review page's reads per request should go DOWN, say by how many. Commit directly to main with "commit 4b" in the subject. Update the STATUS row for 4b with the hash and any deviation, then tell me the plan file can be deleted once I have smoked it. Do not drive the browser; hand me a smoke checklist (one check-in open on both pages — workouts with the partial breakdown, nutrition, wellness and habits equal; a check-in submitted before commit 4 showing its stored number on both; nothing coach-only on the client's page; the coach's reply present) and say the UI is unverified.
```

---

## 6. Verification, transition facts, effort

- **Per commit:** CONVENTIONS §13 in full — `npx tsc --noEmit`, `npx eslint .`, `npx vitest run`, `npm run check:labels`, `npm run check:service-key`, `npm run check:rls` where a migration landed, the `as any` and marker greps on changed files, `npx knip` clean. No `npm run build` — nothing touches routing or prerendering.
- **§2 security/load/performance review:** commits 1, 2 and 4 trip the files-touching-data-flow trigger; commit 3 trips three triggers (migration, route, write path). Each session reports it unprompted.
- **Owner's browser smoke:** after each commit, from the checklist that commit hands over. The owner runs smokes; sessions never drive the browser.
- **Transition facts:** check-ins submitted before commit 4 keep the full-only number in `workouts_completed`; only the AI prompt's trend block reads that column for previous check-ins. Frozen `period_snapshot` JSON keeps its old per-day words and still prints. The 209 log-less completed rows on dev stay completed and display as full.
- **Effort:** roughly three days across the four commits, including gates and the two pushes.
