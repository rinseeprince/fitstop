-- Add welcome_message column to clients table for storing activation welcome messages
ALTER TABLE clients ADD COLUMN welcome_message TEXT CHECK (char_length(welcome_message) <= 1000);
