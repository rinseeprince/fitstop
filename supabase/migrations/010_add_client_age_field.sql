-- Migration: Add age/date of birth field to clients table
-- Purpose: Store client age for accurate BMR calculations
-- Date: 2025-11-18

-- Add date_of_birth column to clients table
ALTER TABLE clients
ADD COLUMN date_of_birth DATE;

-- Add comment explaining the field
COMMENT ON COLUMN clients.date_of_birth IS 'Client''s date of birth for accurate BMR and age-related calculations';

-- Create index for potential age-based queries
CREATE INDEX idx_clients_date_of_birth ON clients(date_of_birth);

-- Create a helper function to calculate age from date of birth
CREATE OR REPLACE FUNCTION calculate_age(date_of_birth DATE)
RETURNS INTEGER AS $$
BEGIN
  IF date_of_birth IS NULL THEN
    RETURN NULL;
  END IF;

  RETURN EXTRACT(YEAR FROM AGE(CURRENT_DATE, date_of_birth))::INTEGER;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

COMMENT ON FUNCTION calculate_age(DATE) IS 'Calculates age in years from a given date of birth';
