-- ============================================================
-- Easy-Score / MiladOne: Add Code Type to Rooms Table
-- Run this in: Supabase Dashboard → SQL Editor → New Query
-- ============================================================

ALTER TABLE rooms 
ADD COLUMN IF NOT EXISTS code_type TEXT NOT NULL DEFAULT 'number' 
CHECK (code_type IN ('number', 'letter'));
