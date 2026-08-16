-- ============================================================
-- MiladOne: Add Group Events Support
-- Run this in: Supabase Dashboard → SQL Editor → New Query
-- ============================================================

-- Add event_type column to events table
-- 'solo' = individual event (existing behavior)
-- 'group' = group/team event (new)
ALTER TABLE events ADD COLUMN IF NOT EXISTS event_type TEXT DEFAULT 'solo' CHECK (event_type IN ('solo', 'group'));

-- Update existing events to be solo by default
UPDATE events SET event_type = 'solo' WHERE event_type IS NULL;
