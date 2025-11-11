-- Create check_ins table
CREATE TABLE IF NOT EXISTS check_ins (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'ai_processed', 'reviewed')),

  -- Subjective metrics
  mood INTEGER CHECK (mood BETWEEN 1 AND 5),
  energy INTEGER CHECK (energy BETWEEN 1 AND 10),
  sleep INTEGER CHECK (sleep BETWEEN 1 AND 10),
  stress INTEGER CHECK (stress BETWEEN 1 AND 10),
  notes TEXT,

  -- Body metrics
  weight DECIMAL(5, 1),
  weight_unit TEXT DEFAULT 'lbs' CHECK (weight_unit IN ('lbs', 'kg')),
  body_fat_percentage DECIMAL(4, 1),
  waist DECIMAL(4, 1),
  hips DECIMAL(4, 1),
  chest DECIMAL(4, 1),
  arms DECIMAL(4, 1),
  thighs DECIMAL(4, 1),
  measurement_unit TEXT DEFAULT 'in' CHECK (measurement_unit IN ('in', 'cm')),

  -- Photos (stored as URLs from Supabase Storage)
  photo_front TEXT,
  photo_side TEXT,
  photo_back TEXT,

  -- Training & nutrition
  workouts_completed INTEGER,
  adherence_percentage INTEGER CHECK (adherence_percentage BETWEEN 0 AND 100),
  prs TEXT,
  challenges TEXT,

  -- AI-generated content
  ai_summary TEXT,
  ai_insights JSONB,
  ai_recommendations JSONB,
  ai_response_draft TEXT,
  ai_processed_at TIMESTAMP WITH TIME ZONE,

  -- Coach response
  coach_response TEXT,
  coach_reviewed_at TIMESTAMP WITH TIME ZONE,
  response_sent_at TIMESTAMP WITH TIME ZONE,

  -- Timestamps
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create index on client_id for faster queries
CREATE INDEX idx_check_ins_client_id ON check_ins(client_id);

-- Create index on status for filtering
CREATE INDEX idx_check_ins_status ON check_ins(status);

-- Create index on created_at for sorting
CREATE INDEX idx_check_ins_created_at ON check_ins(created_at DESC);

-- Create a composite index for common queries
CREATE INDEX idx_check_ins_client_status ON check_ins(client_id, status, created_at DESC);

-- Create updated_at trigger
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_check_ins_updated_at
  BEFORE UPDATE ON check_ins
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- Enable Row Level Security (RLS)
ALTER TABLE check_ins ENABLE ROW LEVEL SECURITY;

-- Create RLS policies (allowing all operations for now, refine later for multi-tenancy)
CREATE POLICY "Enable all operations for authenticated users" ON check_ins
  FOR ALL
  USING (true)
  WITH CHECK (true);
