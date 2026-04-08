-- Add a plain UNIQUE constraint for ON CONFLICT upsert support.
-- Postgres requires a real constraint (not a partial unique index) for
-- ON CONFLICT (col, col, col) references.
-- The partial index from 075 still handles NULL safety when ON DELETE SET NULL
-- nullifies training_session_id. Since we only ever insert rows with non-null
-- training_session_id, both the constraint and the partial index agree.

ALTER TABLE training_events
  ADD CONSTRAINT uq_training_events_session_date
  UNIQUE (client_id, training_session_id, date);
