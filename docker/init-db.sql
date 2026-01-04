-- DevOrbit Dashboard Database Schema
-- This script initializes the database with all required tables

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Applications table
CREATE TABLE IF NOT EXISTS applications (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name VARCHAR(255) NOT NULL,
  path TEXT NOT NULL UNIQUE,
  type VARCHAR(50),  -- 'node', 'python', 'docker', 'static', etc.
  framework VARCHAR(100),  -- 'nextjs', 'vite', 'flask', 'django', etc.

  -- Configuration
  start_command TEXT,
  default_port INTEGER,
  custom_port INTEGER,
  env_file TEXT,

  -- User preferences
  is_favorite BOOLEAN DEFAULT FALSE,
  is_archived BOOLEAN DEFAULT FALSE,
  display_order INTEGER,

  -- Metadata (stored as JSONB for flexibility)
  package_json JSONB,
  detected_scripts JSONB,
  ai_analysis TEXT,

  -- Timestamps
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  last_started_at TIMESTAMP WITH TIME ZONE,
  last_scanned_at TIMESTAMP WITH TIME ZONE
);

-- Create index on path for quick lookups
CREATE INDEX IF NOT EXISTS idx_apps_path ON applications(path);
CREATE INDEX IF NOT EXISTS idx_apps_favorite ON applications(is_favorite);
CREATE INDEX IF NOT EXISTS idx_apps_archived ON applications(is_archived);

-- Application runs/history
CREATE TABLE IF NOT EXISTS app_runs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  app_id UUID REFERENCES applications(id) ON DELETE CASCADE,

  status VARCHAR(50),  -- 'running', 'stopped', 'error', 'crashed'
  pid INTEGER,
  port INTEGER,

  started_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  stopped_at TIMESTAMP WITH TIME ZONE,
  exit_code INTEGER,

  -- Resource usage snapshots (stored as averages)
  avg_cpu_usage DECIMAL(5,2),
  avg_memory_mb INTEGER,
  peak_cpu_usage DECIMAL(5,2),
  peak_memory_mb INTEGER
);

CREATE INDEX IF NOT EXISTS idx_app_runs_app_id ON app_runs(app_id);
CREATE INDEX IF NOT EXISTS idx_app_runs_status ON app_runs(status);
CREATE INDEX IF NOT EXISTS idx_app_runs_started_at ON app_runs(started_at);

-- Port allocations (for conflict management)
CREATE TABLE IF NOT EXISTS port_allocations (
  port INTEGER PRIMARY KEY,
  app_id UUID REFERENCES applications(id) ON DELETE SET NULL,
  allocated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  is_system_port BOOLEAN DEFAULT FALSE,
  notes TEXT
);

-- Terminal sessions (for persistent terminals)
CREATE TABLE IF NOT EXISTS terminal_sessions (
  id TEXT PRIMARY KEY,
  app_id UUID REFERENCES applications(id) ON DELETE SET NULL,
  cwd TEXT NOT NULL,
  shell TEXT DEFAULT '/bin/bash',

  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  last_activity TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  is_active BOOLEAN DEFAULT TRUE,

  -- Store last N lines of output for session recovery
  output_buffer TEXT[],
  buffer_size INTEGER DEFAULT 10000
);

CREATE INDEX IF NOT EXISTS idx_terminal_sessions_app_id ON terminal_sessions(app_id);
CREATE INDEX IF NOT EXISTS idx_terminal_sessions_active ON terminal_sessions(is_active);

-- Tags for organization
CREATE TABLE IF NOT EXISTS tags (
  id SERIAL PRIMARY KEY,
  name VARCHAR(100) UNIQUE NOT NULL,
  color VARCHAR(7),  -- hex color like '#FF5733'
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Many-to-many relationship between apps and tags
CREATE TABLE IF NOT EXISTS app_tags (
  app_id UUID REFERENCES applications(id) ON DELETE CASCADE,
  tag_id INTEGER REFERENCES tags(id) ON DELETE CASCADE,
  PRIMARY KEY (app_id, tag_id)
);

-- System configuration
CREATE TABLE IF NOT EXISTS system_config (
  key VARCHAR(100) PRIMARY KEY,
  value JSONB NOT NULL,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Insert default configuration
INSERT INTO system_config (key, value) VALUES
  ('scan_directories', '[]'::jsonb),
  ('scan_depth', '3'::jsonb),
  ('exclude_patterns', '["node_modules", ".git", "dist", "build", ".next"]'::jsonb),
  ('port_range', '{"start": 3000, "end": 4000}'::jsonb)
ON CONFLICT (key) DO NOTHING;

-- Function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ language 'plpgsql';

-- Triggers for auto-updating updated_at
CREATE TRIGGER update_applications_updated_at
  BEFORE UPDATE ON applications
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_system_config_updated_at
  BEFORE UPDATE ON system_config
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Create a view for active running apps
CREATE OR REPLACE VIEW v_running_apps AS
SELECT
  a.*,
  r.pid,
  r.port as running_port,
  r.started_at,
  EXTRACT(EPOCH FROM (NOW() - r.started_at)) as uptime_seconds
FROM applications a
JOIN app_runs r ON a.id = r.app_id
WHERE r.status = 'running' AND r.stopped_at IS NULL;

-- Grant permissions (adjust as needed for your setup)
-- GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO devorbit_user;
-- GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO devorbit_user;
