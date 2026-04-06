-- Run this SQL in your Supabase SQL Editor to set up the 'todos' table

CREATE TABLE IF NOT EXISTS todos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE DEFAULT auth.uid(),
  text TEXT NOT NULL,
  completed BOOLEAN DEFAULT FALSE,
  priority TEXT DEFAULT 'medium',
  dueDate TIMESTAMPTZ,
  reminderTriggered BOOLEAN DEFAULT FALSE,
  amount NUMERIC DEFAULT 0,
  subtasks JSONB DEFAULT '[]'::jsonb,
  project TEXT DEFAULT '',
  completedAt TIMESTAMPTZ,
  createdAt TIMESTAMPTZ DEFAULT now()
);

-- Enable Row Level Security
ALTER TABLE todos ENABLE ROW LEVEL SECURITY;

-- Create policies
CREATE POLICY "Users can view their own todos" ON todos
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own todos" ON todos
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own todos" ON todos
  FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "Users can delete their own todos" ON todos
  FOR DELETE USING (auth.uid() = user_id);

-- Enable Realtime for the 'todos' table
-- Note: You may need to enable this in the Supabase Dashboard under Database > Replication
-- if the publication 'supabase_realtime' doesn't exist or doesn't include this table.
-- ALTER PUBLICATION supabase_realtime ADD TABLE todos;
