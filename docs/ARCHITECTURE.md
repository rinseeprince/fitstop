# CoachHub Architecture Reference

This file documents the current database schema and data flow patterns. Unlike CONVENTIONS.md (which contains stable coding rules), this file evolves with the schema. **Update it when shipping migrations.**

## Daily Logs (spine + child tables)

Daily tracking data is split into a spine table and domain-specific child tables:
```
daily_logs (spine)         -- id, client_id, date, notes, phase_id
  ├── wellness_logs        -- mood, energy, sleep, stress (1:1 via daily_log_id FK)
  ├── nutrition_logs       -- consumed, targets, adherence (1:1 via daily_log_id FK)
  ├── training_logs        -- trained, training_session_id, training_data JSONB (1:1 via daily_log_id FK)
  ├── daily_habit_logs     -- per-habit completion (1:many, FK to daily_habits)
  └── daily_external_activities -- ad-hoc activities (1:many)
```
- **Writes** go through the `upsert_daily_log_atomic()` RPC function which upserts spine + child tables in a single transaction
- **Domain-specific reads** query child tables directly (e.g. wellness history queries `wellness_logs`, not the view)
- **Cross-domain reads** use the `daily_logs_full` view (e.g. attention feed, AI summary generation)
- Each child table has `client_id` and `date` columns for direct querying without joining the spine
- Phase linkage for nutrition/training logs is derived via plan FKs: `nutrition_logs.nutrition_plan_id` -> `nutrition_plans.phase_id` -> `phases`. The spine (`daily_logs`) retains `phase_id` for direct phase context.
- The `DailyLog` TypeScript type remains flat. The split is DB + service layer only. Hooks, components, and utils are unaffected

## Training Completion Hierarchy

```
training_logs        -- did the client train today? (1:1 per day, child of daily_logs)
  └── session_logs   -- per-session-per-week completion details (renamed from client_session_completions)
        └── exercise_logs  -- per-exercise performance (renamed from client_exercise_completions)
```
- `session_logs.training_session_id` is SET NULL on delete (nullable). When a training plan is replaced, old completion records are preserved via `prescribed_session_snapshot` JSONB
- `exercise_logs.training_exercise_id` is SET NULL on delete (nullable). History preserved via `prescribed_exercise_snapshot` JSONB
- Snapshots are written at completion time and backfilled for existing data

## JSONB Conventions

- See Daily Pulse README for `training_data` and `activityStatuses` shape documentation
- `activityStatuses` is `Record<string, { completed, activityName, estimatedCalories }>` - always read `.completed` field, never use the object as a truthy check
- `training_data` JSONB on `training_logs` is a **UI restore cache** for the Daily Pulse. It preserves the exact training state at save time so the UI can restore without cross-referencing. The **source of truth** for training completion is `session_logs` + `exercise_logs`
