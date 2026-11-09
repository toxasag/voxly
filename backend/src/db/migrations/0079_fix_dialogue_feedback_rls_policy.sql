-- Fix RLS policy on agent_dialogue_feedbacks to use standard current_tenant_id() and platform_scope()
DROP POLICY IF EXISTS tenant_isolation ON agent_dialogue_feedbacks;

CREATE POLICY tenant_isolation ON agent_dialogue_feedbacks
  USING (((tenant_id = current_tenant_id()) OR platform_scope()))
  WITH CHECK ((tenant_id = current_tenant_id()));

ALTER TABLE agent_dialogue_feedbacks FORCE ROW LEVEL SECURITY;
