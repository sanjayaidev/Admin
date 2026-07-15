-- =====================================================
-- Multi-Tenancy Update SQL Migration
-- For ClientPM with Google APIs Flow Builder Integration
-- =====================================================

-- 1. Create organizations table if not exists
CREATE TABLE IF NOT EXISTS organizations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(255) NOT NULL,
  slug VARCHAR(100) UNIQUE NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_organizations_slug ON organizations(slug);

-- 2. Add org_id to users table if not exists
DO $$ BEGIN
  ALTER TABLE users ADD COLUMN IF NOT EXISTS org_id UUID REFERENCES organizations(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS idx_users_org_id ON users(org_id);

-- 3. Add org_id to clients table if not exists  
DO $$ BEGIN
  ALTER TABLE clients ADD COLUMN IF NOT EXISTS org_id UUID REFERENCES organizations(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS idx_clients_org_id ON clients(org_id);

-- 4. Add org_id to work_items table if not exists
DO $$ BEGIN
  ALTER TABLE work_items ADD COLUMN IF NOT EXISTS org_id UUID REFERENCES organizations(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS idx_work_items_org_id ON work_items(org_id);

-- 5. Add org_id to invoices table if not exists
DO $$ BEGIN
  ALTER TABLE invoices ADD COLUMN IF NOT EXISTS org_id UUID REFERENCES organizations(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS idx_invoices_org_id ON invoices(org_id);

-- 6. Add org_id to team_members table if not exists
DO $$ BEGIN
  ALTER TABLE team_members ADD COLUMN IF NOT EXISTS org_id UUID REFERENCES organizations(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS idx_team_members_org_id ON team_members(org_id);

-- 7. Add org_id to settings table if not exists
DO $$ BEGIN
  ALTER TABLE settings ADD COLUMN IF NOT EXISTS org_id UUID REFERENCES organizations(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS idx_settings_org_id ON settings(org_id);

-- 8. Add module column to connections table (for GoogleAPIs integration)
DO $$ BEGIN
  ALTER TABLE sm_connections ADD COLUMN IF NOT EXISTS module TEXT;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS idx_sm_connections_user_module ON sm_connections(user_id, module);

-- 9. Add org_id to sm_connections for multi-tenant isolation
DO $$ BEGIN
  ALTER TABLE sm_connections ADD COLUMN IF NOT EXISTS org_id UUID REFERENCES organizations(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS idx_sm_connections_org_id ON sm_connections(org_id);

-- 10. Add org_id to sm_flows table
DO $$ BEGIN
  ALTER TABLE sm_flows ADD COLUMN IF NOT EXISTS org_id UUID REFERENCES organizations(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS idx_sm_flows_org_id ON sm_flows(org_id);

-- 11. Enable Row Level Security (RLS) on organizations
ALTER TABLE organizations ENABLE ROW LEVEL SECURITY;

-- RLS Policy: Users can only see their own organization
DROP POLICY IF EXISTS org_isolation_policy ON organizations;
CREATE POLICY org_isolation_policy ON organizations
  FOR ALL
  USING (id = current_setting('app.current_org_id', TRUE)::UUID);

-- 12. Helper function to set current organization context
CREATE OR REPLACE FUNCTION set_current_org(org_uuid UUID)
RETURNS VOID AS $$
BEGIN
  PERFORM set_config('app.current_org_id', org_uuid::TEXT, FALSE);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 13. Trigger to auto-update updated_at on organizations
CREATE OR REPLACE FUNCTION update_org_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_update_org_updated_at ON organizations;
CREATE TRIGGER trg_update_org_updated_at
  BEFORE UPDATE ON organizations
  FOR EACH ROW
  EXECUTE FUNCTION update_org_updated_at();

-- =====================================================
-- MIGRATION EXAMPLE: Create organization for existing user
-- Run this after the schema updates above
-- =====================================================

-- Example: Create "Graphicy" organization and assign to admin user (id=2)
-- Uncomment and modify as needed:
/*
INSERT INTO organizations (id, name, slug)
VALUES (gen_random_uuid(), 'Graphicy', 'graphicy');

UPDATE users 
SET org_id = (SELECT id FROM organizations WHERE slug = 'graphicy')
WHERE id = 2;
*/

-- =====================================================
-- VERIFICATION QUERIES
-- =====================================================

-- Check organizations
-- SELECT * FROM organizations;

-- Check users with their organizations
-- SELECT u.id, u.email, u.full_name, o.name as org_name 
-- FROM users u 
-- LEFT JOIN organizations o ON u.org_id = o.id;

-- Check that all tables have org_id column
-- SELECT table_name, column_name 
-- FROM information_schema.columns 
-- WHERE column_name = 'org_id' 
-- AND table_name IN ('users', 'clients', 'work_items', 'invoices', 'team_members', 'settings');
