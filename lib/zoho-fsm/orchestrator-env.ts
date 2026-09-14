// Server-only config for the hosted Zoho FSM orchestrator (auto-publish, Phase 0B). Separate
// from ./env.ts, which configures this app's own inbound Zoho API access — this is a distinct,
// outbound trust direction: Installer Sheetz calling out to the orchestrator's admin API.
// Never import from client components; the admin token must never reach the browser.

export type ZohoFsmOrchestratorEnv = {
  baseUrl: string;
  adminToken: string;
  /**
   * Unlike ZohoFsmServerEnv.missing, callers must treat a nonempty `missing` here as "auto-publish
   * disabled" rather than a hard error — this integration is opt-in per Phase 0B and must never
   * block an otherwise-successful Installer Sheetz submission or revision.
   */
  missing: string[];
};

export function getZohoFsmOrchestratorEnv(): ZohoFsmOrchestratorEnv {
  const baseUrl = process.env.ZOHO_FSM_ORCHESTRATOR_BASE_URL?.trim() || "";
  const adminToken = process.env.ZOHO_FSM_ORCHESTRATOR_ADMIN_TOKEN?.trim() || "";

  const missing: string[] = [];
  if (!baseUrl) missing.push("ZOHO_FSM_ORCHESTRATOR_BASE_URL");
  if (!adminToken) missing.push("ZOHO_FSM_ORCHESTRATOR_ADMIN_TOKEN");

  return { baseUrl, adminToken, missing };
}
