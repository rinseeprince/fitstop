-- Coach display preference: how a training-day surplus (activity burn) is added
-- to the macros. Default false = "keep my split" (protein held; carbs+fat scale
-- preserving the plan's ratio). true = "carbs only" (protein AND fat held; the
-- whole surplus is added as carbohydrate). Client-level, toggled via PATCH
-- /api/clients/[id]/nutrition alongside include_activity_burn. Additive, no RPC.
ALTER TABLE clients
  ADD COLUMN IF NOT EXISTS surplus_as_carbs BOOLEAN NOT NULL DEFAULT false;
