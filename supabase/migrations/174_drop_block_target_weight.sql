-- Migration 174: the block's target weight goes.
--
-- A block is a label on time plus a window — name, focus, [starts_on, ends_on],
-- archived_at — and carries no target and no goal. The client's goal lives in
-- client_goals and is the one target concept; a stored block target was a
-- second one beside it, fed to no calculator, read only by a pace readout.
--
-- Probed on DEV and PROD before this file was written (2026-09-11): nothing on
-- either catalog depends on the column — no view, function, constraint, index,
-- policy or trigger names it — so a plain DROP with no CASCADE, which fails the
-- push rather than taking a dependent should that ever change. DEV held 8
-- targets on 4 test clients; PROD held no rows.

ALTER TABLE IF EXISTS public.client_phases
  DROP COLUMN IF EXISTS target_weight;
