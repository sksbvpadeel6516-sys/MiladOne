-- ============================================================
-- Easy-Score: Add Teams, Participants, and Mappings
-- Run this in: Supabase Dashboard → SQL Editor → New Query
-- ============================================================

-- Drop tables if they exist (for clean installation/reset if needed)
DROP TABLE IF EXISTS event_participant_mappings CASCADE;
DROP TABLE IF EXISTS participants CASCADE;
DROP TABLE IF EXISTS teams CASCADE;

-- ============================================================
-- 1. Teams Table
-- ============================================================
CREATE TABLE teams (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    institution_id UUID NOT NULL REFERENCES institutions(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
    UNIQUE(institution_id, name)
);

-- ============================================================
-- 2. Participants Table
-- ============================================================
CREATE TABLE participants (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    institution_id UUID NOT NULL REFERENCES institutions(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    chest_number TEXT NOT NULL,
    team_id UUID REFERENCES teams(id) ON DELETE SET NULL,
    category TEXT DEFAULT 'Senior',
    created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
    UNIQUE(institution_id, chest_number)
);

-- ============================================================
-- 3. Event Participant Mappings Table
-- ============================================================
CREATE TABLE event_participant_mappings (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    event_id UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    participant_number INT CHECK (participant_number >= 1),
    participant_id UUID NOT NULL REFERENCES participants(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
    UNIQUE(event_id, participant_id)
);
-- If modifying an existing database table, run:
-- ALTER TABLE event_participant_mappings ALTER COLUMN participant_number DROP NOT NULL;
-- ALTER TABLE event_participant_mappings DROP CONSTRAINT IF EXISTS event_participant_mappings_event_id_participant_number_key;

-- ============================================================
-- Enable Realtime
-- ============================================================
ALTER PUBLICATION supabase_realtime ADD TABLE teams;
ALTER PUBLICATION supabase_realtime ADD TABLE participants;
ALTER PUBLICATION supabase_realtime ADD TABLE event_participant_mappings;

-- ============================================================
-- Enable Row Level Security (RLS)
-- ============================================================
ALTER TABLE teams ENABLE ROW LEVEL SECURITY;
ALTER TABLE participants ENABLE ROW LEVEL SECURITY;
ALTER TABLE event_participant_mappings ENABLE ROW LEVEL SECURITY;

-- Allow ALL operations for anyone (anon + authenticated) to prevent session issues
-- App-level guards protect the Admin UI and restrict Judges from seeing this data.
CREATE POLICY "teams_all" ON teams FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "participants_all" ON participants FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "mappings_all" ON event_participant_mappings FOR ALL USING (true) WITH CHECK (true);

-- Run this in SQL Editor if modifying an existing participants table:
-- ALTER TABLE participants ADD COLUMN IF NOT EXISTS category TEXT DEFAULT 'Senior';
