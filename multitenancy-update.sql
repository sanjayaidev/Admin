-- =====================================================
-- Multi-Tenancy SQL Update Script for ClientPM
-- =====================================================
-- This script adds organization-based multi-tenancy to existing tables
-- Run this on an existing database to add org_id columns and constraints
-- =====================================================

-- 1. Ensure organizations table exists (should already exist from db.js)
CREATE TABLE IF NOT EXISTS organizations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  slug TEXT UNIQUE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_organizations_slug ON organizations (slug);

-- 2. Add org_id to users table if not exists
ALTER TABLE users ADD COLUMN IF NOT EXISTS org_id UUID;
ALTER TABLE users ADD CONSTRAINT fk_users_org 
  FOREIGN KEY (org_id) REFERENCES organizations(id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS idx_users_org_id ON users (org_id);

-- 3. Add org_id to clients table if not exists
ALTER TABLE clients ADD COLUMN IF NOT EXISTS org_id UUID;
ALTER TABLE clients ADD CONSTRAINT fk_clients_org 
  FOREIGN KEY (org_id) REFERENCES organizations(id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS idx_clients_org_id ON clients (org_id);

-- 4. Add org_id to work_items table if not exists
ALTER TABLE work_items ADD COLUMN IF NOT EXISTS org_id UUID;
ALTER TABLE work_items ADD CONSTRAINT fk_work_items_org 
  FOREIGN KEY (org_id) REFERENCES organizations(id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS idx_work_items_org_id ON work_items (org_id);

-- 5. Add org_id to invoices table if not exists
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS org_id UUID;
ALTER TABLE invoices ADD CONSTRAINT fk_invoices_org 
  FOREIGN KEY (org_id) REFERENCES organizations(id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS idx_invoices_org_id ON invoices (org_id);

-- 6. Add org_id to calendar_events table if not exists
ALTER TABLE calendar_events ADD COLUMN IF NOT EXISTS org_id UUID;
ALTER TABLE calendar_events ADD CONSTRAINT fk_calendar_events_org 
  FOREIGN KEY (org_id) REFERENCES organizations(id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS idx_calendar_events_org_id ON calendar_events (org_id);

-- 7. Add org_id to client_assignments table if not exists
ALTER TABLE client_assignments ADD COLUMN IF NOT EXISTS org_id UUID;
ALTER TABLE client_assignments ADD CONSTRAINT fk_client_assignments_org 
  FOREIGN KEY (org_id) REFERENCES organizations(id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS idx_client_assignments_org_id ON client_assignments (org_id);

-- 8. Add org_id to roles table if not exists
ALTER TABLE roles ADD COLUMN IF NOT EXISTS org_id UUID;
ALTER TABLE roles ADD CONSTRAINT fk_roles_org 
  FOREIGN KEY (org_id) REFERENCES organizations(id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS idx_roles_org_id ON roles (org_id);

-- 9. Add org_id to integrations table if not exists
ALTER TABLE integrations ADD COLUMN IF NOT EXISTS org_id UUID;
ALTER TABLE integrations ADD CONSTRAINT fk_integrations_org 
  FOREIGN KEY (org_id) REFERENCES organizations(id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS idx_integrations_org_id ON integrations (org_id);

-- =====================================================
-- ROW LEVEL SECURITY (RLS) - Optional but recommended
-- Enable RLS on all tenant tables to enforce data isolation
-- =====================================================

-- Enable RLS on clients table
ALTER TABLE clients ENABLE ROW LEVEL SECURITY;

-- Policy: Users can only see clients from their own organization
CREATE POLICY IF NOT EXISTS clients_org_isolation ON clients
  FOR ALL
  USING (org_id = (SELECT org_id FROM users WHERE id = current_setting('app.current_user_id')::int));

-- Enable RLS on work_items table
ALTER TABLE work_items ENABLE ROW LEVEL SECURITY;

-- Policy: Users can only see work items from their own organization
CREATE POLICY IF NOT EXISTS work_items_org_isolation ON work_items
  FOR ALL
  USING (org_id = (SELECT org_id FROM users WHERE id = current_setting('app.current_user_id')::int));

-- Enable RLS on invoices table
ALTER TABLE invoices ENABLE ROW LEVEL SECURITY;

-- Policy: Users can only see invoices from their own organization
CREATE POLICY IF NOT EXISTS invoices_org_isolation ON invoices
  FOR ALL
  USING (org_id = (SELECT org_id FROM users WHERE id = current_setting('app.current_user_id')::int));

-- Enable RLS on calendar_events table
ALTER TABLE calendar_events ENABLE ROW LEVEL SECURITY;

-- Policy: Users can only see calendar events from their own organization
CREATE POLICY IF NOT EXISTS calendar_events_org_isolation ON calendar_events
  FOR ALL
  USING (org_id = (SELECT org_id FROM users WHERE id = current_setting('app.current_user_id')::int));

-- =====================================================
-- HELPER FUNCTIONS
-- =====================================================

-- Function to get current user's organization ID
CREATE OR REPLACE FUNCTION get_current_org_id()
RETURNS UUID AS $$
DECLARE
  current_org_id UUID;
BEGIN
  SELECT org_id INTO current_org_id
  FROM users
  WHERE id = current_setting('app.current_user_id')::int;
  
  RETURN current_org_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to set current user context (call this at the start of each request)
CREATE OR REPLACE FUNCTION set_current_user(user_id INTEGER)
RETURNS VOID AS $$
BEGIN
  PERFORM set_config('app.current_user_id', user_id::text, false);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- =====================================================
-- DATA MIGRATION (if you have existing data)
-- =====================================================
-- If you have existing data without org_id, you may want to:
-- 1. Create a default organization
-- 2. Assign all existing records to that organization

-- Example: Create default organization for existing data
-- INSERT INTO organizations (id, name, slug)
-- VALUES ('00000000-0000-0000-0000-000000000001', 'Default Organization', 'default');

-- Example: Update existing users to belong to default org
-- UPDATE users SET org_id = '00000000-0000-0000-0000-000000000001' WHERE org_id IS NULL;

-- Example: Update existing clients to belong to default org
-- UPDATE clients SET org_id = '00000000-0000-0000-0000-000000000001' WHERE org_id IS NULL;

-- Example: Update existing work_items to belong to default org
-- UPDATE work_items SET org_id = (SELECT org_id FROM clients WHERE id = client_id) WHERE org_id IS NULL;

-- =====================================================
-- VERIFICATION QUERIES
-- =====================================================

-- Check organizations
-- SELECT * FROM organizations;

-- Check users by organization
-- SELECT o.name, COUNT(u.id) as user_count
-- FROM organizations o
-- LEFT JOIN users u ON u.org_id = o.id
-- GROUP BY o.id, o.name;

-- Check data distribution across organizations
-- SELECT 
--   o.name as organization,
--   (SELECT COUNT(*) FROM users u WHERE u.org_id = o.id) as users,
--   (SELECT COUNT(*) FROM clients c WHERE c.org_id = o.id) as clients,
--   (SELECT COUNT(*) FROM work_items w WHERE w.org_id = o.id) as work_items,
--   (SELECT COUNT(*) FROM invoices i WHERE i.org_id = o.id) as invoices
-- FROM organizations o;

-- =====================================================
-- CLEANUP (if needed)
-- =====================================================

-- To drop all RLS policies (use with caution):
-- DROP POLICY IF EXISTS clients_org_isolation ON clients;
-- DROP POLICY IF EXISTS work_items_org_isolation ON work_items;
-- DROP POLICY IF EXISTS invoices_org_isolation ON invoices;
-- DROP POLICY IF EXISTS calendar_events_org_isolation ON calendar_events;

-- To disable RLS on all tables:
-- ALTER TABLE clients DISABLE ROW LEVEL SECURITY;
-- ALTER TABLE work_items DISABLE ROW LEVEL SECURITY;
-- ALTER TABLE invoices DISABLE ROW LEVEL SECURITY;
-- ALTER TABLE calendar_events DISABLE ROW LEVEL SECURITY;
