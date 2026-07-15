-- =====================================================
-- Flow Builder Tables Migration for Neon PostgreSQL
-- Multi-tenant schema with org_id scoping
-- =====================================================

-- Drop existing tables if they exist (for clean migration)
DROP TABLE IF EXISTS sm_flow_runs CASCADE;
DROP TABLE IF EXISTS sm_flow_steps CASCADE;
DROP TABLE IF EXISTS sm_flows CASCADE;
DROP TABLE IF EXISTS sm_connections CASCADE;

-- =====================================================
-- 1. Connections Table - OAuth tokens scoped by organization
-- =====================================================
CREATE TABLE sm_connections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  provider TEXT NOT NULL,
  module TEXT,  -- Optional: specific module (e.g., 'gmail', 'calendar')
  account_label TEXT NOT NULL,
  access_token TEXT NOT NULL,
  refresh_token TEXT,
  token_expiry TIMESTAMPTZ,
  scopes TEXT[],  -- Array of granted scopes
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive', 'expired')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Index for fast org lookups
CREATE INDEX idx_sm_connections_org ON sm_connections(org_id);
CREATE INDEX idx_sm_connections_provider ON sm_connections(provider);
CREATE INDEX idx_sm_connections_status ON sm_connections(status);

-- =====================================================
-- 2. Flows Table - Flow definitions scoped by organization
-- =====================================================
CREATE TABLE sm_flows (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  trigger_module TEXT NOT NULL,
  trigger_type TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'active', 'paused', 'error')),
  config JSONB DEFAULT '{}',  -- Flow-level configuration
  last_run_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Index for org filtering
CREATE INDEX idx_sm_flows_org ON sm_flows(org_id);
CREATE INDEX idx_sm_flows_status ON sm_flows(status);
CREATE INDEX idx_sm_flows_trigger ON sm_flows(trigger_module, trigger_type);

-- =====================================================
-- 3. Flow Steps Table - Linear step sequence
-- =====================================================
CREATE TABLE sm_flow_steps (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  flow_id UUID NOT NULL REFERENCES sm_flows(id) ON DELETE CASCADE,
  step_order INTEGER NOT NULL,
  module TEXT NOT NULL,
  action_type TEXT NOT NULL,
  connection_id UUID REFERENCES sm_connections(id) ON DELETE SET NULL,
  config JSONB DEFAULT '{}',  -- Action-specific configuration
  label TEXT,  -- Human-readable label for the step
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Index for flow ordering
CREATE INDEX idx_sm_flow_steps_flow ON sm_flow_steps(flow_id);
CREATE INDEX idx_sm_flow_steps_order ON sm_flow_steps(flow_id, step_order);

-- =====================================================
-- 4. Flow Runs Table - Execution history
-- =====================================================
CREATE TABLE sm_flow_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  flow_id UUID NOT NULL REFERENCES sm_flows(id) ON DELETE CASCADE,
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'running' CHECK (status IN ('running', 'success', 'failed', 'cancelled')),
  triggered_by TEXT,  -- 'manual', 'webhook', 'schedule', etc.
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  error_message TEXT,
  result JSONB,  -- Final output of the flow
  logs JSONB[] DEFAULT '{}'  -- Array of step-by-step logs
);

-- Index for run history
CREATE INDEX idx_sm_flow_runs_flow ON sm_flow_runs(flow_id);
CREATE INDEX idx_sm_flow_runs_org ON sm_flow_runs(org_id);
CREATE INDEX idx_sm_flow_runs_status ON sm_flow_runs(status);
CREATE INDEX idx_sm_flow_runs_started ON sm_flow_runs(started_at DESC);

-- =====================================================
-- Helper Functions
-- =====================================================

-- Function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Apply updated_at triggers
CREATE TRIGGER trg_sm_connections_updated_at
  BEFORE UPDATE ON sm_connections
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER trg_sm_flows_updated_at
  BEFORE UPDATE ON sm_flows
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- =====================================================
-- Row Level Security (RLS) Policies
-- =====================================================

-- Enable RLS on all tables
ALTER TABLE sm_connections ENABLE ROW LEVEL SECURITY;
ALTER TABLE sm_flows ENABLE ROW LEVEL SECURITY;
ALTER TABLE sm_flow_steps ENABLE ROW LEVEL SECURITY;
ALTER TABLE sm_flow_runs ENABLE ROW LEVEL SECURITY;

-- Policy: Users can only access data within their organization
-- Note: This assumes you have a function or setting that provides current org_id
-- For session-based auth, you'll need to set this in your backend

-- Connections policies
CREATE POLICY sm_connections_org_isolation ON sm_connections
  FOR ALL USING (org_id = current_setting('app.current_org_id', true)::uuid);

-- Flows policies
CREATE POLICY sm_flows_org_isolation ON sm_flows
  FOR ALL USING (org_id = current_setting('app.current_org_id', true)::uuid);

-- Flow steps policies
CREATE POLICY sm_flow_steps_org_isolation ON sm_flow_steps
  FOR ALL USING (
    flow_id IN (
      SELECT id FROM sm_flows 
      WHERE org_id = current_setting('app.current_org_id', true)::uuid
    )
  );

-- Flow runs policies
CREATE POLICY sm_flow_runs_org_isolation ON sm_flow_runs
  FOR ALL USING (org_id = current_setting('app.current_org_id', true)::uuid);

-- =====================================================
-- Sample Data for Testing (Optional)
-- =====================================================
-- Uncomment and run after creating an organization

-- INSERT INTO sm_connections (org_id, provider, module, account_label, access_token, refresh_token, token_expiry, scopes)
-- VALUES (
--   (SELECT id FROM organizations WHERE slug = 'graphicy'),
--   'google',
--   'gmail',
--   'admin@graphicy.com',
--   'ya29.sample_access_token',
--   'sample_refresh_token',
--   NOW() + INTERVAL '1 hour',
--   ARRAY['https://www.googleapis.com/auth/gmail.send']
-- );

-- =====================================================
-- Verification Queries
-- =====================================================

-- Check table structure
SELECT 
  tablename,
  pg_size_pretty(pg_total_relation_size(schemaname||'.'||tablename)) as size
FROM pg_tables 
WHERE schemaname = 'public' 
  AND tablename LIKE 'sm_%'
ORDER BY tablename;

-- Count records per org
SELECT 
  o.name as organization,
  COUNT(DISTINCT c.id) as connections,
  COUNT(DISTINCT f.id) as flows,
  COUNT(DISTINCT fs.id) as flow_steps,
  COUNT(DISTINCT fr.id) as flow_runs
FROM organizations o
LEFT JOIN sm_connections c ON o.id = c.org_id
LEFT JOIN sm_flows f ON o.id = f.org_id
LEFT JOIN sm_flow_steps fs ON f.id = fs.flow_id
LEFT JOIN sm_flow_runs fr ON o.id = fr.org_id
GROUP BY o.id, o.name
ORDER BY o.name;
