-- Fix bmr and tdee columns in nutrition_plan_history to accept decimal values
ALTER TABLE nutrition_plan_history
  ALTER COLUMN bmr TYPE NUMERIC(6, 2),
  ALTER COLUMN tdee TYPE NUMERIC(6, 2);

COMMENT ON COLUMN nutrition_plan_history.bmr IS 'Basal Metabolic Rate at time of plan creation (can have decimals)';
COMMENT ON COLUMN nutrition_plan_history.tdee IS 'Total Daily Energy Expenditure at time of plan creation (can have decimals)';
